/**
 * 当前是否处在 TUN（透明代理）模式 —— 只读，不发包。
 *
 * 为什么必须检测：
 *
 * 多出口隔离靠的是给每个环境注入 HTTPS_PROXY。但 TUN 模式在网络层
 * 接管整机流量（默认路由指向 utun，DNS 也可能被 fake-ip 劫持），
 * 进程级的环境变量会被绕过 —— 三个环境全走 TUN 的全局出口，
 * 界面上却仍然显示"各走各的端口"。用户配了半天发现没用，还找不到原因。
 *
 * 判定不靠猜配置文件（各家软件位置不同、可能没权限读），而是看内核状态：
 *   1. 有没有 utun 接口拿到了 198.18.0.0/15 这类 fake-ip 网段
 *   2. 默认路由是不是指向 utun
 * 两条都成立才算 TUN，避免把普通的 VPN 连接误判成代理 TUN。
 */

const { execFileSync } = require("node:child_process");
const { L } = require("./i18n.cjs");

/** utun 常见拿到的 fake-ip 段；Clash/mihomo/Surge 默认都用这几个 */
const FAKE_IP_PREFIXES = ["198.18.", "198.19.", "172.19."];

const TTL_MS = 15 * 1000;
let cached = null;
let cachedAt = 0;

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 3000 });
  } catch {
    return "";
  }
}

/**
 * 找 utun 接口上是不是挂了 fake-ip 地址。
 * ifconfig 输出形如：utun0: flags=...  inet 198.18.0.1 --> 198.18.0.1 netmask ...
 */
function findFakeIpInterface() {
  const out = sh("ifconfig", []);
  if (!out) return null;

  let cur = null;
  for (const line of out.split("\n")) {
    const iface = line.match(/^(utun\d+):/);
    if (iface) {
      cur = iface[1];
      continue;
    }
    if (!cur) continue;
    const inet = line.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (inet && FAKE_IP_PREFIXES.some((p) => inet[1].startsWith(p))) {
      return { iface: cur, ip: inet[1] };
    }
  }
  return null;
}

/**
 * 默认路由走哪个接口。
 *
 * 不能只看 `route get default` —— mihomo 的 TUN 不替换默认路由，
 * 而是塞一批更精确的分片路由（`1`、`2/7`、`4/6`、`8/7`…），
 * 这些前缀加起来覆盖整个 IPv4 空间，比 `default` 更具体，
 * 所以 `default` 仍然显示 en0，但实际流量全被 utun 吃掉。
 *
 * 正确的问法是「去一个公网地址实际走哪」，而不是「默认路由指向哪」。
 */
function routeToPublic() {
  const out = sh("route", ["-n", "get", "1.1.1.1"]);
  const iface = out.match(/interface:\s*(\S+)/)?.[1] ?? null;
  const gw = out.match(/gateway:\s*(\S+)/)?.[1] ?? null;
  return { iface, gateway: gw };
}

/** 有没有分片路由把整段 IPv4 都指向某个 utun */
function shardedRoutesVia(iface) {
  const out = sh("netstat", ["-rn", "-f", "inet"]);
  if (!out) return 0;
  let n = 0;
  for (const line of out.split("\n")) {
    if (!line.includes(iface)) continue;
    // 形如 "1  198.18.0.1  UGSc  utun0" / "2/7  198.18.0.1  UGSc  utun0"
    if (/^\s*(\d+|default)\s+\S+\s+UGSc/.test(line)) n++;
  }
  return n;
}

/**
 * 检测结果。
 *
 * active 为 true 时，多出口在进程层不成立 —— 界面必须明确说出来，
 * 而不是继续显示"这个环境走 7901"这种假象。
 */
function probe() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;

  const fake = findFakeIpInterface();
  const pub = routeToPublic();
  const shards = fake ? shardedRoutesVia(fake.iface) : 0;
  // 去公网的实际路径是 utun，或者有一堆分片路由挂在 utun 上，都算接管
  const routeViaTun = Boolean(fake) && (pub.iface === fake.iface || shards > 0);

  const result = {
    active: routeViaTun,
    iface: fake?.iface ?? null,
    ip: fake?.ip ?? null,
    publicRoute: pub.iface,
    shards,
    /** 有 utun 但流量没走它 —— 只是连了 VPN，或者 TUN 刚开还没接管 */
    partial: Boolean(fake) && !routeViaTun,
    reason: null,
    at: now,
  };

  if (result.active) {
    result.reason = L(
      `整机流量正被 ${fake.iface}（${fake.ip}）接管。这个模式下进程级的代理变量会被绕过 —— 给每个环境配的端口不会生效，所有环境实际都走同一条出口。要用多出口，请在代理软件里关掉 TUN / 增强模式，改用系统代理。`,
      `All traffic is captured by ${fake.iface} (${fake.ip}). In this mode per-process proxy variables are bypassed — the ports you set per environment have no effect, and every environment uses the same exit. Turn off TUN / enhanced mode in your proxy app and use system proxy instead.`,
    );
  } else if (result.partial) {
    result.reason = L(
      `${fake.iface} 存在（${fake.ip}），但流量没走它 —— 可能只是连了 VPN。这种情况下代理变量仍然生效。`,
      `${fake.iface} exists (${fake.ip}) but traffic does not use it — you may just be on a VPN. Proxy variables still work in this case.`,
    );
  }

  cached = result;
  cachedAt = now;
  return result;
}

module.exports = { probe };
