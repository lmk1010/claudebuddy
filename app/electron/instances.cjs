/*
 * 托管实例 —— 每个环境一个 mihomo 进程，只绑一个节点。
 *
 * 这是「一个客户端搞定全部隔离 IP」的核心：
 *
 *   订阅节点 → 生成本实例的极简配置 → 独立 `-d` 目录 + 独立端口 → 环境走这个端口
 *
 * 为什么必须独立进程，而不是在用户的 Clash 里加 listeners：
 *   · 不用用户手写 YAML、不用重启他的代理、不会把他的配置改坏
 *   · 一个节点挂了不会拖垮其他环境
 *   · 不碰系统代理，本机流量完全不受影响
 *
 * 已验证：两个实例的出口 IP 可以完全不同（见开发记录）。
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { spawn, execFile } = require("node:child_process");

const kernel = require("./kernel.cjs");
const subs = require("./subscription.cjs");

/** 端口从 7950 起 —— 避开 7890/7891 这些各代理软件的默认值 */
const PORT_BASE = 7950;
/** 控制端口另开一段，避免和 mixed-port 抢 */
const CTL_BASE = 8450;

/** 运行中的实例：exitId → { proc, port, node, subId, dir } */
const running = new Map();

let BASE = null;

function baseDir() {
  if (BASE) return BASE;
  try {
    BASE = path.join(require("electron").app.getPath("userData"), "exits");
  } catch {
    BASE = path.join(os.homedir(), ".claude-buddy", "exits");
  }
  return BASE;
}

function setBaseDir(dir) {
  BASE = dir;
}

function dirOf(exitId) {
  return path.join(baseDir(), String(exitId));
}

/** 端口在不在监听 */
function isListening(port, host = "127.0.0.1", timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeout);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

/** 找一个空闲端口。已被占用的（包括用户别的代理）全部跳过 */
async function pickPort(avoid = new Set(), from = PORT_BASE, span = 200) {
  for (let p = from; p < from + span; p += 1) {
    if (avoid.has(p)) continue;
    if (await isListening(p)) continue;
    return p;
  }
  throw new Error(`没有可用端口（${from}-${from + span - 1} 全被占用）`);
}

/**
 * 生成一个实例的配置。
 *
 * 故意写得极简：只有这条线路上的节点、一条 MATCH 规则、不加载任何规则集。
 * 这不是偷懒 —— 规则集会让 mihomo 去拉几百 KB 的 geosite/geoip，
 * 实例启动慢好几秒，而我们只需要「全部流量走这一个节点」。
 *
 * nodeBlocks 是**一组**：链式节点要靠 dialer-proxy 指的跳板出去，
 * 只写目标节点的话 mihomo 找不到那个名字，直接判配置无效。
 */
function buildConfig(port, nodeBlocks, nodeName, ctlPort, secret) {
  return [
    `mixed-port: ${port}`,
    "allow-lan: false",
    "bind-address: 127.0.0.1",
    "mode: rule",
    "log-level: warning",
    "ipv6: false",
    /**
     * 只绑回环 + 随机 secret。
     *
     * 这个 API 能列出这台机器经过代理的**每一条连接**（域名、目标、上下行字节），
     * 等于一个完整的浏览记录。所以它不能对外开、也不能无鉴权：
     * 局域网里任何人扫到端口就能读走。
     */
    `external-controller: 127.0.0.1:${ctlPort}`,
    `secret: "${secret}"`,
    "proxies:",
    ...nodeBlocks,
    "rules:",
    `  - MATCH,${nodeName}`,
    "",
  ].join("\n");
}

/** 用 mihomo -t 校验配置，不通过就不启动 —— 启动一个坏配置只会浪费时间 */
function validate(bin, dir, cfgFile) {
  return new Promise((resolve) => {
    execFile(bin, ["-d", dir, "-f", cfgFile, "-t"], { timeout: 15000 }, (err, stdout, stderr) => {
      const out = `${stdout || ""}\n${stderr || ""}`;
      if (/is successful/i.test(out)) return resolve({ ok: true });
      // 只把最有信息量的那几行给出去，不刷整个日志
      const lines = out
        .split("\n")
        .filter((l) => /error|failed|not allowed/i.test(l))
        .slice(0, 3)
        .join("\n");
      resolve({ ok: false, reason: lines || (err?.message ?? "配置校验失败") });
    });
  });
}

/** 等实例真的开始监听。mihomo 从启动到 listen 有几百毫秒 */
async function waitReady(port, timeoutMs = 12000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await isListening(port)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * 启动一个托管实例。
 *
 * exitId 由调用方（渲染层创建出口时）给，同一个 exitId 重复 start 会先停旧的 ——
 * 否则换节点后会出现两个进程抢同一个端口。
 */
async function start({ exitId, subId, node, onLog } = {}) {
  if (!exitId) throw new Error("缺少 exitId");
  if (!subId || !node) throw new Error("缺少订阅或节点");

  await stop(exitId);

  const bin = await kernel.ensure();
  const text = await subs.readText(subId);
  // 链式节点要靠跳板出去，所以取的是「这个节点 + 它的依赖」，不是单块
  const blocks = subs.nodeBlocks(text, node);
  if (blocks.length === 0) throw new Error(`订阅里找不到节点「${node}」，可能已过期，重新拉取订阅`);

  const dir = dirOf(exitId);
  await fsp.mkdir(dir, { recursive: true });
  const taken = new Set([...running.values()].map((r) => r.port));
  const port = await pickPort(taken);
  // 控制端口也避开已用的 mixed-port，免得两段撞上
  const ctlPort = await pickPort(new Set([...taken, port]), CTL_BASE);
  const secret = crypto.randomBytes(16).toString("hex");
  const cfgFile = path.join(dir, "config.yaml");
  await fsp.writeFile(cfgFile, buildConfig(port, blocks, node, ctlPort, secret), { mode: 0o600 });

  const v = await validate(bin.path, dir, cfgFile);
  if (!v.ok) throw new Error(`节点配置无法启动：${v.reason}`);

  const logFile = path.join(dir, "mihomo.log");
  const fd = fs.openSync(logFile, "a");
  const proc = spawn(bin.path, ["-d", dir, "-f", cfgFile], {
    stdio: ["ignore", fd, fd],
    detached: false,
  });
  fs.closeSync(fd);

  proc.on("exit", (code) => {
    running.delete(exitId);
    onLog?.(`实例 ${exitId} 已退出（code ${code}）`);
  });

  const ready = await waitReady(port);
  if (!ready) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* 已退出 */
    }
    throw new Error(`实例没能开始监听端口 ${port}，看 ${logFile} 里的原因`);
  }

  running.set(exitId, { proc, port, node, subId, dir, pid: proc.pid, ctlPort, secret });
  return { ok: true, exitId, port, pid: proc.pid, host: "127.0.0.1", node };
}

/** 停一个实例。已经停了也算成功 */
async function stop(exitId) {
  const r = running.get(exitId);
  if (!r) return { ok: true, already: true };
  running.delete(exitId);
  try {
    r.proc.kill("SIGTERM");
  } catch {
    /* 已经没了 */
  }
  // 给 2 秒体面退出，不然强杀
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    if (!(await isListening(r.port))) return { ok: true };
    await new Promise((x) => setTimeout(x, 100));
  }
  try {
    r.proc.kill("SIGKILL");
  } catch {
    /* 已经没了 */
  }
  return { ok: true };
}

/** 运行中的实例列表 */
function list() {
  return [...running.entries()].map(([exitId, r]) => ({
    exitId,
    port: r.port,
    pid: r.pid,
    node: r.node,
    subId: r.subId,
  }));
}

function get(exitId) {
  const r = running.get(exitId);
  return r ? { exitId, port: r.port, pid: r.pid, node: r.node, subId: r.subId } : null;
}

/**
 * 读一个实例的实时连接。
 *
 * 走 mihomo 的 RESTful API（`/connections`），返回正在进行的连接：
 * 目标域名、链路、上下行字节、规则。这就是"过代理的链接"的证据 ——
 * 没有它，用户只能靠猜"到底走没走代理"。
 *
 * API 只绑 127.0.0.1 且带 secret，所以这里直接带 Bearer 头请求本机。
 * 拿不到就返回空 + 原因，不编造数据。
 */
function connections(exitId) {
  return new Promise((resolve) => {
    const r = running.get(exitId);
    if (!r) return resolve({ ok: false, reason: "实例没在运行", list: [], up: 0, down: 0 });
    if (!r.ctlPort) return resolve({ ok: false, reason: "这个实例没有开控制端口（重启一次即可）", list: [], up: 0, down: 0 });

    const req = http.request(
      {
        host: "127.0.0.1",
        port: r.ctlPort,
        path: "/connections",
        method: "GET",
        headers: { Authorization: `Bearer ${r.secret}` },
        timeout: 4000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return resolve({ ok: false, reason: `控制接口返回 ${res.statusCode}`, list: [], up: 0, down: 0 });
          }
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const list = (j.connections ?? []).map((c) => {
              const m = c.metadata ?? {};
              return {
                id: c.id,
                host: m.host || m.destinationIP || "",
                // 只给域名，不把完整 URL / 查询串带出来
                type: m.type || "",
                network: m.network || "",
                destIp: m.destinationIP || "",
                destPort: m.destinationPort || "",
                source: m.sourceIP || "",
                chains: c.chains ?? [],
                rule: c.rule || "",
                rulePayload: c.rulePayload || "",
                up: c.upload ?? 0,
                down: c.download ?? 0,
                start: c.start || "",
              };
            });
            resolve({
              ok: true,
              list,
              up: j.uploadTotal ?? 0,
              down: j.downloadTotal ?? 0,
              count: list.length,
            });
          } catch (e) {
            resolve({ ok: false, reason: `解析失败：${e.message}`, list: [], up: 0, down: 0 });
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: "控制接口超时", list: [], up: 0, down: 0 });
    });
    req.on("error", (e) => resolve({ ok: false, reason: e.message, list: [], up: 0, down: 0 }));
    req.end();
  });
}

/** 清空这个实例的累计流量与连接（mihomo 支持 DELETE /connections） */
function clearConnections(exitId) {
  return new Promise((resolve) => {
    const r = running.get(exitId);
    if (!r?.ctlPort) return resolve({ ok: false, reason: "实例没在运行" });
    const req = http.request(
      {
        host: "127.0.0.1",
        port: r.ctlPort,
        path: "/connections",
        method: "DELETE",
        headers: { Authorization: `Bearer ${r.secret}` },
        timeout: 4000,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ ok: res.statusCode === 204 || res.statusCode === 200 }));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: "超时" });
    });
    req.on("error", (e) => resolve({ ok: false, reason: e.message }));
    req.end();
  });
}

/** 应用退出时全停。不清理的话 mihomo 会成孤儿进程一直跑着 */
function stopAll() {
  for (const [, r] of running) {
    try {
      r.proc.kill("SIGTERM");
    } catch {
      /* 已经没了 */
    }
  }
  running.clear();
}

module.exports = {
  PORT_BASE,
  setBaseDir,
  baseDir,
  dirOf,
  isListening,
  pickPort,
  buildConfig,
  start,
  stop,
  stopAll,
  list,
  get,
  connections,
  clearConnections,
};
