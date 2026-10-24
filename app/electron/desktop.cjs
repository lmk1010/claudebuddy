/**
 * Claude Desktop 的本地探测。
 *
 * Desktop 不归任何环境管：它的 Cookies、Local Storage、IndexedDB、
 * Safe Storage 密钥全在 ~/Library/Application Support/Claude 里，整机一份。
 * 也就是说不管开多少个环境，只要 Desktop 开着并且登录着，它在服务端
 * 就是同一台机器上的另一个身份 —— 这条线绕不过环境隔离。
 *
 * 所以这里只做一件事：诚实地看出来它在不在、有没有登录痕迹，让用户自己决定。
 *
 * 四条硬约束：
 *   1. 不发任何网络请求 —— 探测本身不能变成新的风控信号
 *   2. 不读内容、不解密 —— 只看文件在不在、多大、什么时候动的
 *   3. security 只用不带 -w 的存在性查询 —— 不触发钥匙串授权弹窗
 *   4. 结果缓存 —— 调用方永远不会因为探测而等待
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");

const HOME = process.env.CLAUDE_BUDDY_HOME || os.homedir();
const SUPPORT_DIR = path.join(HOME, "Library", "Application Support", "Claude");
const SAFE_STORAGE_SERVICE = "Claude Safe Storage";

/** 缓存多久 —— ps 和 security 都是进程调用，不能每次渲染都跑 */
const TTL_MS = 30 * 1000;
let cached = null;
let cachedAt = 0;

function installedApp() {
  const candidates = [
    "/Applications/Claude.app",
    path.join(HOME, "Applications", "Claude.app"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * 进程是否在跑。
 *
 * 进程名必须按完整路径精确匹配：本应用自己叫 ClaudeBuddy.app，
 * 用 "包含 Claude" 去判断会把自己也算成 Desktop。
 */
function isRunning() {
  try {
    const out = execFileSync("ps", ["-Ao", "comm="], {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return out.split("\n").some((line) => /\/Claude\.app\/Contents\/MacOS\/Claude$/.test(line.trim()));
  } catch {
    return false;
  }
}

/**
 * Safe Storage 密钥在不在。
 *
 * 这条只有 Desktop 真的启动过、并且加密过数据才会存在。
 * 查询不带 -w：不解密、不弹授权框，只问有没有。
 */
function hasSafeStorage() {
  const r = spawnSync("security", ["find-generic-password", "-s", SAFE_STORAGE_SERVICE], {
    encoding: "utf8",
    timeout: 4000,
  });
  return r.status === 0;
}

function sizeOf(p, budget = 4 * 1024 * 1024) {
  let total = 0;
  let seen = 0;
  const walk = (dir) => {
    if (seen > budget) return;
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (seen > budget) return;
      const full = path.join(dir, e.name);
      try {
        const st = fs.statSync(full);
        seen++;
        if (st.isDirectory()) walk(full);
        else total += st.size;
      } catch {
        /* 跳过 */
      }
    }
  };
  walk(p);
  return total;
}

/** 最近活动时间：几个关键存储文件里最新的 mtime */
function lastActive() {
  const probes = [
    "Cookies",
    "Preferences",
    path.join("Local Storage", "leveldb"),
    path.join("Session Storage"),
    "Network Persistent State",
  ];
  let newest = 0;
  for (const rel of probes) {
    try {
      const st = fs.statSync(path.join(SUPPORT_DIR, rel));
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      /* 不存在就算了 */
    }
  }
  return newest;
}

/**
 * 登录痕迹的证据强度。
 *
 * 这里不猜"登没登录"（那需要读 Cookies 或者发请求，两条都不做），
 * 只说看到了什么程度的痕迹，把判断留给用户。
 */
function signedInHint(running, safeStorage, lastAt) {
  if (running && safeStorage) return "running";
  if (running) return "running-no-key";
  if (!safeStorage) return lastAt ? "maybe" : "none";
  return Date.now() - lastAt < 30 * 86400000 ? "likely" : "stale";
}

function probe({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;

  const app = installedApp();
  const exists = fs.existsSync(SUPPORT_DIR);
  const running = app ? isRunning() : false;
  const safeStorage = hasSafeStorage();
  const lastAt = exists ? lastActive() : 0;

  cached = {
    /** 装了没有 */
    installed: Boolean(app),
    appPath: app,
    /** 现在是不是开着 */
    running,
    /** 有没有 Safe Storage 密钥（= 用过并且加密过东西） */
    hasSafeStorage: safeStorage,
    /** 存储目录在不在、多大 */
    supportDir: SUPPORT_DIR,
    exists,
    sizeBytes: exists ? sizeOf(SUPPORT_DIR) : 0,
    lastActiveAt: lastAt,
    /** none / maybe / stale / likely / running-no-key / running */
    signedIn: signedInHint(running, safeStorage, lastAt),
    checkedAt: Date.now(),
  };
  cachedAt = Date.now();
  return cached;
}

module.exports = { probe, SUPPORT_DIR, SAFE_STORAGE_SERVICE };
