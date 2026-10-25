/**
 * 代理探测 —— "帮我找到能用的小飞机"。
 *
 * 用户不知道自己的代理端口是 7890 还是 1080，也不知道能不能通。
 * 这个模块做三件事：
 *   1. 读 macOS 系统代理设置（Clash / Surge / V2Ray 装上后都会写这里）
 *   2. 扫常见本地端口，看谁在监听
 *   3. 每个候选都真发一次请求，能通的才算数
 *
 * 只返回测通的候选，测不通的不进列表 —— 免得用户选了一个用不了的。
 */

const { execFile } = require("node:child_process");
const net = require("node:net");
const { L } = require("./i18n.cjs");

/** 常见代理端口 + 它们通常是哪种协议 */
const COMMON = [
  { port: 7890, protocol: "http", label: "Clash" },
  { port: 7891, protocol: "socks5", label: "Clash (SOCKS)" },
  { port: 7897, protocol: "http", label: "Clash Verge" },
  { port: 1080, protocol: "socks5", get label() { return L("V2Ray / 通用 SOCKS", "V2Ray / generic SOCKS"); } },
  { port: 1081, protocol: "socks5", label: "V2Ray" },
  { port: 1087, protocol: "http", label: "V2RayN" },
  { port: 6152, protocol: "http", label: "Surge" },
  { port: 6153, protocol: "http", label: "Surge" },
  { port: 8888, protocol: "http", get label() { return L("Charles / 通用", "Charles / generic"); } },
  { port: 8080, protocol: "http", get label() { return L("通用 HTTP", "Generic HTTP"); } },
  { port: 8118, protocol: "http", label: "Privoxy" },
  { port: 9090, protocol: "http", get label() { return L("通用", "Generic"); } },
];

/**
 * 读取 macOS 系统代理。
 *
 * 注意 scutil 输出的键顺序是 Port 在 Proxy 之前，而且格式是
 * "  HTTPPort : 7890" 这种带空格的，所以逐行解析比正则跨行可靠。
 */
function readSystemProxy() {
  return new Promise((resolve) => {
    execFile("scutil", ["--proxy"], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);

      const map = {};
      for (const line of String(stdout).split("\n")) {
        const m = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
        if (m) map[m[1]] = m[2];
      }

      const out = [];
      const add = (enableKey, hostKey, portKey, protocol, label) => {
        if (map[enableKey] !== "1") return;
        const host = map[hostKey];
        const port = Number(map[portKey]);
        if (!host || !port) return;
        if (out.some((o) => o.host === host && o.port === port)) return;
        out.push({ host, port, protocol, label });
      };

      add("HTTPSEnable", "HTTPSProxy", "HTTPSPort", "http", L("系统代理", "System proxy"));
      add("HTTPEnable", "HTTPProxy", "HTTPPort", "http", L("系统代理", "System proxy"));
      add("SOCKSEnable", "SOCKSProxy", "SOCKSPort", "socks5", L("系统 SOCKS", "System SOCKS"));

      resolve(out);
    });
  });
}

/** 端口在不在监听 */
function isListening(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(700);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

/**
 * 真发一次请求，确认这个代理能用。
 *
 * 这是唯一可信的判据：端口开着不代表能出网（可能是别的服务），
 * 公司代理可能还要认证。所以必须实际走一次。
 */
/**
 * 端口在不在监听。
 *
 * 用来把"失败"分成两种，因为处理方式完全不同：
 *   · 端口没开 → 代理软件没运行，或者没配这个 listener
 *   · 端口开着但出不去 → 线路挂了 / 节点不通 / 要认证
 * 只说"连不上"等于什么都没说。
 */
function portOpen(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

function testProxy(proxy, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url =
      proxy.protocol === "socks5"
        ? `socks5://${proxy.host}:${proxy.port}`
        : `http://${proxy.host}:${proxy.port}`;

    execFile(
      "curl",
      ["-sS", "--max-time", String(Math.ceil(timeoutMs / 1000)), "-x", url, "https://api.ipify.org?format=json"],
      { timeout: timeoutMs + 2000 },
      async (err, stdout) => {
        if (err) {
          const open = await portOpen(proxy.host, proxy.port);
          return resolve({
            ok: false,
            reason: open
              ? L(
                  `${proxy.host}:${proxy.port} 端口开着，但连不上外网 —— 线路挂了，或者这个端口没绑到可用节点`,
                  `${proxy.host}:${proxy.port} is listening but cannot reach the internet — the route is down, or this port is not bound to a working node`,
                )
              : L(
                  `${proxy.host}:${proxy.port} 端口没开 —— 代理软件没运行，或者没配这个 listener`,
                  `${proxy.host}:${proxy.port} is not listening — the proxy app is not running, or this listener is not configured`,
                ),
          });
        }
        try {
          const j = JSON.parse(String(stdout));
          if (j.ip) return resolve({ ok: true, ip: j.ip });
        } catch {
          /* 走到下面 */
        }
        resolve({ ok: false, reason: L("返回格式不对", "Unexpected response format") });
      },
    );
  });
}

/**
 * 探测全套。
 *
 * @param {object} current 当前环境已配置的代理（优先测它）
 */
async function discoverProxies(current) {
  const candidates = [];
  const seen = new Set();
  const push = (p) => {
    const key = `${p.host}:${p.port}:${p.protocol}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(p);
  };

  // 1. 用户已配的那个先测
  if (current && current.protocol !== "none" && current.host && current.port) {
    push({ ...current, label: L("当前配置", "Current setting"), from: "current" });
  }

  // 2. 系统代理
  for (const p of await readSystemProxy()) push({ ...p, from: "system" });

  // 3. 常见端口里真正在监听的
  const listening = await Promise.all(
    COMMON.map(async (c) => ({ ...c, up: await isListening(c.port) })),
  );
  for (const c of listening) {
    if (!c.up) continue;
    push({ host: "127.0.0.1", port: c.port, protocol: c.protocol, label: c.label, from: "scan" });
  }

  if (candidates.length === 0) return [];

  // 4. 并发实测，只留通的
  const tested = await Promise.all(
    candidates.map(async (c) => {
      const r = await testProxy({ host: c.host, port: c.port, protocol: c.protocol });
      return { ...c, ok: r.ok, ip: r.ip ?? null, reason: r.reason ?? null };
    }),
  );

  // 通的排前面，系统代理优先
  const weight = (c) => (c.ok ? 0 : 10) + (c.from === "system" ? 0 : c.from === "current" ? 1 : 2);
  tested.sort((a, b) => weight(a) - weight(b));

  return tested;
}

/** 直连（不走代理）的出口 IP —— 用来跟代理出口对比 */
function testDirect() {
  return new Promise((resolve) => {
    execFile(
      "curl",
      ["-sS", "--max-time", "8", "https://api.ipify.org?format=json"],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const j = JSON.parse(String(stdout));
          resolve(j.ip ?? null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

module.exports = { discoverProxies, testProxy, testDirect, readSystemProxy, isListening };
