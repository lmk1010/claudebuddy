/**
 * ClaudeBuddy · 账号与隔离核心
 *
 * 这个文件是"隔离"这件事唯一的实现处。渲染层只能按 id 引用账号，
 * 它拿不到目录、拿不到环境变量、也改不了 —— 否则隔离就只是约定。
 *
 * 依据（详见 docs/RISK-MODEL.md）：
 *   · userID == 遥测 device_id，331/331 实证相等；machineID 同构。
 *   · Keychain 是「Claude Code-credentials」+「-<8位hex>」两组条目。
 *   · 项目目录名把所有 / 和 . 换成 -，无法无损还原。
 *   · 出口 IP / cf_ray 是风控里换不掉的关联线，所以代理必须账号级固定。
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile, spawnSync } = require("node:child_process");
const { L } = require("./i18n.cjs");

const HOME = process.env.CLAUDE_BUDDY_HOME || os.homedir();

/** 配置目录白名单：只允许 ~/ 下的单层 .claude 开头目录 */
const CONFIG_DIR_RE = /^\.claude(-[a-z0-9-]+)?$/;

/** 主进程持有的账号定义 —— 渲染层只能按 id 引用 */
let accounts = [];

/** 启动时从磁盘读回来，之后每次改动都回写 */
function setAccounts(list) {
  accounts = (Array.isArray(list) ? list : []).filter(
    (a) => a && typeof a.configDir === "string" && CONFIG_DIR_RE.test(a.configDir),
  );
}

function getAccounts() {
  return accounts;
}

function findAccount(id) {
  return accounts.find((a) => a.id === id) || null;
}

function configDirOf(account) {
  // 目录只在这里产生：渲染层永远传不进一个绝对路径来
  return path.join(HOME, account.configDir);
}

// ─────────────────────────────────────────── 跨进程调用 claude

/** 调 claude CLI，带超时。返回 { code, stdout, stderr } */
function runClaude(args, env, timeout = 12000, cwd) {
  return new Promise((resolve) => {
    execFile(
      "claude",
      args,
      {
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ...env },
        cwd: cwd || HOME,
      },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          stdout: stdout || "",
          stderr: stderr || "",
          timedOut: err?.killed || false,
        });
      },
    );
  });
}

/**
 * 这个账号的环境变量。
 *
 * 隔离的关键：清掉一切可能把两个账号串起来的继承变量，
 * 再显式设置 CLAUDE_CONFIG_DIR 和出口代理。
 */
function envForAccount(account, { includeProxy = true } = {}) {
  const env = { ...process.env };

  // 继承来的凭据会把账号指错 —— 必须先清
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.HTTPS_PROXY;
  delete env.HTTP_PROXY;
  delete env.https_proxy;
  delete env.http_proxy;
  delete env.ALL_PROXY;
  delete env.all_proxy;
  delete env.NO_PROXY;
  delete env.no_proxy;

  /**
   * 默认环境（~/.claude）不能显式设 CLAUDE_CONFIG_DIR：只要设了，CLI 就去找
   * 带哈希后缀的 Keychain 条目，读不到主条目里的凭据，明明登录着却报「未登录」。
   * 不设时 CLI 默认就用 ~/.claude，结果一样。
   */
  if (account.configDir !== ".claude") env.CLAUDE_CONFIG_DIR = configDirOf(account);

  /**
   * 终端画像：这三项会进 Claude Code 的 env 上报（terminal / lang / 时区）。
   * 同一台机器上内核和架构换不掉，但终端类型、语言、时区是可以拉开差距的，
   * 所以让每个环境自己配，默认值只作兜底。
   */
  const t = account.terminal || {};
  env.TERM = t.term || "xterm-256color";
  env.COLORTERM = "truecolor";
  env.LANG = t.lang || "en_US.UTF-8";
  env.LC_ALL = env.LANG;
  env.TZ = t.tz || "Asia/Shanghai";

  env.CLAUDE_BUDDY = "1";

  if (includeProxy) {
    const p = account.proxy || {};
    if (p.protocol && p.protocol !== "none" && p.host && p.port) {
      const auth =
        p.username || p.password
          ? `${encodeURIComponent(p.username || "")}:${encodeURIComponent(p.password || "")}@`
          : "";
      const url = `${p.protocol}://${auth}${p.host}:${p.port}`;
      // 大小写两套都设：Claude Code 两种都读（源码里 http_proxy || HTTP_PROXY）
      env.HTTPS_PROXY = url;
      env.HTTP_PROXY = url;
      env.https_proxy = url;
      env.http_proxy = url;
      env.NO_PROXY = p.noProxy || "localhost,127.0.0.1,::1";
      env.no_proxy = env.NO_PROXY;
    }
  }

  return env;
}

/** 确保配置目录存在 */
function ensureConfigDir(account) {
  const dir = configDirOf(account);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// ─────────────────────────────────────────── 登录状态

/**
 * 读真实登录态。这是唯一可信来源 —— 不看本地文件猜，
 * 直接问 CLI，因为它才真正知道凭据还有效没有。
 */
async function readAuthStatus(account) {
  const dir = configDirOf(account);
  if (!fs.existsSync(dir)) {
    return { auth: "signedOut", email: null, accountUuid: null, orgUuid: null, tier: null };
  }

  const r = await runClaude(["auth", "status", "--json"], envForAccount(account), 10000);
  let j = null;
  try {
    j = JSON.parse(r.stdout.trim());
  } catch {
    // CLI 没装或输出不是 JSON
    return { auth: "unknown", email: null, accountUuid: null, orgUuid: null, tier: null };
  }

  if (!j.loggedIn) {
    // 目录里有凭据文件但 CLI 说没登录 → 凭据失效
    const hasCreds = fs.existsSync(path.join(dir, "credentials.json"));
    // 未登录也要把已知档案读出来：用户需要看见"这是哪个账号，只是掉了登录"
    const known = readOAuthAccount(account);
    return {
      auth: hasCreds ? "expired" : "signedOut",
      email: known?.emailAddress ?? null,
      accountUuid: known?.accountUuid ?? null,
      orgUuid: known?.organizationUuid ?? null,
      tier: known?.organizationRateLimitTier ?? null,
    };
  }

  // 登录后 oauthAccount 在 ~/.claude.json（可能在配置目录里，也可能是 home 那份）
  const oa = readOAuthAccount(account);
  return {
    auth: "signedIn",
    email: oa?.emailAddress ?? null,
    accountUuid: oa?.accountUuid ?? null,
    orgUuid: oa?.organizationUuid ?? null,
    tier: oa?.organizationRateLimitTier ?? null,
  };
}

/**
 * 读账号档案。Claude Code 把 oauthAccount 写在 `${CLAUDE_CONFIG_DIR}/.claude.json`；
 * 老版本写在 ~/.claude.json。两处都看，配置目录优先。
 */
function readOAuthAccount(account) {
  const candidates = [
    path.join(configDirOf(account), ".claude.json"),
    path.join(HOME, ".claude.json"),
  ];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (j && j.oauthAccount && j.oauthAccount.emailAddress) {
        // 只有当它确实是这个账号的才返回：用 userID 归属做交叉校验
        if (account.configDir !== ".claude" && p === path.join(HOME, ".claude.json")) {
          continue;
        }
        return j.oauthAccount;
      }
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

// ─────────────────────────────────────────── 身份

function identityFile(account) {
  return path.join(configDirOf(account), ".claude.json");
}

/** 读现有身份；没有就返回 null（不生成，交给 CLI 自己生成） */
function readIdentity(account) {
  try {
    const j = JSON.parse(fs.readFileSync(identityFile(account), "utf8"));
    const hex = /^[0-9a-f]{64}$/;
    return {
      userID: hex.test(j.userID) ? j.userID : null,
      machineID: hex.test(j.machineID) ? j.machineID : null,
    };
  } catch {
    return { userID: null, machineID: null };
  }
}

/**
 * 轮换身份。
 *
 * 只改 userID / machineID，并删掉 summonSidKey / remoteControlMachineId
 * 让它们下次按需重新生成。**不动 oauthAccount** —— 那是账号身份，
 * 删了等于掉登录，而且它本来就换不掉。
 *
 * 调用前必须确保该账号没有跑着的进程，否则会被写回去。
 */
function rotateIdentity(account) {
  const file = identityFile(account);
  let data = {};
  let existed = false;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
    existed = true;
  } catch {
    data = {};
  }

  // 备份一份，出问题能回滚
  if (existed) {
    try {
      fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
    } catch {
      /* 备份失败不阻断 */
    }
  }

  const userID = crypto.randomBytes(32).toString("hex");
  const machineID = crypto.randomBytes(32).toString("hex");
  data.userID = userID;
  data.machineID = machineID;
  delete data.summonSidKey;
  delete data.remoteControlMachineId;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });

  return { userID, machineID };
}

// ─────────────────────────────────────────── 网络出口

/**
 * 检测出口 IP。
 *
 * 走的是**和 Claude Code 完全相同的环境变量**，所以测到的就是这个
 * 账号真正会用的出口 —— 否则测出来的数是假的，比不测更糟。
 *
 * 用两个来源交叉：失败一个还有一个，都失败就返回 null 让界面显示「—」。
 */
async function checkExitIp(account) {
  const env = envForAccount(account);
  const urls = ["https://api.ipify.org?format=json", "https://ifconfig.co/json"];

  for (const url of urls) {
    const r = await new Promise((resolve) => {
      execFile(
        "curl",
        ["-sS", "--max-time", "8", "-x", proxyOrNothing(account), url].filter(Boolean),
        { timeout: 10000, env },
        (err, stdout) => resolve(err ? null : stdout),
      );
    }).catch(() => null);

    if (!r) continue;
    try {
      const j = JSON.parse(r);
      const ip = j.ip || j.address;
      if (ip) {
        return { ip, source: url.includes("ipify") ? "ipify" : "ifconfig", at: Date.now() };
      }
    } catch {
      /* 换下一个源 */
    }
  }
  return null;
}

/** curl 需要显式 -x，环境变量对它不是全覆盖 */
function proxyOrNothing(account) {
  const p = account.proxy || {};
  if (!p.protocol || p.protocol === "none" || !p.host || !p.port) return null;
  const auth =
    p.username || p.password
      ? `${encodeURIComponent(p.username || "")}:${encodeURIComponent(p.password || "")}@`
      : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

// ─────────────────────────────────────────── 环境画像

/**
 * 采集环境画像。
 *
 * 报告结论：uname 画像是一条换不掉的关联线。这里记录它，
 * 是为了在界面上诚实地告诉用户"这两个账号看起来有多像"，
 * 而不是假装能把它改掉。
 */
function collectProfile(account) {
  const uname = os;
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: uname.release(),
    shell: path.basename(process.env.SHELL || "/bin/zsh"),
    terminal: process.env.TERM || "xterm-256color",
    repoHashes: [],
    capturedAt: Date.now(),
  };
}

/**
 * git remote 哈希 —— 报告里点名的最隐蔽关联线。
 * 同一个仓库在不同机器上得到同一个哈希，所以它能把两个账号串起来。
 */
function remoteHashOf(cwd) {
  try {
    const out = require("node:child_process")
      .execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .toString()
      .trim();
    if (!out) return null;
    return crypto.createHash("sha256").update(out).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────── 痕迹统计

function dirSize(dir, budget) {
  let total = 0;
  const stack = [dir];
  while (stack.length && total < budget) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (total >= budget) break;
      const p = path.join(cur, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) total += fs.statSync(p).size;
      } catch {
        /* 忽略 */
      }
    }
  }
  return total;
}

/**
 * 一个账号的痕迹清单 —— 按报告里的"清理工具目标面"逐项给出。
 * 这不是估算，每一条都 stat 过。
 */
/**
 * 痕迹清单 —— key 是稳定标识，path 是实际磁盘路径。
 * 清理时按 key 查回 path，两边用同一张表，避免"界面能勾但清不掉"。
 */
const TRACE_ITEMS = [
  { key: "projects", get label() { return L("对话记录", "Conversation history"); }, path: "projects", critical: true },
  { key: "fileHistory", get label() { return L("文件历史快照", "File history snapshots"); }, path: "file-history", critical: true },
  { key: "history", get label() { return L("输入历史", "Input history"); }, path: "history.jsonl", critical: true },
  { key: "telemetry", get label() { return L("遥测事件", "Telemetry events"); }, path: "telemetry", critical: true },
  { key: "stats", get label() { return L("行为画像", "Usage profile"); }, path: "stats-cache.json", critical: false },
  { key: "identity", get label() { return L("身份文件", "Identity file"); }, path: ".claude.json", critical: true },
  { key: "credentials", get label() { return L("登录凭据", "Sign-in credentials"); }, path: "credentials.json", critical: true },
  { key: "uploads", get label() { return L("上传文件", "Uploaded files"); }, path: "uploads", critical: false },
  { key: "pasteCache", get label() { return L("粘贴缓存", "Paste cache"); }, path: "paste-cache", critical: false },
  { key: "backups", get label() { return L("配置备份", "Config backups"); }, path: "backups", critical: false },
  { key: "shellSnapshots", get label() { return L("shell 快照", "Shell snapshots"); }, path: "shell-snapshots", critical: false },
  { key: "plugins", get label() { return L("插件", "Plugins"); }, path: "plugins", critical: false },
];

function inspectTraces(account) {
  const dir = configDirOf(account);

  return TRACE_ITEMS.map((it) => {
    const full = path.join(dir, it.path);
    let exists = false;
    let size = 0;
    let count = 0;
    try {
      const st = fs.statSync(full);
      exists = true;
      if (st.isDirectory()) {
        size = dirSize(full, 8 * 1024 * 1024);
        count = fs.readdirSync(full).length;
      } else {
        size = st.size;
        count = 1;
      }
    } catch {
      exists = false;
    }
    return { ...it, exists, size, count };
  });
}

// ─────────────────────────────────────────── Keychain

/**
 * 枚举 Claude Code 的 Keychain 条目。
 *
 * 报告里的关键发现：主条目 + 每个配置目录一个 8 位 hex 后缀条目，
 * 所以任何清理都必须按前缀枚举，不能硬编码服务名 —— 否则旧 token 残留。
 */
function listKeychainEntries() {
  return new Promise((resolve) => {
    execFile("security", ["dump-keychain"], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const out = [];
      const blocks = stdout.split("keychain:");
      for (const b of blocks) {
        const svce = b.match(/"svce"<blob>="([^"]*)"/);
        const acct = b.match(/"acct"<blob>="([^"]*)"/);
        if (!svce) continue;
        if (!svce[1].startsWith("Claude Code-credentials")) continue;
        out.push({ service: svce[1], account: acct ? acct[1] : null });
      }
      // 去重
      const seen = new Set();
      return resolve(out.filter((e) => (seen.has(e.service) ? false : seen.add(e.service))));
    });
  });
}

/** 判断某条 Keychain 是否属于这个账号（后缀 = 配置目录派生的 8 位 hex） */
function keychainSuffixFor(account) {
  if (account.configDir === ".claude") return null; // 主条目
  /**
   * 后缀是 **完整绝对路径** 的 sha256 前 8 位，不是目录名。
   * 用目录名算出来的值跟 CLI 实际写入的条目对不上 ——
   * 结果就是"看得见账号、却读不到也续不了它的凭据"。
   */
  return crypto
    .createHash("sha256")
    .update(configDirOf(account))
    .digest("hex")
    .slice(0, 8);
}

/** Keychain 里这条凭据的 service 名 */
function keychainServiceFor(account) {
  const suffix = keychainSuffixFor(account);
  return suffix ? `Claude Code-credentials-${suffix}` : "Claude Code-credentials";
}

/** 读凭据 JSON。读不到返回 null，不抛。 */
function readCredential(account) {
  const svc = keychainServiceFor(account);
  const r = spawnSync("security", ["find-generic-password", "-s", svc, "-w"], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/** 写回凭据。调用方负责确保结构完整。 */
function writeCredential(account, full) {
  const svc = keychainServiceFor(account);
  const r = spawnSync(
    "security",
    ["add-generic-password", "-U", "-s", svc, "-a", os.userInfo().username, "-w", JSON.stringify(full)],
    { encoding: "utf8" }
  );
  return r.status === 0;
}

/**
 * access token 快过期或已过期时主动续期。
 *
 * 为什么必须自己做：CLI 只在真正发请求撞上 401 时才刷新，而一个闲置的
 * 环境会一直挂着过期的 token。用户下次打开会话就是一句 401，
 * 看起来像"号又掉了"，其实只是没人去续。
 *
 * 提前 2 分钟续，避免刚好卡在边界上。
 */
async function refreshTokenIfNeeded(account, { force = false } = {}) {
  const full = readCredential(account);
  if (!full || !full.claudeAiOauth) {
    return { ok: false, reason: L("没有可读的凭据", "No readable credentials") };
  }
  const o = full.claudeAiOauth;
  const exp = Number(o.expiresAt || 0);
  const now = Date.now();
  if (!force && exp - now > 2 * 60 * 1000) {
    return { ok: true, refreshed: false, expiresAt: exp };
  }
  if (!o.refreshToken) {
    return { ok: false, reason: L("没有 refresh token，需要重新登录", "No refresh token; sign in again") };
  }

  const body = JSON.stringify({
    grant_type: "refresh_token",
    refresh_token: o.refreshToken,
    client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  });

  const json = await new Promise((resolve) => {
    const req = require("node:https").request(
      "https://platform.claude.com/v1/oauth/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "claude-cli/2.1.309 (external, cli)",
        },
        timeout: 15000,
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return resolve({ ok: false, reason: `${res.statusCode}: ${buf.slice(0, 200)}` });
          }
          try {
            resolve({ ok: true, data: JSON.parse(buf) });
          } catch {
            resolve({ ok: false, reason: L("返回不是 JSON", "Response is not JSON") });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: L("超时", "Timed out") });
    });
    req.on("error", (e) => resolve({ ok: false, reason: String(e.code || e.message) }));
    req.end(body);
  });

  if (!json.ok) return { ok: false, reason: json.reason };

  // 立刻落盘。refresh token 是一次性轮换的，拿到新值不写回去，
  // 旧的就废了 —— 这一步不能省，也不能延后。
  const d = json.data;
  o.accessToken = d.access_token;
  if (d.refresh_token) o.refreshToken = d.refresh_token;
  o.expiresAt = Date.now() + (d.expires_in || 28800) * 1000;
  if (d.refresh_token_expires_in) {
    o.refreshTokenExpiresAt = Date.now() + d.refresh_token_expires_in * 1000;
  }
  if (d.scope) o.scopes = String(d.scope).split(" ");
  full.claudeAiOauth = o;

  const written = writeCredential(account, full);
  return { ok: written, refreshed: true, expiresAt: o.expiresAt, error: written ? undefined : L("写入 Keychain 失败", "Failed to write to Keychain") };
}

/**
 * 清理痕迹。
 *
 * 安全约束（很重要）：
 *   · 只删白名单里的子路径，绝不拼接用户输入
 *   · credentials.json 和 .claude.json 默认不动 —— 删了就掉登录，
 *     要删必须显式传 includeCredentials
 *   · 删之前返回将要删的清单，界面先给用户看
 */
function clearTraces(account, keys, { includeCredentials = false } = {}) {
  const dir = configDirOf(account);

  // 按 key 查回 path —— 界面传的是 key（fileHistory），磁盘是 file-history
  const byKey = new Map(TRACE_ITEMS.map((it) => [it.key, it]));

  const removed = [];
  const failed = [];

  for (const key of keys || []) {
    const item = byKey.get(key);
    if (!item) {
      failed.push({ key, reason: L("不在可清理范围内", "Not in the cleanable scope") });
      continue;
    }
    if (!includeCredentials && (item.key === "credentials" || item.key === "identity")) {
      failed.push({ key, reason: L("删了会掉登录，已跳过", "Deleting it would sign you out; skipped") });
      continue;
    }

    const target = path.join(dir, item.path);
    // 双保险：解析后的路径必须还在配置目录里
    if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) {
      failed.push({ key, reason: L("路径越界", "Path is out of bounds") });
      continue;
    }

    try {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(key);
    } catch (e) {
      failed.push({ key, reason: String(e?.message || e) });
    }
  }

  return { removed, failed };
}

/**
 * 把 Claude Code 的 projects 目录名还原成真实路径。
 *
 * 编码规则是「/ 和 . 都换成 -」，所以无法百分之百还原 ——
 * 只有真实存在的目录才算数，还原不出来的直接丢弃。
 *
 * 这份实现放在 account.cjs，main.cjs 也 require 它，
 * 避免两处各写一遍、慢慢跑偏。
 */
function decodeProjectDir(name) {
  if (!name.startsWith("-")) return null;
  const guess = name.replace(/-/g, "/");
  if (fs.existsSync(guess)) return guess;

  const home = os.homedir();
  const parts = name.split("-").filter(Boolean);
  const homeParts = home.split("/").filter(Boolean);
  if (parts.length <= homeParts.length) return null;

  let cur = "/" + parts.slice(0, homeParts.length).join("/");
  for (const seg of parts.slice(homeParts.length)) {
    let found = null;
    try {
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name === seg || e.name.replace(/[.\s]/g, "-") === seg) {
          found = path.join(cur, e.name);
          break;
        }
      }
    } catch {
      return null;
    }
    if (!found) return null;
    cur = found;
  }
  return cur;
}

/**
 * 列出某个环境下的历史会话。
 *
 * Claude Code 把每个会话写成 projects/<编码路径>/<sessionId>.jsonl。
 * 这里只读文件的元信息（大小、时间、第一行里的摘要），不解析整份内容 ——
 * 会话文件几十兆很常见，全读会让界面卡住。
 */
function listSessions(account, limit = 50) {
  const projects = path.join(configDirOf(account), "projects");
  if (!fs.existsSync(projects)) return [];

  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }

  for (const d of dirs) {
    const full = path.join(projects, d.name);
    let files = [];
    try {
      files = fs.readdirSync(full).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const f of files) {
      const p = path.join(full, f);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }

      // 取前 8KB 找第一条 user 消息作为标题
      let title = null;
      try {
        const fd = fs.openSync(p, "r");
        try {
          const buf = Buffer.alloc(Math.min(8192, st.size));
          fs.readSync(fd, buf, 0, buf.length, 0);
          title = extractTitle(buf.toString("utf8"));
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        /* 读不到就算了 */
      }

      out.push({
        id: f.replace(/\.jsonl$/, ""),
        cwd: decodeProjectDir(d.name) || d.name,
        project: path.basename(decodeProjectDir(d.name) || d.name),
        title: title || L("（无标题会话）", "(Untitled session)"),
        sizeBytes: st.size,
        lastActive: st.mtimeMs,
      });
    }
  }

  out.sort((a, b) => b.lastActive - a.lastActive);
  return out.slice(0, limit);
}

/** 从 jsonl 头部找第一条用户消息，截成一句标题 */
function extractTitle(text) {
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.type !== "user") continue;
      const c = rec.message?.content;
      let s = "";
      if (typeof c === "string") s = c;
      else if (Array.isArray(c)) {
        s = c.filter((x) => x?.type === "text").map((x) => x.text).join(" ");
      }
      s = String(s || "").replace(/\s+/g, " ").trim();
      if (!s || s.startsWith("<")) continue;
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    } catch {
      /* 半行，跳过 */
    }
  }
  return null;
}

/** 删除整个环境：目录 + 记录 */
function removeAccountDir(account) {
  const dir = configDirOf(account);
  // 默认环境是用户自己的 ~/.claude，绝不允许从这里删
  if (account.configDir === ".claude") {
    return { ok: false, reason: L("默认环境指向 ~/.claude，不提供删除", "The default environment points to ~/.claude and cannot be deleted") };
  }
  if (!/^\.claude(-[a-z0-9-]+)?$/.test(account.configDir)) {
    return { ok: false, reason: L("目录名不合规", "Invalid directory name") };
  }
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

module.exports = {
  listSessions,
  extractTitle,
  removeAccountDir,
  decodeProjectDir,
  clearTraces,
  HOME,
  CONFIG_DIR_RE,
  setAccounts,
  getAccounts,
  findAccount,
  configDirOf,
  envForAccount,
  ensureConfigDir,
  runClaude,
  readAuthStatus,
  readOAuthAccount,
  readIdentity,
  rotateIdentity,
  identityFile,
  checkExitIp,
  proxyOrNothing,
  collectProfile,
  remoteHashOf,
  inspectTraces,
  listKeychainEntries,
  keychainSuffixFor,
  keychainServiceFor,
  readCredential,
  writeCredential,
  refreshTokenIfNeeded,
  dirSize,
};
