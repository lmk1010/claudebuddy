/**
 * 本机的网络泄漏面 —— 被动看 socket，不发任何请求。
 *
 * 为什么需要这个：
 *
 * 出口隔离建立在 HTTPS_PROXY 上，而代理只覆盖 TCP。STUN 走 UDP，
 * 谁都不代理它。Chromium 系的客户端（Claude Desktop、以及本应用自己）
 * 默认允许 WebRTC 用非代理 UDP 去 stun.l.google.com 问一句"我的公网 IP 是多少"，
 * 而那个 IP 是整机的真实出口 —— 不管给每个环境配了什么代理，它都一样。
 *
 * 两个环境各走各的代理，却因为同一个 STUN 结果暴露出同一个真实 IP，
 * 前面做的隔离等于白做。所以这里做的是：看见它有没有发生。
 *
 * 约束（跟 Desktop 探测同一套）：
 *   · 只跑 lsof / ps，不发包 —— 检测本身不能变成新的信号
 *   · 只读 socket 元信息（地址、端口），不读内容
 *   · 结果缓存，界面不会因为检测而等
 */

const { execFileSync } = require("node:child_process");

/** 常见 STUN / TURN 端口：3478/5349 是标准，19302 起是 Google 那一套 */
const STUN_PORTS = new Set([3478, 3479, 5349, 19302, 19305, 19307, 19309]);

const TTL_MS = 30 * 1000;
let cached = null;
let cachedAt = 0;

/**
 * 找出属于某个应用的进程。
 *
 * Electron 应用是一串进程（主进程 + Helper + Renderer），所以按
 * 可执行路径前缀匹配，一次全拿到。path 用完整路径，避免把
 * ClaudeBuddy 和 Claude.app 混在一起。
 */
function pidsUnder(appDir) {
  try {
    const out = execFileSync("ps", ["-Ao", "pid=,comm="], {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const pids = [];
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!m) continue;
      if (m[2].includes(appDir)) pids.push(Number(m[1]));
    }
    return pids;
  } catch {
    return [];
  }
}

/**
 * 这些进程当前的 UDP 外连。
 *
 * lsof 看到的是 socket 元信息：已 connect 的 UDP 会写成
 * `local->remote`，没连过的只有 `*:*`，后者不算泄漏（那只是绑定）。
 */
function udpFlows(pids) {
  if (pids.length === 0) return [];
  let out = "";
  try {
    out = execFileSync("lsof", ["-nP", "-iUDP", "-a", "-p", pids.join(",")], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    // lsof 在没找到任何描述符时退出码非 0，输出仍可能是空的正常情况
    out = err?.stdout ? String(err.stdout) : "";
  }

  const flows = [];
  for (const line of out.split("\n")) {
    /**
     * lsof 的列不是固定的：DEVICE / SIZE 那几列有时是空的，
     * 所以不数列表，只认“命令 空格 pid ... UDP 本地->对端”这个形状。
     */
    const m = line.match(/^(\S+)\s+(\d+)\s+.*\sUDP\s+(\S+->\S+)$/);
    if (!m) continue;
    const [, command, pid, name] = m;
    const arrow = name.split("->");
    if (arrow.length !== 2) continue; // 没有对端 = 只是绑定，没在对外发
    const remote = arrow[1];
    const port = Number(remote.slice(remote.lastIndexOf(":") + 1));
    flows.push({
      command,
      pid: Number(pid),
      local: arrow[0],
      remote,
      /** 命中 STUN 端口 = 有人在问"我的公网 IP 是多少" */
      stun: STUN_PORTS.has(port),
      /** 对端不是本机 = 真的出网了 */
      external: !/^(127\.|::1|\[::1\])/.test(arrow[1]),
    });
  }
  return flows;
}

/** 本应用自己的可执行目录 —— 用来把自己跟 Desktop 分开查 */
const SELF_DIR = "/ClaudeBuddy.app/";
const DESKTOP_DIR = "/Claude.app/";

const TARGETS = [
  { key: "self", label: "本应用", dir: SELF_DIR },
  { key: "desktop", label: "Claude Desktop", dir: DESKTOP_DIR },
];

function collect() {
  const report = [];
  for (const t of TARGETS) {
    const pids = pidsUnder(t.dir);
    const flows = udpFlows(pids).filter((f) => f.external);
    report.push({
      key: t.key,
      label: t.label,
      running: pids.length > 0,
      pids,
      flows,
      stun: flows.filter((f) => f.stun),
    });
  }
  return report;
}

function probe({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;
  const targets = collect();
  cached = {
    targets,
    /** 有任何一个目标在发 STUN */
    stunDetected: targets.some((t) => t.stun.length > 0),
    /** UDP 出网但不一定是 STUN —— QUIC、DNS 都会落在这里 */
    udpDetected: targets.some((t) => t.flows.length > 0),
    checkedAt: Date.now(),
  };
  cachedAt = Date.now();
  return cached;
}

module.exports = { probe, STUN_PORTS };