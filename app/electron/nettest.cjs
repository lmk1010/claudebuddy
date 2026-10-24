/**
 * 网络测试 —— 给 Claude Code 用的专业版连通测试。
 *
 * 跟「出口体检」不同，这里不看 IP 干不干净，看的是「线路本身」：
 *   1. 每个 Claude 相关域名分阶段计时：DNS → TCP → TLS → 首字节 → 总计，连测 N 次算均值 / 抖动 / 失败率
 *   2. DNS：系统解析结果 vs DoH（Cloudflare）结果，看有没有被污染、是不是代理软件的 fake-ip
 *   3. 本机网络形态：系统代理、进程里的代理环境变量、TUN 模式迹象、IPv6 是否可用
 *   4. 两种出口：本机直连出口、所选环境（走它的代理）的出口
 *
 * 所有数字都来自 curl 的 -w 计时和真实请求，不估算、不编。
 */
const { execFile } = require("node:child_process");
const dns = require("node:dns");
const { L } = require("./i18n.cjs");

/** 要测的目标：Claude Code 实际会连的域名 */
const TARGETS = [
  { id: "api", host: "api.anthropic.com", url: "https://api.anthropic.com/", get role() { return L("模型 API（对话、补全都走这里）", "Model API (chat and completions)"); } },
  { id: "web", host: "claude.ai", url: "https://claude.ai/cdn-cgi/trace", get role() { return L("登录授权、网页", "Sign-in authorization, web"); } },
  { id: "console", host: "console.anthropic.com", url: "https://console.anthropic.com/", get role() { return L("OAuth 回调、账号", "OAuth callback, account"); } },
  { id: "dist", host: "storage.googleapis.com", url: "https://storage.googleapis.com/", get role() { return L("Claude Code 安装包 / 自动更新", "Claude Code installer / auto-update"); } },
  { id: "status", host: "status.claude.com", url: "https://status.claude.com/api/v2/status.json", get role() { return L("官方状态页", "Official status page"); } },
];

const FMT = "%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{http_code} %{remote_ip} %{ssl_verify_result} %{http_version}";

function curlTime(url, proxy, timeout = 10) {
  const args = ["-sS", "-o", "/dev/null", "--max-time", String(timeout), "-w", FMT];
  if (proxy) args.push("-x", proxy);
  else args.push("--noproxy", "*");
  args.push(url);
  return new Promise((resolve) => {
    execFile("curl", args, { timeout: (timeout + 2) * 1000 }, (err, out, stderr) => {
      const p = String(out || "").trim().split(" ");
      const code = Number(p[5]);
      if (!code) return resolve({ ok: false, error: String(stderr || err?.message || L("失败", "Failed")).trim().split("\n")[0].replace(/^curl: \(\d+\) /, "") });
      const s = (i) => Math.round(Number(p[i]) * 1000);
      resolve({
        ok: true,
        dns: s(0),
        tcp: Math.max(0, s(1) - s(0)),
        tls: Math.max(0, s(2) - s(1)),
        ttfb: Math.max(0, s(3) - s(2)),
        total: s(4),
        connectAt: s(1),
        code,
        remoteIp: p[6] || "",
        tlsOk: p[7] === "0",
        http: p[8] || "",
      });
    });
  });
}

function avg(xs) {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

/** 抖动：相邻两次总耗时之差的平均（RFC 3550 的简化） */
function jitter(xs) {
  if (xs.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < xs.length; i++) d += Math.abs(xs[i] - xs[i - 1]);
  return Math.round(d / (xs.length - 1));
}

async function probeTarget(t, proxy, rounds) {
  const runs = [];
  // 串行跑：并发会互相抢带宽，抖动就不准了
  for (let i = 0; i < rounds; i++) runs.push(await curlTime(t.url, proxy));
  const ok = runs.filter((r) => r.ok);
  const pick = (k) => avg(ok.map((r) => r[k]));
  return {
    ...t,
    rounds,
    okCount: ok.length,
    loss: Math.round(((rounds - ok.length) / rounds) * 100),
    dns: pick("dns"),
    tcp: pick("tcp"),
    tls: pick("tls"),
    ttfb: pick("ttfb"),
    total: pick("total"),
    min: ok.length ? Math.min(...ok.map((r) => r.total)) : 0,
    max: ok.length ? Math.max(...ok.map((r) => r.total)) : 0,
    jitter: jitter(ok.map((r) => r.total)),
    code: ok[ok.length - 1]?.code ?? 0,
    remoteIp: ok[ok.length - 1]?.remoteIp ?? "",
    tlsOk: ok.length ? ok.every((r) => r.tlsOk) : null,
    http: ok[ok.length - 1]?.http ?? "",
    connectAt: pick("connectAt"),
    error: ok.length ? null : runs[0]?.error ?? L("连不上", "Unable to connect"),
  };
}

/** 系统解析器的结果 */
function sysResolve(host) {
  return new Promise((resolve) => {
    dns.lookup(host, { all: true }, (err, addrs) => resolve(err ? [] : addrs.map((a) => a.address)));
  });
}

/**
 * DoH 的结果（走同一条线路，看「干净」的解析是什么）。
 * 先 Google，再 Cloudflare —— 实测有的网络会直接 reset cloudflare-dns.com。
 */
async function dohResolve(host, proxy) {
  const servers = [
    `https://dns.google/resolve?name=${host}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${host}&type=A`,
  ];
  for (const url of servers) {
    const args = ["-sS", "--max-time", "6", "-H", "accept: application/dns-json"];
    if (proxy) args.push("-x", proxy);
    else args.push("--noproxy", "*");
    args.push(url);
    const r = await new Promise((resolve) => {
      execFile("curl", args, { timeout: 8000 }, (err, out) => {
        try {
          const j = JSON.parse(out);
          resolve({ via: url.includes("google") ? "Google" : "Cloudflare", ips: (j.Answer || []).filter((a) => a.type === 1).map((a) => a.data) });
        } catch {
          resolve(null);
        }
      });
    });
    if (r) return r;
  }
  return null;
}

/** 198.18.0.0/15 是 Clash / Surge 等 fake-ip 模式专用的段 */
function isFakeIp(ip) {
  return /^198\.(18|19)\./.test(ip);
}
/** 私有 / 保留地址：正经域名不该解析到这里 */
function isBogus(ip) {
  return /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

function systemProxy() {
  return new Promise((resolve) => {
    execFile("scutil", ["--proxy"], { timeout: 4000 }, (err, out) => {
      if (err) return resolve(null);
      const g = (k) => (String(out).match(new RegExp(`${k} : (\\S+)`)) || [])[1];
      const r = [];
      if (g("HTTPSEnable") === "1") r.push({ kind: "HTTPS", addr: `${g("HTTPSProxy")}:${g("HTTPSPort")}` });
      if (g("HTTPEnable") === "1") r.push({ kind: "HTTP", addr: `${g("HTTPProxy")}:${g("HTTPPort")}` });
      if (g("SOCKSEnable") === "1") r.push({ kind: "SOCKS", addr: `${g("SOCKSProxy")}:${g("SOCKSPort")}` });
      if (g("ProxyAutoConfigEnable") === "1") r.push({ kind: "PAC", addr: g("ProxyAutoConfigURLString") || "" });
      resolve(r);
    });
  });
}

function exitIp(proxy, v6 = false) {
  const args = ["-sS", "--max-time", "6"];
  if (v6) args.push("-6");
  if (proxy) args.push("-x", proxy);
  else args.push("--noproxy", "*");
  args.push(v6 ? "https://api64.ipify.org" : "https://api.ipify.org");
  return new Promise((resolve) => {
    execFile("curl", args, { timeout: 8000 }, (err, out) => resolve(err ? null : String(out).trim() || null));
  });
}

/**
 * 跑一轮完整测试。
 * @param {{ proxy: string|null, label: string, rounds?: number }} route
 */
async function run(route) {
  const proxy = route.proxy || null;
  const rounds = route.rounds || 4;
  const started = Date.now();

  const [targets, sysProxy, exitDirect, exitRoute, v6, dnsRows] = await Promise.all([
    // 目标之间也串行，理由同上
    (async () => {
      const out = [];
      for (const t of TARGETS) out.push(await probeTarget(t, proxy, rounds));
      return out;
    })(),
    systemProxy(),
    exitIp(null),
    proxy ? exitIp(proxy) : Promise.resolve(null),
    exitIp(null, true),
    Promise.all(
      TARGETS.slice(0, 3).map(async (t) => {
        const [sys, doh] = await Promise.all([sysResolve(t.host), dohResolve(t.host, proxy)]);
        const fake = sys.some(isFakeIp);
        const bogus = sys.some(isBogus);
        const d = doh?.ips ?? null;
        const v4 = sys.filter((s) => s.includes("."));
        // 只有在不是 fake-ip、且两边都有结果、且完全没有交集时才算「对不上」——
        // CDN 本来就会按地区给不同 IP，有交集或同网段都算正常
        const sameNet = (a, b) => a.split(".").slice(0, 2).join(".") === b.split(".").slice(0, 2).join(".");
        const mismatch = !fake && d && d.length && v4.length && !v4.some((s) => d.some((x) => x === s || sameNet(x, s)));
        return { host: t.host, sys, doh: d, dohVia: doh?.via ?? null, fake, bogus, mismatch: Boolean(mismatch) };
      }),
    ),
  ]);

  const procProxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
    .filter((k) => process.env[k])
    .map((k) => ({ key: k, value: process.env[k] }));

  // TUN 迹象：直连模式下，到海外服务器的 TCP 握手 < 3ms，物理上不可能 —— 说明被本机虚拟网卡接管了
  const api = targets[0];
  const tunLikely = !proxy && api.okCount > 0 && api.connectAt - api.dns < 3;
  const fakeIp = dnsRows.some((d) => d.fake);

  return {
    ok: true,
    at: Date.now(),
    tookMs: Date.now() - started,
    route: { label: route.label, proxy },
    rounds,
    targets,
    dns: dnsRows,
    local: {
      systemProxy: sysProxy,
      processProxy: procProxy,
      tunLikely,
      fakeIp,
      ipv6: v6,
    },
    exits: { direct: exitDirect, route: exitRoute },
  };
}

module.exports = { run, TARGETS };
