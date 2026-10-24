/**
 * 自动更新。
 *
 * 两条 macOS 特有的硬约束，决定了这里怎么写：
 *
 *   1. 原地更新必须用 **zip**，DMG 不能替换正在运行的 app。所以打包要同时出
 *      dmg（给人下载安装）和 zip（给更新用），发布清单里两个都指上。
 *   2. app 必须已签名。Squirrel.Mac 会验新包的签名，签名对不上直接拒绝 ——
 *      所以新旧版本必须用同一个 Developer ID 签。
 *
 * 发布源从包里的 app-update.yml 读（由 electron-builder 按 build.publish 生成）。
 * 没配发布源时（开发态、内测包）整块静默禁用：不能让「检查更新」在没源的时候
 * 报错，那只是噪音。
 *
 * 刻意不开 autoDownload：自动下载 120MB 对谁都不礼貌。查到有新版本先告诉用户，
 * 下不下由他决定。
 */

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

let autoUpdater = null;
let feedUrl = null;
let getWindow = () => null;
let state = { state: "idle", current: app.getVersion(), latest: null, percent: 0, error: null };

/** 包里有没有发布源 —— 没有就整块不启用 */
function hasFeed() {
  try {
    const p = path.join(process.resourcesPath, "app-update.yml");
    if (fs.existsSync(p)) {
      feedUrl = p;
      return true;
    }
  } catch {
    /* 读不到就是没有 */
  }
  return false;
}

function push(patch) {
  state = { ...state, ...patch };
  const w = getWindow();
  if (w && !w.isDestroyed()) w.webContents.send("update:state", state);
}

function init(getWin) {
  getWindow = getWin || getWindow;
  if (!hasFeed()) return false;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return false;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => push({ state: "checking", error: null }));
  autoUpdater.on("update-available", (i) => push({ state: "available", latest: i.version, error: null }));
  autoUpdater.on("update-not-available", () => push({ state: "latest", latest: state.current, error: null }));
  autoUpdater.on("download-progress", (p) => push({ state: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => push({ state: "ready", latest: i.version, percent: 100 }));
  autoUpdater.on("error", (e) => push({ state: "error", error: String(e?.message || e) }));

  // 启动几秒后静默查一次：有新版才在界面上提示，没有就什么都不说
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => {});
  }, 4000);
  return true;
}

async function check() {
  if (!autoUpdater) return { ok: false, reason: "no-feed" };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

async function download() {
  if (!autoUpdater) return { ok: false, reason: "no-feed" };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

function install() {
  if (!autoUpdater) return false;
  try {
    autoUpdater.quitAndInstall();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  init,
  check,
  download,
  install,
  /** 有没有发布源 —— 界面靠它决定要不要显示「检查更新」 */
  enabled: () => Boolean(feedUrl),
  getState: () => state,
};