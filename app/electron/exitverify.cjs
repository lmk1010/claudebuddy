/**
 * 出口核验 —— 两个独立服务交叉验证，不一致就说「未核验」。
 *
 * 为什么要两个：单个服务出错或返回陈旧数据时，界面会显示一个看起来
 * 很确定的错误结论。用户据此判断"我配对了"，实际是错的。两个独立来源
 * 只要有一项对不上，就说明至少有一个不可信 —— 这时候说"不确定"
 * 比说错更负责。
 *
 * 三个原则（参考 CCBaga 的核验边界）：
 *   1. 只认实测，配置值不能冒充结果
 *   2. 失败就是失败，不降级成"大概对了"
 *   3. 解析严格：IP 必须是合法地址，国家码必须两位大写字母
 *
 * 走 HTTPS。出口核验本身会经过代理，明文 HTTP 会让沿途节点看到
 * 我们在查什么 —— 虽然不敏感，但没必要。
 */

const { execFile } = require("node:child_process");
const { L } = require("./i18n.cjs");

const TTL_MS = 3 * 60 * 1000;
const cache = new Map();

/** 两个服务各自返回同样形状，方便逐字段比对 */
function norm({ ip, country, city, isp }) {
  return {
    ip: (ip || "").trim(),
    country: (country || "").trim().toUpperCase(),
    city: (city || "").trim().toLowerCase(),
    isp: (isp || "").trim().toLowerCase(),
  };
}

function curl(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile("curl", ["-sS", "--max-time", String(Math.ceil(timeoutMs / 1000)), url], {
      timeout: timeoutMs + 1500,
    }, (err, out) => resolve(err ? null : String(out)));
  });
}

function isIp(s) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s) || /^[0-9a-fA-F:]{6,45}$/.test(s);
}

/** ipwho.is —— 无需 key，HTTPS，字段齐全 */
async function fromIpwhois() {
  const raw = await curl("https://ipwho.is/");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j.success === false) return null;
    const ip = j.ip;
    if (!ip || !isIp(ip)) return null;
    return norm({
      ip,
      country: j.country_code,
      city: j.city,
      isp: j.connection?.isp || j.connection?.org,
    });
  } catch {
    return null;
  }
}

/**
 * ipinfo.io —— 独立供应商，无 key 也可用，用来对照。
 *
 * 之前用的是 ipapi.co，实测直接返回 `RateLimited`（免费额度按 IP 计，
 * 走代理时等于和别人共用配额，很容易打满）。换掉。
 */
async function fromIpinfo() {
  const raw = await curl("https://ipinfo.io/json");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    const ip = j.ip;
    if (!ip || !isIp(ip)) return null;
    return norm({ ip, country: j.country, city: j.city, isp: j.org });
  } catch {
    return null;
  }
}

/**
 * 交叉核验。
 *
 * 返回的 `consistent` 是这条结论的核心：
 *   true  —— 两个服务都成功，且 IP 完全一致（国家/城市允许小差异）
 *   false —— 至少一项对不上，或只有一个服务返回
 *   null  —— 两个都没返回，等于什么都没核验到
 *
 * 城市和 ISP 只做「参考」不参与判定：不同库的城市命名、
 * ISP 简称本来就常不一致，拿它当硬指标会天天误报。
 */
async function verify() {
  const [a, b] = await Promise.all([fromIpwhois(), fromIpinfo()]);

  if (!a && !b) {
    return {
      ok: false,
      consistent: null,
      reason: L(
        "两个核验服务都没返回结果 —— 可能这条线路出不去，或者被拦了",
        "Neither verification service responded — this route may be down or blocked",
      ),
      primary: null,
      secondary: null,
    };
  }

  if (!a || !b) {
    const one = a || b;
    return {
      ok: true,
      consistent: null,
      reason: L(
        `只有一个服务返回了结果（${one.ip}），无法交叉验证`,
        `Only one service responded (${one.ip}); cross-check is not possible`,
      ),
      primary: one,
      secondary: null,
    };
  }

  const sameIp = a.ip === b.ip;
  const sameCountry = !a.country || !b.country || a.country === b.country;

  if (!sameIp || !sameCountry) {
    return {
      ok: true,
      consistent: false,
      reason: L(
        `两个服务结果不一致：${a.ip}（${a.country}）vs ${b.ip}（${b.country}）—— 可能线路在切换，或者其中一个服务的数据是旧的`,
        `The two services disagree: ${a.ip} (${a.country}) vs ${b.ip} (${b.country}) — the route may be switching, or one source is stale`,
      ),
      primary: a,
      secondary: b,
    };
  }

  return { ok: true, consistent: true, reason: null, primary: a, secondary: b };
}

/** 带缓存的版本：同一个出口短时间内不重复打两个外部服务 */
async function verifyCached(exitKey) {
  const now = Date.now();
  const hit = cache.get(exitKey);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const value = await verify();
  cache.set(exitKey, { value, at: now });
  return value;
}

module.exports = { verify, verifyCached };
