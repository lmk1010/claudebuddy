/**
 * 登录用的浏览器：探测本机装了哪些、各有哪些用户资料，并按用户的选择打开授权链接。
 *
 * 为什么要选：Claude 的网页授权会用浏览器里「已经登着的那个号」。
 * Chrome 里常常同时有好几个谷歌账号的用户资料，或者用户只想在无痕窗口里登 ——
 * 交给系统默认浏览器就只能碰运气。
 *
 * 渲染层只拿到选项 id 和显示文字，真正的命令行参数只在这里拼，不从外面收。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const SUPPORT = path.join(os.homedir(), "Library", "Application Support");

/** Chromium 系：数据目录里的 Local State 记着全部用户资料 */
const CHROMIUM = [
  { key: "chrome", name: "Chrome", app: "Google Chrome", data: "Google/Chrome", privFlag: "--incognito", privName: "无痕窗口" },
  { key: "edge", name: "Edge", app: "Microsoft Edge", data: "Microsoft Edge", privFlag: "--inprivate", privName: "InPrivate 窗口" },
  { key: "brave", name: "Brave", app: "Brave Browser", data: "BraveSoftware/Brave-Browser", privFlag: "--incognito", privName: "无痕窗口" },
  { key: "chromium", name: "Chromium", app: "Chromium", data: "Chromium", privFlag: "--incognito", privName: "无痕窗口" },
];

function appInstalled(app) {
  return [path.join("/Applications", `${app}.app`), path.join(os.homedir(), "Applications", `${app}.app`)].some((p) =>
    fs.existsSync(p),
  );
}

function chromiumProfiles(b) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(SUPPORT, b.data, "Local State"), "utf8"));
    const cache = st?.profile?.info_cache || {};
    const order = st?.profile?.profiles_order || Object.keys(cache);
    return order
      .filter((dir) => cache[dir])
      .map((dir) => ({ dir, name: cache[dir].name || dir, email: cache[dir].user_name || "" }));
  } catch {
    return [];
  }
}

/**
 * 全部可选项。分组：推荐（系统默认）→ 各浏览器的用户资料 → 隐私窗口 → 兜底（复制链接）。
 * @returns {{ id: string, label: string, sub: string, group: string, private?: boolean }[]}
 */
function list() {
  const out = [{ id: "system", label: "系统默认浏览器", sub: "", group: "default" }];
  const privs = [];
  for (const b of CHROMIUM) {
    if (!appInstalled(b.app)) continue;
    const profiles = chromiumProfiles(b);
    if (profiles.length <= 1) {
      out.push({ id: `${b.key}:${profiles[0]?.dir ?? "Default"}`, label: b.name, sub: profiles[0]?.email ?? "", group: "browser" });
    } else {
      for (const p of profiles) out.push({ id: `${b.key}:${p.dir}`, label: `${b.name} · ${p.name}`, sub: p.email, group: "browser" });
    }
    privs.push({ id: `${b.key}:private`, label: `${b.name} ${b.privName}`, sub: "不带任何已登录的账号", group: "private", private: true });
  }
  if (appInstalled("Firefox")) {
    out.push({ id: "firefox", label: "Firefox", sub: "", group: "browser" });
    privs.push({ id: "firefox:private", label: "Firefox 隐私窗口", sub: "不带任何已登录的账号", group: "private", private: true });
  }
  if (appInstalled("Arc")) out.push({ id: "arc", label: "Arc", sub: "", group: "browser" });
  if (fs.existsSync("/Applications/Safari.app")) out.push({ id: "safari", label: "Safari", sub: "", group: "browser" });
  out.push(...privs);
  out.push({ id: "copy", label: "复制登录链接", sub: "自己粘到任意浏览器", group: "copy" });
  return out;
}

/** 把选项 id 翻成 `open` 的参数。认不出的 id 一律当系统默认，绝不拼外来字符串 */
function openArgs(id, url) {
  if (id === "safari") return ["-a", "Safari", url];
  if (id === "arc") return ["-a", "Arc", url];
  if (id === "firefox") return ["-a", "Firefox", url];
  if (id === "firefox:private") return ["-na", "Firefox", "--args", "-private-window", url];
  const [key, rest] = String(id).split(":");
  const b = CHROMIUM.find((x) => x.key === key);
  if (b && rest) {
    if (rest === "private") return ["-na", b.app, "--args", b.privFlag, url];
    // 资料目录名只认 Local State 里真实存在的，防止被塞进奇怪的参数
    if (chromiumProfiles(b).some((p) => p.dir === rest)) return ["-na", b.app, "--args", `--profile-directory=${rest}`, url];
  }
  return [url];
}

function open(id, url) {
  return new Promise((resolve) => {
    execFile("open", openArgs(id, url), { timeout: 8000 }, (err) => resolve(!err));
  });
}

/**
 * 给 CLI 用的 BROWSER 钩子：CLI 想开浏览器时调用它，它只把链接写进文件，
 * 由主进程读到后按用户选的浏览器打开。脚本放在应用数据目录，每次启动覆盖一遍。
 */
function ensureHook(userData) {
  const p = path.join(userData, "login-browser-hook.sh");
  const body = '#!/bin/sh\n# ClaudeBuddy：把登录链接交给应用，由应用按你选的浏览器打开\nprintf \'%s\\n\' "$1" >> "$CLAUDE_BUDDY_URL_FILE"\n';
  try {
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== body) fs.writeFileSync(p, body, { mode: 0o755 });
    fs.chmodSync(p, 0o755);
  } catch {
    /* 写不了就退回系统默认浏览器 */
  }
  return p;
}

module.exports = { list, open, ensureHook };
