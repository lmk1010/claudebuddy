/**
 * 环境自检 —— 用户打开软件第一眼就该知道"我这儿能不能用"。
 *
 * 检查四件事，每件都要给出「能不能继续」的明确结论：
 *   1. 有没有装 Claude Code（最常见的卡点，必须第一步就查）
 *   2. 版本够不够
 *   3. 有没有 node（CLI 依赖）
 *   4. 目录权限（能不能在 ~ 下建目录）
 *
 * 每项返回三态：ok / warn / fail，附一句人话说明和怎么修。
 */

const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOME = process.env.CLAUDE_BUDDY_HOME || os.homedir();

/** 常见安装位置 —— PATH 里找不到时兜底去这些地方看 */
const COMMON_PATHS = [
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  path.join(os.homedir(), ".npm-global/bin/claude"),
  path.join(os.homedir(), ".local/bin/claude"),
  path.join(os.homedir(), ".claude/local/claude"),
  path.join(os.homedir(), ".bun/bin/claude"),
];

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        out: (stdout || "").trim(),
        err: (stderr || "").trim(),
      });
    });
  });
}

/** 在 PATH 和常见位置里找 claude */
function findClaude() {
  // 1. PATH
  try {
    const p = execFileSync("sh", ["-lc", "command -v claude"], {
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (p && fs.existsSync(p)) return { path: p, source: "PATH" };
  } catch {
    /* 不在 PATH 里 */
  }
  // 2. 常见位置
  for (const p of COMMON_PATHS) {
    try {
      if (fs.existsSync(p)) return { path: p, source: "常见安装位置" };
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

/** 从版本字符串里取 major.minor */
function parseVersion(s) {
  const m = s.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], raw: m[0] } : null;
}

/**
 * 跑全套自检。
 *
 * `shellPath` 是用户登录 shell 的 PATH —— Electron 从 Finder 启动时
 * PATH 很短，直接 spawn 会找不到 claude。所以统一用登录 shell 跑。
 */
async function runCheckup() {
  const items = [];

  // ① Claude Code
  const found = findClaude();
  if (!found) {
    items.push({
      key: "claude",
      label: "Claude Code",
      status: "fail",
      title: "没装 Claude Code",
      detail: "这个软件是 Claude Code 的外壳，没有它没法工作。",
      fix: "打开终端，运行：npm install -g @anthropic-ai/claude-code",
      action: "install",
    });
  } else {
    const v = await run("sh", ["-lc", `"${found.path}" --version`]);
    const ver = parseVersion(v.out);
    items.push({
      key: "claude",
      label: "Claude Code",
      status: "ok",
      title: ver ? `已安装 ${ver.raw}` : "已安装",
      detail: found.path,
      fix: null,
      action: null,
    });
  }

  // ② Node（CLI 是 Node 程序，没有 node 就跑不起来）
  const nv = await run("sh", ["-lc", "node --version"]);
  if (nv.ok && nv.out) {
    const major = Number(nv.out.replace(/^v/, "").split(".")[0]);
    items.push({
      key: "node",
      label: "Node",
      status: major >= 18 ? "ok" : "warn",
      title: `v${nv.out.replace(/^v/, "")}`,
      detail: major >= 18 ? "" : "版本偏低，建议升到 18 以上",
      fix: major >= 18 ? null : "brew install node",
      action: null,
    });
  } else {
    items.push({
      key: "node",
      label: "Node",
      status: found ? "warn" : "fail",
      title: "没检测到 node",
      detail: "Claude Code 依赖 Node 运行。",
      fix: "去 nodejs.org 下载安装，或 brew install node",
      action: null,
    });
  }

  // ③ 主目录可写（要在这里建 .claude-* 目录）
  try {
    const probe = path.join(HOME, `.claude-buddy-write-test-${Date.now()}`);
    fs.mkdirSync(probe, { recursive: true });
    fs.rmdirSync(probe);
    items.push({
      key: "home",
      label: "主目录权限",
      status: "ok",
      title: "可写",
      detail: HOME,
      fix: null,
      action: null,
    });
  } catch (e) {
    items.push({
      key: "home",
      label: "主目录权限",
      status: "fail",
      title: "无法写入",
      detail: String(e?.message || e),
      fix: "检查一下主目录的权限，可能被系统或安全软件限制",
      action: null,
    });
  }

  // ④ 已有账号（让用户知道本机已经有什么，不用重复建）
  const existing = [];
  try {
    for (const d of fs.readdirSync(HOME, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      if (!/^\.claude(-[a-z0-9-]+)?$/.test(d.name)) continue;
      existing.push(d.name);
    }
  } catch {
    /* 忽略 */
  }
  items.push({
    key: "existing",
    label: "已有环境",
    status: "ok",
    title: existing.length ? `${existing.length} 个` : "没有",
    detail: existing.length ? existing.map((n) => `~/${n}`).join("  ") : "第一次用会新建一个",
    fix: null,
    action: null,
  });

  const blocking = items.filter((i) => i.status === "fail");
  return {
    ok: blocking.length === 0,
    items,
    claudePath: found ? found.path : null,
    blocking: blocking.map((b) => b.key),
  };
}

/** 一键安装 Claude Code（在登录 shell 里跑 npm，输出流给渲染层） */
function installClaude(onData) {
  return new Promise((resolve) => {
    const { spawn } = require("node:child_process");
    const p = spawn("sh", ["-lc", "npm install -g @anthropic-ai/claude-code"], {
      env: { ...process.env, PATH: process.env.PATH },
    });
    p.stdout.on("data", (d) => onData(d.toString()));
    p.stderr.on("data", (d) => onData(d.toString()));
    p.on("exit", (code) => resolve({ ok: code === 0, code }));
    p.on("error", (e) => resolve({ ok: false, code: -1, error: String(e?.message || e) }));
  });
}

module.exports = { runCheckup, installClaude, findClaude };
