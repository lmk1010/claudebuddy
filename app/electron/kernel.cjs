/*
 * mihomo 内核 —— 下载、校验、定位。
 *
 * 为什么自己带内核，而不是要求用户先装 Clash：
 * 只要内核归我们管，就能给每个环境起一个**独立实例**（`-d 独立目录`），
 * 每个实例只绑一个节点、只开一个端口。出口 IP 的隔离才是真的，
 * 而不是让用户去手写 listeners —— 那一步是整条链上最容易劝退人的地方。
 *
 * 关于签名：这个二进制跟着 .app 一起被 `codesign --deep` 覆盖（见
 * scripts/package-mac.sh），和现在分发应用的方式一致，不需要额外公证。
 * 从网络下载的内核是**运行时资源**，放在 userData 里，不参与包签名。
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const zlib = require("node:zlib");
const { execFile } = require("node:child_process");

/**
 * 内核版本钉死，不跟 latest。
 *
 * 自动追最新版意味着某天上游改了一个配置字段，用户的环境会集体起不来，
 * 而那时候我们连是哪次升级导致的都说不清。要升就手动改这个常量。
 */
const VERSION = "v1.19.33";

const REPO = "MetaCubeX/mihomo";

let BASE = null;

/** 内核目录。测试时可注入，正常走 Electron 的 userData */
function baseDir() {
  if (BASE) return BASE;
  try {
    BASE = path.join(require("electron").app.getPath("userData"), "kernel");
  } catch {
    // 不在 Electron 里（脚本 / 测试）：落到一个明确的地方，别污染真实数据
    BASE = path.join(os.homedir(), ".claude-buddy", "kernel");
  }
  return BASE;
}

function setBaseDir(dir) {
  BASE = dir;
}

function binPath() {
  return path.join(baseDir(), "mihomo");
}

/** 本机该用哪个资源：mihomo 的命名里 arm64 / amd64 就是架构 */
function assetName() {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return `mihomo-darwin-${arch}-${VERSION}.gz`;
}

function downloadUrl() {
  return `https://github.com/${REPO}/releases/download/${VERSION}/${assetName()}`;
}

/** 已装好的内核能不能跑，跑起来报什么版本 */
function probe(bin = binPath()) {
  return new Promise((resolve) => {
    if (!fs.existsSync(bin)) return resolve(null);
    execFile(bin, ["-v"], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = String(stdout).match(/v\d+\.\d+\.\d+/);
      resolve({ path: bin, version: m ? m[0] : null });
    });
  });
}

/** 现有内核的状态：给界面显示「已就绪 / 需下载」 */
async function status() {
  const p = await probe();
  if (p) return { ready: true, path: p.path, version: p.version, asset: assetName() };
  return { ready: false, path: binPath(), version: null, asset: assetName(), url: downloadUrl() };
}

/** 跟一个 URL，跟随重定向（GitHub release 会 302 到 CDN） */
function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("重定向次数过多"));
    https
      .get(url, { headers: { "User-Agent": "claude-buddy" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(get(res.headers.location, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`下载失败：HTTP ${res.statusCode}`));
        }
        const chunks = [];
        let got = 0;
        const total = Number(res.headers["content-length"] || 0);
        res.on("data", (c) => {
          chunks.push(c);
          got += c.length;
          if (total) onProgress?.(got, total);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

let onProgress = null;

/**
 * 下载内核。
 *
 * 先写临时文件再 rename：中途断了不会留下一个「存在但损坏」的 mihomo，
 * 那种文件比没有更糟 —— probe 会执行它，失败原因却看起来像配置问题。
 */
async function install(progress) {
  onProgress = progress || null;
  await fsp.mkdir(baseDir(), { recursive: true });
  const tmp = `${binPath()}.part`;
  try {
    const gz = await get(downloadUrl());
    const bin = zlib.gunzipSync(gz);
    if (bin.length < 1024 * 1024) throw new Error("下载到的内核体积异常，可能是错误页");
    await fsp.writeFile(tmp, bin);
    await fsp.chmod(tmp, 0o755);
    await fsp.rename(tmp, binPath());
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  } finally {
    onProgress = null;
  }
  const p = await probe();
  if (!p) throw new Error("内核下载完成但无法执行");
  return p;
}

/** 确认可用，不可用就装。首次调用会比较久（几十 MB） */
async function ensure(progress) {
  const p = await probe();
  if (p) return p;
  return install(progress);
}

module.exports = { VERSION, assetName, downloadUrl, baseDir, setBaseDir, binPath, probe, status, install, ensure };
