/**
 * Electron 主进程 —— 唯一持有 PTY 的地方。
 *
 * 三条边界，一条不多：
 *
 *   1. **PTY 只在主进程**。渲染层拿不到 node-pty，也拿不到 fs。
 *      它只能通过 IPC 发"在这些参数下开个终端"和"把这段字打到那个终端"。
 *
 *   2. **环境由主进程组装**。渲染层说"用「主力」这个账号"，主进程把它翻译成
 *      一组环境变量（CLAUDE_CONFIG_DIR 等）。渲染层永远拿不到完整 env，
 *      也改不了它。
 *
 *   3. **账号隔离 = 一份独立的 CLAUDE_CONFIG_DIR**。这是普通版（macOS）
 *      能做到的最实在的隔离：token、对话记录、file-history、遥测
 *      全部落在各自目录里，互不串。超强版（Linux）在这之上再加
 *      landlock / netns，但那换的是另一个 launcher，不动这里。
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  shell,
  dialog,
  Menu,
  screen,
  clipboard,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFile } = require("node:child_process");
const browsersModule = require("./browsers.cjs");

const DEV_URL = process.env.CLAUDE_BUDDY_DEV_URL || "";
const isDev = DEV_URL.length > 0;

/** 应用图标：开发和打包两种路径都要能找到 */
function iconPath() {
  const candidates = [
    path.join(__dirname, "..", "assets", "icon.icns"),
    path.join(app.getAppPath(), "assets", "icon.icns"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

/** Dock 图标用 PNG —— nativeImage 对 icns 的解析在部分版本上会失败 */
function dockIconPath() {
  return [path.join(__dirname, "..", "assets", "icon.png")].find((p) => fs.existsSync(p));
}

/** 活的 PTY：id → IPty */
const terms = new Map();
/** 每个终端的活动记录，用于节奏看护 */
const activity = new Map();
/** 正在跑登录流程的终端：termId → { accountId, startedAt } */
const loginTerms = new Map();

let pty = null;
try {
  // 延迟 require：打包环境下原生模块加载失败不该让整个应用起不来
  pty = require("@lydell/node-pty");
} catch (err) {
  console.error("[claude-buddy] node-pty 加载失败，终端将不可用：", err?.message);
}

let mainWindow = null;

// ─────────────────────────────────────────── 状态持久化

function statePath() {
  // 开发期逐屏自检可以用临时状态文件，不污染真实偏好
  const override = process.env.CLAUDE_BUDDY_STATE;
  if (override) return override;
  return path.join(app.getPath("userData"), "state.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[claude-buddy] 状态保存失败：", err?.message);
  }
}

// ─────────────────────────────────────────── 账号 → 环境
//
// 真正的实现在 account.cjs：目录白名单、环境变量组装、登录态探测、
// 身份轮换、出口 IP 检测都在那里。主进程这边只做转发和 PTY 组装，
// 因为隔离的规则必须只有一处 —— 两处迟早会不一致。

const acct = require("./account.cjs");

/** 当前账号表（从 state 同步进来） */
function syncAccounts(list) {
  acct.setAccounts(list);
}

/**
 * 把账号引用解析成完整账号对象。
 * 渲染层只允许传 id；传别的一律拒绝 —— 否则"隔离"只是约定。
 */
function resolveAccount(input) {
  const id = typeof input === "string" ? input : input && input.id;
  if (!id) throw new Error("账号参数不合法");
  const found = acct.findAccount(id);
  if (!found) throw new Error(`未知账号：${id}`);
  return found;
}

// ─────────────────────────────────────────── PTY

function spawnTerm(opts) {
  if (!pty) throw new Error("node-pty 不可用");

  const { id, account, cwd, cols, rows, command } = opts;
  // 渲染层只允许传配置文件里的账号 id，不许自造 configDir ——
  // 否则"账号隔离"就变成一个可以绕过的约定。
  const resolved = resolveAccount(account);
  acct.ensureConfigDir(resolved);

  const env = acct.envForAccount(resolved);
  env.CLAUDE_BUDDY_WINDOW = id;

  const userShell = process.env.SHELL || "/bin/zsh";
  const args = ["-l"];

  const p = pty.spawn(userShell, args, {
    name: "xterm-256color",
    cols: cols || 120,
    rows: rows || 32,
    cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
    env,
  });

  terms.set(id, p);
  activity.set(id, {
    accountId: resolved.id,
    startedAt: Date.now(),
    requests: [],
    lastDataAt: Date.now(),
    // 每分钟一格的请求计数，用于右栏的 24 根分钟柱
    minutes: new Map(),
  });

  p.onData((data) => {
    const a = activity.get(id);
    if (a) {
      a.lastDataAt = Date.now();
      if (detectApiTick(data)) {
        const minute = Math.floor(Date.now() / 60000);
        a.requests.push(Date.now());
        a.minutes.set(minute, (a.minutes.get(minute) || 0) + 1);
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("term:data", { id, data });
    }
  });

  p.onExit(({ exitCode }) => {
    terms.delete(id);
    activity.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("term:exit", { id, exitCode });
    }
  });

  // 如果指定了启动命令（例如直接起 claude），等登录 shell 的 rc 跑完再写。
  //
  // 这里不能用固定延时：zsh -l 要先跑完 .zshrc（用户可能装了一堆东西，
  // 比如 nvm / conda / 主题），早写的命令会被 shell 吞掉或者乱序。
  // 做法是等第一段静默期 —— 输出停下来了，说明 prompt 已经就绪。
  if (command) {
    let quietTimer = null;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      if (quietTimer) clearTimeout(quietTimer);
      const live = terms.get(id);
      if (live) live.write(command + "\r");
    };
    const arm = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(fire, 420);
    };
    arm();
    p.onData(arm);
    // 兜底：rc 卡住或一直刷屏时，4 秒后无论如何都发
    setTimeout(fire, 4000);
  }

  return { pid: p.pid };
}

function killTerm(id) {
  const p = terms.get(id);
  if (!p) return;
  try {
    p.kill();
  } catch {
    /* 已经死了 */
  }
  terms.delete(id);
  activity.delete(id);
}

// ─────────────────────────────────────────── 节奏采样

/**
 * 从 PTY 输出里粗读"是否发生了一次 API 交互"。
 *
 * 这是普通版能做到的程度：不 hook 网络，只观察终端上出现的
 * Claude Code 活动标记。宁可少算，不要算错 —— 所以只认
 * 明确的 spinner / token 计数这类信号。
 */
/**
 * 从一段 PTY 输出里判断"刚刚发生了一次 API 交互"。
 *
 * 只认 Claude Code 自己的活动标记：spinner 字符、token 计数行、
 * 工具调用的圆点行。宁可少算，不要算错 —— 所以不做模糊匹配普通输出。
 */
function detectApiTick(data) {
  if (!data) return false;
  // ✻ / ✽ / · 之类的工作中标记，配合 tokens / esc to interrupt
  if (/[✻✽✳✶✷⎿⏵]/.test(data)) return true;
  if (/tokens\b/i.test(data) && /esc to interrupt/i.test(data)) return true;
  return false;
}

function sampleActivity() {
  const out = [];
  const now = Date.now();
  const nowMinute = Math.floor(now / 60000);
  for (const [id, a] of activity) {
    const hourAgo = now - 3600_000;
    a.requests = a.requests.filter((t) => t > hourAgo);
    const buckets = [];
    for (let i = 23; i >= 0; i--) {
      buckets.push(a.minutes.get(nowMinute - i) || 0);
    }
    out.push({
      id,
      sessionSeconds: Math.round((now - a.startedAt) / 1000),
      lastHour: a.requests.length,
      idleSeconds: Math.round((now - a.lastDataAt) / 1000),
      buckets,
    });
  }
  return out;
}

// ─────────────────────────────────────────── 窗口

/** 窗口状态文件：记住上次的尺寸和位置，下次启动原样回来 */
function windowStateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

/**
 * 首次启动的默认尺寸 —— 和工作区居中对齐，比例取 16:10。
 *
 * 之前只给了宽高、没给坐标，Electron 会沿用系统给的位置（常常贴左上角、
 * 或者压在 Dock 上），第一眼就是「随便挪过来一个窗口」。
 *
 * 现在的规则：
 *   1. 取工作区（已扣掉菜单栏和 Dock），按 16:10 拟合，留 88% 余量
 *   2. 夹在 1180×740 ~ 1480×925 之间 —— 再小内容挤，再大就成一面墙
 *   3. 算出窗口尺寸后在工作区里**精确居中**
 *   4. 所有尺寸对齐到偶数像素：发丝线和 1px 描边在奇数坐标上会发虚
 *
 * 16:10 而不是 16:9：侧栏 264 + 内容区，16:9 会让内容区上下顶着，
 * 问候语和输入框之间的留白被压扁，看着局促。
 */
const ASPECT = 16 / 10;

function defaultWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const even = (n) => Math.round(n / 2) * 2;

  // 先按宽度拟合一版，再按高度拟合一版，取两者小的那个，保证不越界
  const byWidth = {
    w: workArea.width * 0.86,
    h: (workArea.width * 0.86) / ASPECT,
  };
  const byHeight = {
    h: workArea.height * 0.9,
    w: workArea.height * 0.9 * ASPECT,
  };
  const pick = byWidth.h <= workArea.height * 0.9 ? byWidth : byHeight;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const width = even(clamp(pick.w, 1180, 1480));
  const height = even(clamp(pick.h, 740, 925));

  return {
    width,
    height,
    // 在工作区里精确居中：x 居中，y 居中（不是贴在菜单栏下面）
    x: even(workArea.x + (workArea.width - width) / 2),
    y: even(workArea.y + (workArea.height - height) / 2),
  };
}

/** 读上次的位置；屏幕变了（拔掉外接屏）就丢弃，避免窗口飞到看不见的地方 */
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), "utf8"));
    if (!s || typeof s.width !== "number" || typeof s.height !== "number") return null;
    if (s.width < 1000 || s.height < 640) return null;
    if (typeof s.x === "number" && typeof s.y === "number") {
      const onSomeDisplay = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return (
          s.x >= a.x - 16 &&
          s.y >= a.y - 16 &&
          s.x + s.width <= a.x + a.width + 16 &&
          s.y + s.height <= a.y + a.height + 16
        );
      });
      if (!onSomeDisplay) return { width: s.width, height: s.height };
    }
    return s;
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  try {
    // getNormalBounds：全屏/最大化时拿到的是之前的正常尺寸，不会把全屏尺寸记下来
    const b = win.getNormalBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify(b));
  } catch {
    /* 记不上就算了，下次用默认 */
  }
}

function createWindow() {
  const icon = iconPath();
  const saved = loadWindowState();
  const bounds = saved ?? defaultWindowBounds();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(typeof bounds.x === "number" && typeof bounds.y === "number"
      ? { x: bounds.x, y: bounds.y }
      : {}),
    // 主页舒适下限：侧栏 264 + 内容 680 ≈ 944；高度保住问候语 + 输入框 + 一排卡片。
    // 跟默认 16:10 对齐，缩到最小时比例不会先崩成个竖条。
    minWidth: 1000,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    // 暖纸色，跟设计稿的主区同值；暗色换暖炭
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1F1E1B" : "#FAF9F5",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.on("close", () => saveWindowState(mainWindow));

  // 渲染层挂了不能静默 —— 否则用户只看到窗口一闪就没了
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[claude-buddy] 渲染进程退出:", JSON.stringify(details));
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[claude-buddy] 页面加载失败:", code, desc, url);
  });
  mainWindow.webContents.on("preload-error", (_e, p, err) => {
    console.error("[claude-buddy] preload 出错:", p, String(err));
  });
  mainWindow.on("unresponsive", () => console.error("[claude-buddy] 窗口无响应"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    // 开发期自查：把窗口落点打出来，验证居中是否真的对齐工作区中心
    if (process.env.CLAUDE_BUDDY_GEOM) {
      const wa = screen.getPrimaryDisplay().workArea;
      const b = mainWindow.getBounds();
      console.log(
        "[geom]",
        JSON.stringify({
          workArea: `${wa.width}x${wa.height} @${wa.x},${wa.y}`,
          bounds: `${b.width}x${b.height} @${b.x},${b.y}`,
          aspect: +(b.width / b.height).toFixed(3),
          dx: Math.round(b.x + b.width / 2 - (wa.x + wa.width / 2)),
          dy: Math.round(b.y + b.height / 2 - (wa.y + wa.height / 2)),
        })
      );
    }
    autoWindowIfRequested();
    if (process.env.CLAUDE_BUDDY_TOUR) {
      setTimeout(() => {
        shootTour().catch((e) => console.error("[tour]", e?.message));
      }, 1200);
    }
    // 布局自检：CLAUDE_BUDDY_AUDIT=1 时扫多种窗口尺寸并退出
    if (process.env.CLAUDE_BUDDY_AUDIT) {
      setTimeout(() => {
        auditLayout()
          .then(() => app.quit())
          .catch((e) => {
            console.error("[audit]", e?.message);
            app.quit();
          });
      }, 1800);
    }
    // 开发期自查：CLAUDE_BUDDY_SHOT=/path/to.png 时自动存一张
    const shot = process.env.CLAUDE_BUDDY_SHOT;
    if (shot) {
      setTimeout(async () => {
        try {
          const img = await mainWindow.webContents.capturePage();
          fs.writeFileSync(shot, img.toPNG());
          console.log("[claude-buddy] 截图已保存:", shot);
        } catch (err) {
          console.error("[claude-buddy] 截图失败:", err?.message);
        }
      }, Number(process.env.CLAUDE_BUDDY_SHOT_DELAY || 1500));
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // 外链走系统浏览器，不在应用里开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    for (const id of [...terms.keys()]) killTerm(id);
  });
}

// ─────────────────────────────────────────── IPC

ipcMain.handle("app:info", () => ({
  platform: process.platform,
  home: os.homedir(),
  username: (() => {
    try {
      const u = os.userInfo().username;
      return u ? u.charAt(0).toUpperCase() + u.slice(1) : "本机用户";
    } catch {
      return "本机用户";
    }
  })(),
  version: app.getVersion(),
  // 关于页用：运行时版本、系统、数据目录
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  arch: process.arch,
  osVersion: os.release(),
  userData: app.getPath("userData"),
  ptyAvailable: pty !== null,
  darkMode: nativeTheme.shouldUseDarkColors,
  // 开发期逐屏自检用：强制浅色 / 暗色
  forcedTheme: process.env.CLAUDE_BUDDY_THEME || null,
}));

ipcMain.handle("state:load", () => {
  const state = loadState();
  /**
   * 加载时就要把账号表交给主进程。
   *
   * PTY 的 spawn 走的是主进程这张表，而渲染层加载完不一定会立刻回存。
   * 只在 state:save 里同步的话，启动后第一次开终端必然拿到空表，
   * 于是报「未知账号」—— 看上去像数据丢了，其实只是没同步。
   */
  if (state && Array.isArray(state.accounts)) syncAccounts(state.accounts);
  return state;
});
ipcMain.handle("state:save", (_e, state) => {
  saveState(state);
  // 账号表由主进程持有；渲染层只是编辑器，目录名在这里再过一道白名单
  if (state && Array.isArray(state.accounts)) {
    syncAccounts(state.accounts);
  }
  return true;
});

ipcMain.handle("term:spawn", async (_e, opts) => {
  try {
    /**
     * 开终端前先把过期的凭据续上。
     *
     * 否则闲置超过 8 小时的环境，一进来就是 401 ——
     * 看起来像"号掉了"，其实只是没人去刷新 token。
     */
    try {
      const acc = resolveAccount(opts?.account);
      const r = await acct.refreshTokenIfNeeded(acc);
      if (!r.ok && r.reason) {
        // 续不上不阻断启动：让 CLI 自己报它该报的错，比这里吞掉更有用
        console.warn(`[token] ${acc.label}: ${r.reason}`);
      }
    } catch {
      /* 账号解析失败交给下面的 spawnTerm 抛 */
    }
    return { ok: true, ...spawnTerm(opts) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

/** 手动续期一个环境的凭据（面板上的"续期"按钮用） */
ipcMain.handle("account:refresh-token", async (_e, id) => {
  try {
    const acc = resolveAccount(id);
    return await acct.refreshTokenIfNeeded(acc, { force: true });
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
});

ipcMain.on("term:write", (_e, { id, data }) => {
  terms.get(id)?.write(data);
});

ipcMain.on("term:resize", (_e, { id, cols, rows }) => {
  const p = terms.get(id);
  if (!p) return;
  try {
    p.resize(Math.max(2, cols), Math.max(2, rows));
  } catch {
    /* 窗口正在销毁时 resize 会抛，忽略 */
  }
});

ipcMain.on("term:kill", (_e, { id }) => killTerm(id));

ipcMain.handle("term:activity", () => sampleActivity());

ipcMain.handle("dialog:pickFolder", async () => {
  // 开发期自查用：定了目标目录就直接返回，不走系统弹窗
  if (process.env.CLAUDE_BUDDY_AUTODIR) return process.env.CLAUDE_BUDDY_AUTODIR;
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
});

/** 列出某个账号配置目录下的用量痕迹（只读，不解析内容） */
ipcMain.handle("account:inspect", (_e, account) => {
  const dir = path.join(os.homedir(), account.configDir);
  const info = { configDir: dir, exists: false, sessions: 0, sizeBytes: 0 };

  if (!fs.existsSync(dir)) return info;
  info.exists = true;

  const projects = path.join(dir, "projects");
  if (fs.existsSync(projects)) {
    try {
      for (const proj of fs.readdirSync(projects)) {
        const p = path.join(projects, proj);
        if (!fs.statSync(p).isDirectory()) continue;
        info.sessions += fs.readdirSync(p).filter((f) => f.endsWith(".jsonl")).length;
      }
    } catch {
      /* 权限或竞态，忽略 */
    }
  }

  info.sizeBytes = dirSize(dir, 4 * 1024 * 1024);
  return info;
});

/** 目录大小，最多统计 budget 字节就停 —— 只在面板上做粗略占用示意 */
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
        /* 忽略单文件错误 */
      }
    }
  }
  return total;
}

/** git 工作区状态：分支 + 未提交改动的增删行数 */
ipcMain.handle("git:info", async (_e, cwd) => {
  const empty = { branch: null, changes: [], totalAdd: 0, totalDel: 0 };
  if (typeof cwd !== "string" || !fs.existsSync(cwd)) return empty;

  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null) return empty;

  const numstat = await git(cwd, ["diff", "HEAD", "--numstat"]);
  const changes = [];
  let totalAdd = 0;
  let totalDel = 0;
  for (const line of (numstat || "").split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const add = m[1] === "-" ? 0 : Number(m[1]);
    const del = m[2] === "-" ? 0 : Number(m[2]);
    changes.push({ path: m[3], add, del });
    totalAdd += add;
    totalDel += del;
  }
  // 未跟踪文件也算改动
  const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  for (const f of (untracked || "").split("\n")) {
    if (!f) continue;
    changes.push({ path: f, add: 0, del: 0 });
  }

  return { branch: branch.trim() || null, changes, totalAdd, totalDel };
});

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { timeout: 4000, maxBuffer: 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

/**
 * 真实上下文占用：读该项目最近一次会话的 jsonl，取最后一条带 usage 的记录。
 *
 * Claude Code 把每轮 API 调用的 token 用量写进助手的消息里，
 * 累加 input / cache_read / cache_creation 就是这一轮真正送进模型的上下文长度。
 * 读不到就返回 null —— 面板上显示「—」，不编一个数。
 */
ipcMain.handle("session:usage", async (_e, { configDir, cwd }) => {
  if (!configDir || typeof cwd !== "string") return null;
  const projects = path.join(os.homedir(), configDir, "projects");
  if (!fs.existsSync(projects)) return null;

  let dir = null;
  try {
    for (const d of fs.readdirSync(projects, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      if (decodeProjectDir(d.name) === cwd) {
        dir = path.join(projects, d.name);
        break;
      }
    }
  } catch {
    return null;
  }
  if (!dir) return null;

  let newest = null;
  let newestAt = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.mtimeMs > newestAt) {
        newestAt = st.mtimeMs;
        newest = p;
      }
    }
  } catch {
    return null;
  }
  if (!newest) return null;

  // 只读尾部 256KB —— 会话文件可能几十兆，没必要整份读进来
  let text = "";
  try {
    const st = fs.statSync(newest);
    const start = Math.max(0, st.size - 256 * 1024);
    const fd = fs.openSync(newest, "r");
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }

  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const rec = JSON.parse(line);
      const u = rec && rec.message && rec.message.usage;
      if (!u) continue;
      const model = rec.message.model;
      // <synthetic> 是 CLI 自己写的占位消息，没有真实用量
      if (model === "<synthetic>") continue;
      const input =
        (u.input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.cache_creation_input_tokens || 0);
      if (input === 0) continue;
      return {
        input,
        output: u.output_tokens || 0,
        at: rec.timestamp || null,
        model: model || null,
      };
    } catch {
      // 尾部可能是半行，跳过继续往上找
    }
  }
  return null;
});

/** 最近项目：读各账号 projects 目录，取每个项目最后一次会话的活动时间 */
/**
 * 最近项目。
 *
 * 传了 id 就只查那一个环境 —— 主页显示的必须是"这个环境下我做过什么"，
 * 把所有环境混在一起会让新环境看起来像已经用过一堆项目。
 */
ipcMain.handle("projects:recent", async (_e, { id } = {}) => {
  const out = [];
  const seen = new Set();

  let list = acct.getAccounts();
  if (id) {
    try {
      list = [resolveAccount(id)];
    } catch {
      list = [];
    }
  }

  for (const acc of list) {
    const projects = path.join(os.homedir(), acc.configDir, "projects");
    if (!fs.existsSync(projects)) continue;
    let dirs = [];
    try {
      dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }

    for (const d of dirs) {
      const full = path.join(projects, d.name);
      let files = [];
      try {
        files = fs.readdirSync(full).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      if (files.length === 0) continue;

      let lastActive = 0;
      for (const f of files) {
        try {
          const st = fs.statSync(path.join(full, f));
          if (st.mtimeMs > lastActive) lastActive = st.mtimeMs;
        } catch {
          /* 忽略 */
        }
      }

      // Claude Code 把 cwd 编码成目录名：/Users/mk/work/api → -Users-mk-work-api
      const cwd = decodeProjectDir(d.name);
      if (!cwd || seen.has(cwd)) continue;
      seen.add(cwd);

      out.push({
        cwd,
        name: path.basename(cwd),
        accountId: acc.id,
        configDir: acc.configDir,
        lastActive,
        sessions: files.length,
      });
    }
  }

  out.sort((a, b) => b.lastActive - a.lastActive);
  return out.slice(0, 12);
});

/**
 * 把 Claude Code 的 projects 目录名还原成真实路径。
 * 编码规则是「/ 和 . 都换成 -」，所以无法百分之百还原 ——
 * 只有真实存在的目录才算数，还原不出来的直接丢弃。
 */
function decodeProjectDir(name) {
  if (!name.startsWith("-")) return null;
  const guess = name.replace(/-/g, "/");
  if (fs.existsSync(guess)) return guess;
  // 含点号的路径（.claude-work 之类）会被一并换成 -，兜底扫一遍
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

/** account:remove / account:sessions 的实现在下方「账号增删」一节 ——
 *  那里有 purge 参数和路径白名单校验。同一个 channel 不能注册两次，
 *  ipcMain.handle 重复注册会直接抛错，整个主进程起不来。 */

// ─────────────────────────────────────────── 代理探测

const proxyModule = require("./proxydetect.cjs");

/**
 * 找本机可用的代理。
 *
 * 用户通常不知道自己的代理跑在哪个端口，也不确定能不能出网。
 * 这里把系统代理、已配的、常见端口全扫一遍，并**实际发请求验证**，
 * 只把通的返回给界面。
 */
ipcMain.handle("proxy:discover", async (_e, { id } = {}) => {
  let current = { protocol: "none" };
  try {
    if (id) {
      const a = resolveAccount(id);
      current = a.proxy || current;
    }
  } catch {
    /* 账号还没建也能探测 */
  }
  const [list, directIp] = await Promise.all([
    proxyModule.discoverProxies(current),
    proxyModule.testDirect(),
  ]);
  return { list, directIp };
});

/** 测一个指定代理能不能用 */
ipcMain.handle("proxy:test", async (_e, proxy) => {
  const r = await proxyModule.testProxy(proxy);
  return { ok: r.ok, ip: r.ip ?? null, reason: r.reason ?? null };
});

// ─────────────────────────────────────────── 环境自检

const checkupModule = require("./checkup.cjs");

/** 打开软件先跑一遍：装没装 CLI、Node 在不在、能不能写目录、本机已有几个环境 */
ipcMain.handle("checkup:run", async () => checkupModule.runCheckup());

/** 一键安装 Claude Code，输出实时流给渲染层 */
ipcMain.handle("checkup:install", async () => {
  const result = await checkupModule.installClaude((text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("checkup:log", text);
    }
  });
  return result;
});

/** 装完后重跑一遍自检，让界面自己更新 */
ipcMain.handle("checkup:recheck", async () => checkupModule.runCheckup());

// ─────────────────────────────────────────── 连通性归因

const diagnoseModule = require("./diagnose.cjs");
const nettestModule = require("./nettest.cjs");

/**
 * 网络测试：id 为空 = 本机直连；否则走那个环境的代理。
 * 几个出口（直连 / 所选线路 / IPv6）顺手查归属，界面上要能说清「这是谁家的 IP」。
 */
ipcMain.handle("net:test", async (_e, { id, rounds } = {}) => {
  const a = id ? resolveAccount(id) : null;
  const proxy = a ? acct.proxyOrNothing(a) : null;
  const r = await nettestModule.run({ proxy, label: a ? a.label : "本机直连", rounds });
  const [direct, route, v6] = await Promise.all([
    r.exits.direct ? lookupIpInfo(r.exits.direct) : null,
    r.exits.route ? lookupIpInfo(r.exits.route) : null,
    r.local.ipv6 ? lookupIpInfo(r.local.ipv6) : null,
  ]);
  return { ...r, exitInfo: { direct, route, v6 } };
});

/**
 * 403 到底是哪一层挡的。
 *
 * 四层（网络 / 挑战 / 账号 / 用量）的处理方式毫无交集，猜错方向会浪费大量时间。
 * 这个入口真发请求、按响应头与响应体判定，并明确标出没测到的推断。
 */
ipcMain.handle("diagnose:run", async () => diagnoseModule.diagnose());

// ─────────────────────────────────────────── 账号体检与清理

const cleanupModule = require("./cleanup.cjs");

/** 体检：列出所有账号（含 codex-config-ui 的 prof_*），标出哪些已经废了 */
ipcMain.handle("cleanup:survey", async () => cleanupModule.survey());

/**
 * 清理。
 *
 * 只接受 survey 返回过的 id / service，渲染层传不进任意路径 ——
 * 否则一个参数注入就能删掉主目录。
 */
ipcMain.handle("cleanup:purge", async (_e, payload) => cleanupModule.purge(payload || {}));

// ─────────────────────────────────────────── 账号与登录闭环

/**
 * 探测账号真实状态：登录态 + 身份 + 环境画像。
 * 界面上的"已登录"必须来自这里，不能来自本地缓存。
 */
ipcMain.handle("account:status", async (_e, { id }) => {
  const a = resolveAccount(id);
  const dir = acct.configDirOf(a);
  const exists = fs.existsSync(dir);
  if (!exists) {
    return {
      auth: "signedOut",
      exists: false,
      configDir: dir,
      email: null,
      tier: null,
      identity: { userID: null, machineID: null },
    };
  }
  const [status, identity] = await Promise.all([
    acct.readAuthStatus(a),
    Promise.resolve(acct.readIdentity(a)),
  ]);
  return {
    ...status,
    exists: true,
    configDir: dir,
    identity,
    profile: acct.collectProfile(a),
  };
});

/**
 * 在某个账号下打开登录。
 *
 * `claude auth login` 是交互式的：会打印一个 URL 并等浏览器回调。
 * 所以这里不阻塞等待，而是：
 *   1. 起一个 PTY 跑登录命令，把输出流给渲染层（用户能看到 URL）
 *   2. 立刻返回，让界面进入"等待授权"
 *   3. 界面轮询 account:status，直到 loggedIn 变 true
 *
 * 这样做的好处：不需要解析 CLI 的输出去猜成功，
 * 只认它自己写下的凭据 —— 那是唯一可信的成功信号。
 */
ipcMain.handle("browsers:list", () => browsersModule.list());

/** 界面语言：主进程里给人看的文字跟着切 */
ipcMain.handle("app:setLang", (_e, l) => {
  require("./i18n.cjs").setLang(l);
  return true;
});

ipcMain.handle("account:login", async (_e, { id, browser }) => {
  const a = resolveAccount(id);
  acct.ensureConfigDir(a);

  /**
   * 浏览器钩子：CLI 认 BROWSER 环境变量（实测），把它指到我们的小脚本，
   * 脚本只把授权链接写进一个临时文件；这里读到后按用户选的浏览器 / 用户资料 / 无痕打开。
   * 「复制链接」时不打开，直接放进剪贴板。
   */
  const choice = typeof browser === "string" && browser ? browser : "system";
  const urlFile = path.join(os.tmpdir(), `claude-buddy-login-${process.pid}-${Date.now().toString(36)}.txt`);
  const hook = browsersModule.ensureHook(app.getPath("userData"));
  let urlSeen = false;
  const urlPoll = setInterval(() => {
    let txt = "";
    try {
      txt = fs.readFileSync(urlFile, "utf8");
    } catch {
      return;
    }
    const url = txt.split("\n").find((l) => /^https:\/\//.test(l.trim()));
    if (!url || urlSeen) return;
    urlSeen = true;
    clearInterval(urlPoll);
    try {
      fs.unlinkSync(urlFile);
    } catch {
      /* 已删 */
    }
    if (choice === "copy") clipboard.writeText(url.trim());
    else void browsersModule.open(choice, url.trim());
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("login:url", { id, url: url.trim(), browser: choice });
    }
  }, 250);
  setTimeout(() => clearInterval(urlPoll), 2 * 60 * 1000);

  // 同一账号已有登录进程就先杀，避免两个浏览器回调打架
  for (const [tid, meta] of loginTerms) {
    if (meta.accountId === id) {
      try {
        terms.get(tid)?.kill();
      } catch {
        /* 已退出 */
      }
      loginTerms.delete(tid);
    }
  }

  const tid = `login-${id}-${Date.now().toString(36)}`;
  const userShell = process.env.SHELL || "/bin/zsh";
  const p = pty.spawn(userShell, ["-l"], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: os.homedir(),
    env: { ...acct.envForAccount(a), CLAUDE_BUDDY_LOGIN: "1", BROWSER: hook, CLAUDE_BUDDY_URL_FILE: urlFile },
  });

  terms.set(tid, p);
  loginTerms.set(tid, { accountId: id, termId: tid, startedAt: Date.now() });

  // 这几个声明必须在 notify 之前：notify 会同步调用 finishLogin
  let finished = false;
  let quiet = null;

  /** 结束登录：关终端 + 通知渲染层 */
  const finishLogin = (code) => {
    if (finished) return;
    finished = true;
    if (quiet) clearTimeout(quiet);
    try {
      p.kill();
    } catch {
      /* 已退出 */
    }
    terms.delete(tid);
    loginTerms.delete(tid);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("login:exit", { id, exitCode: code });
    }
  };

  const notify = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("term:data", { id: tid, data });
    }

    // 登录是交互会话：claude 退出后 shell 会回到提示符而不是结束。
    // 所以要盯 CLI 自己的输出 —— 看到成功或失败就收掉这个终端，
    // 否则界面会永远挂在"等待 CLI 输出"。
    const clean = String(data).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    if (/Login successful|Successfully authenticated|Logged in as/i.test(clean)) {
      finishLogin(0);
    } else if (/OAuth error|Invalid code|authentication failed|Login failed/i.test(clean)) {
      finishLogin(1);
    }
  };

  p.onData(notify);
  p.onExit(({ exitCode }) => {
    if (!finished) {
      terms.delete(tid);
      loginTerms.delete(tid);
      finished = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("login:exit", { id, exitCode });
      }
    }
  });

  // 等 shell 的 rc 跑完再发命令，否则会被吞掉
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    if (quiet) clearTimeout(quiet);
    terms.get(tid)?.write("claude auth login\r");
  };
  const arm = () => {
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(fire, 500);
  };
  arm();
  p.onData(arm);
  setTimeout(fire, 4000);

  // 兜底：10 分钟内没登录成功就收掉，别留一个永不结束的 shell
  setTimeout(() => {
    if (!finished) finishLogin(1);
  }, 10 * 60 * 1000);

  return { ok: true, termId: tid };
});

/** 登出：走 CLI 自己的 logout，保证 keychain 也跟着清 */
ipcMain.handle("account:logout", async (_e, { id }) => {
  const a = resolveAccount(id);
  // 先杀这个账号的所有窗口，否则进程会把凭据写回去
  for (const [wid, meta] of activity) {
    if (meta.accountId === id) killTerm(wid);
  }
  const r = await acct.runClaude(["auth", "logout"], acct.envForAccount(a), 15000);
  return { ok: r.code === 0, output: r.stdout + r.stderr };
});

/** 清理痕迹 —— 只删白名单里的子路径，凭据默认保留 */
ipcMain.handle("account:clearTraces", async (_e, { id, keys, includeCredentials }) => {
  const a = resolveAccount(id);
  // 这个账号还有窗口在跑就先拒绝，否则文件正在被写
  for (const meta of activity.values()) {
    if (meta.accountId === id) {
      return { ok: false, removed: [], failed: [], reason: "这个环境还有终端在跑，先关掉" };
    }
  }
  try {
    const r = acct.clearTraces(a, keys, { includeCredentials: Boolean(includeCredentials) });
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, removed: [], failed: [], reason: String(err?.message || err) };
  }
});

/**
 * 一个环境的历史会话。
 *
 * 数据来源：<config>/projects/<编码过的 cwd>/<sessionId>.jsonl
 * 每个 jsonl 就是一次对话。这里不解内容，只读元信息：
 * 目录、首条用户消息（当标题）、最后活动时间、体积。
 */
ipcMain.handle("account:sessions", async (_e, { id }) => {
  const a = resolveAccount(id);
  const projects = path.join(acct.configDirOf(a), "projects");
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
      const fp = path.join(full, f);
      let st;
      try {
        st = fs.statSync(fp);
      } catch {
        continue;
      }

      out.push({
        id: f.replace(/\.jsonl$/, ""),
        project: d.name,
        cwd: decodeProjectDir(d.name) ?? d.name,
        title: readSessionTitle(fp) ?? "（没有开头消息）",
        lastActive: st.mtimeMs,
        sizeBytes: st.size,
      });
    }
  }

  out.sort((x, y) => y.lastActive - x.lastActive);
  return out.slice(0, 100);
});

/** 从 jsonl 里取第一条真实用户消息，当会话标题 */
function readSessionTitle(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString("utf8");

    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s.startsWith("{")) continue;
      try {
        const rec = JSON.parse(s);
        if (rec.type !== "user") continue;
        const msg = rec.message;
        if (!msg) continue;
        let content = msg.content;
        if (Array.isArray(content)) {
          const t = content.find((c) => c && c.type === "text");
          content = t ? t.text : null;
        }
        if (typeof content !== "string") continue;
        // 跳过工具结果、系统注入、命令回显
        const c = content.trim();
        if (!c || c.startsWith("<") || c.startsWith("Caveat:")) continue;
        return c.replace(/\s+/g, " ").slice(0, 80);
      } catch {
        /* 半行，跳过 */
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 忽略 */
      }
    }
  }
  return null;
}

/**
 * 删除一个环境。
 *
 * 分两步，因为用户经常只想"从列表里去掉"，而不是连磁盘一起清：
 *   · 默认只移除记录，目录留着（可以再用「导入」加回来）
 *   · 传 purge: true 才真的删目录 —— 这是不可逆操作，界面必须先确认
 *
 * 双重保护：
 *   · 还有终端在跑就拒绝
 *   · 目录必须在 HOME 下且符合 .claude-* 命名，且不能是 .claude 本身
 */
ipcMain.handle("account:remove", async (_e, { id, purge }) => {
  const a = resolveAccount(id);

  for (const meta of activity.values()) {
    if (meta.accountId === id) {
      return { ok: false, reason: "这个环境还有终端在跑，先关掉" };
    }
  }

  // 接管来的默认环境（~/.claude）不允许连目录删 —— 那是用户原本的 Claude Code
  if (purge) {
    if (a.configDir === ".claude") {
      return { ok: false, reason: "这是你原本的 ~/.claude，不能删" };
    }
    const dir = acct.configDirOf(a);
    const home = acct.HOME;
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(home) + path.sep) || !acct.CONFIG_DIR_RE.test(a.configDir)) {
      return { ok: false, reason: "路径不在允许范围内" };
    }
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
    } catch (err) {
      return { ok: false, reason: `删目录失败：${err?.message || err}` };
    }
  }

  return { ok: true, purged: Boolean(purge), configDir: a.configDir };
});

/** 检测出口 IP —— 走该账号真实的代理环境变量 */
ipcMain.handle("account:checkExit", async (_e, { id }) => {
  const a = resolveAccount(id);
  const r = await acct.checkExitIp(a);
  if (!r) return { ok: false, ip: null, reason: "检测失败：代理不可达或网络不通" };
  return { ok: true, ...r };
});

/** 轮换身份（userID / machineID） */
ipcMain.handle("account:rotateIdentity", async (_e, { id }) => {
  const a = resolveAccount(id);
  // 有活着的窗口就拒绝 —— 否则会被运行中的进程写回去
  for (const meta of activity.values()) {
    if (meta.accountId === id) {
      return { ok: false, reason: "该账号还有运行中的终端，先关掉再轮换" };
    }
  }
  try {
    const r = acct.rotateIdentity(a);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
});

/** 痕迹清单 —— 清理前先让人看清有什么 */
ipcMain.handle("account:traces", (_e, { id }) => {
  const a = resolveAccount(id);
  return acct.inspectTraces(a);
});

/** Keychain 里的 Claude Code 条目（只读列举，不删） */
ipcMain.handle("account:keychain", async () => {
  const entries = await acct.listKeychainEntries();
  return entries;
});

/**
 * 导入一个已存在的配置目录。
 *
 * 用于接管用户本机已有的 ~/.claude-*：扫描 home 下所有合规目录，
 * 给出每个目录的登录态与最后活动时间，让用户选，而不是让用户手打路径。
 */
ipcMain.handle("account:scan", async () => {
  let names = [];
  try {
    names = fs
      .readdirSync(acct.HOME, { withFileTypes: true })
      .filter((d) => d.isDirectory() && acct.CONFIG_DIR_RE.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }

  const out = [];
  for (const name of names) {
    const fake = { configDir: name, id: name, label: name, proxy: { protocol: "none" } };
    const dir = path.join(acct.HOME, name);
    let lastActive = 0;
    let sessions = 0;
    try {
      const proj = path.join(dir, "projects");
      for (const d of fs.readdirSync(proj, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const full = path.join(proj, d.name);
        for (const f of fs.readdirSync(full)) {
          if (!f.endsWith(".jsonl")) continue;
          sessions++;
          try {
            const st = fs.statSync(path.join(full, f));
            if (st.mtimeMs > lastActive) lastActive = st.mtimeMs;
          } catch {
            /* 忽略 */
          }
        }
      }
    } catch {
      /* 没有 projects */
    }

    const identity = acct.readIdentity(fake);
    const oa = acct.readOAuthAccount(fake);
    out.push({
      configDir: name,
      sessions,
      lastActive,
      sizeBytes: acct.dirSize(dir, 4 * 1024 * 1024),
      email: oa?.emailAddress ?? null,
      tier: oa?.organizationRateLimitTier ?? null,
      hasIdentity: Boolean(identity.userID),
    });
  }
  out.sort((a, b) => b.lastActive - a.lastActive);
  return out;
});

/** 关掉登录终端 —— 登录流程结束或用户取消时都必须调，否则 shell 会一直挂着 */
ipcMain.handle("account:closeLogin", (_e, { id, termId }) => {
  const target = termId || (id ? loginTerms.get(id)?.termId : undefined);
  if (!target) return false;
  const p = terms.get(target);
  if (p) {
    try {
      p.kill();
    } catch {
      /* 已退出 */
    }
    terms.delete(target);
  }
  for (const [tid, meta] of loginTerms) {
    if (tid === target || meta.accountId === id) loginTerms.delete(tid);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("login:exit", { id, exitCode: 0 });
  }
  return true;
});

/** 在系统浏览器里打开链接 —— 只允许 https，避免被当成命令注入的载体 */
ipcMain.handle("shell:openExternal", async (_e, url) => {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

/**
 * 查一个出口 IP 的归属：国家城市、运营商、ASN，以及是不是机房 / 代理 / 移动网络。
 *
 * 用 ip-api.com（免费、无 key、带 hosting/proxy/mobile 标记）。查的是已知 IP，
 * 不需要走这个环境的代理，直连查即可。结果缓存在内存里，同一个 IP 不重复打。
 */
const ipInfoCache = new Map();
ipcMain.handle("ip:info", async (_e, ip) => lookupIpInfo(ip));

async function lookupIpInfo(ip) {
  if (typeof ip !== "string" || !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return null;
  if (ipInfoCache.has(ip)) return ipInfoCache.get(ip);
  const url = `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,regionName,city,timezone,isp,org,as,mobile,proxy,hosting&lang=zh-CN`;
  const raw = await new Promise((resolve) => {
    execFile("curl", ["-sS", "--max-time", "6", url], { timeout: 8000 }, (err, out) => resolve(err ? null : out));
  });
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j.status !== "success") return null;
    const info = {
      ip,
      country: j.country || "",
      countryCode: j.countryCode || "",
      region: j.regionName || "",
      city: j.city || "",
      timezone: j.timezone || "",
      isp: j.isp || "",
      org: j.org || "",
      as: j.as || "",
      mobile: Boolean(j.mobile),
      proxy: Boolean(j.proxy),
      hosting: Boolean(j.hosting),
    };
    ipInfoCache.set(ip, info);
    return info;
  } catch {
    return null;
  }
}

/** curl 一次，拿状态码、耗时和正文。失败返回 null，不抛。 */
function curlProbe(url, proxy, env, maxTime = 8) {
  const args = ["-sS", "--max-time", String(maxTime), "-w", "\n__META__%{http_code} %{time_total}"];
  if (proxy) args.push("-x", proxy);
  args.push(url);
  return new Promise((resolve) => {
    execFile("curl", args, { timeout: (maxTime + 2) * 1000, env }, (err, out) => {
      if (err && !out) return resolve(null);
      const i = String(out).lastIndexOf("\n__META__");
      if (i < 0) return resolve(null);
      const [code, t] = String(out).slice(i + 9).trim().split(" ");
      const status = Number(code);
      resolve(status ? { status, ms: Math.round(Number(t) * 1000), body: String(out).slice(0, i) } : null);
    });
  });
}

/** Claude 不服务的地区（官方支持列表之外、最常见的几个） */
const CLAUDE_BLOCKED = new Set(["CN", "HK", "MO", "RU", "BY", "IR", "KP", "SY", "CU"]);

/**
 * 出口体检 —— 站在 Claude 的角度看这个环境：
 *   1. Claude 看到的出口（claude.ai/cdn-cgi/trace，走这个环境的代理）
 *   2. IP 属性（ip-api：归属、运营商、机房 / 代理 / 移动）
 *   3. 风险分（proxycheck.io 免费档的 risk 0–100 + 类型）
 *   4. 连通：claude.ai / api.anthropic.com 延迟，官方状态页
 *   5. 一致性：环境的时区、语言 跟出口所在地对不对得上
 *
 * 信任分是我们按这几项估的，不是 Anthropic 的内部分数 —— 界面上照实说。
 */
ipcMain.handle("account:netReport", async (_e, { id }) => {
  const a = resolveAccount(id);
  const env = acct.envForAccount(a);
  const proxy = acct.proxyOrNothing(a);

  const [trace, api, statusPage] = await Promise.all([
    curlProbe("https://claude.ai/cdn-cgi/trace", proxy, env),
    curlProbe("https://api.anthropic.com/", proxy, env),
    curlProbe("https://status.claude.com/api/v2/status.json", proxy, env),
  ]);
  const tr = {};
  if (trace?.body) for (const line of trace.body.split("\n")) {
    const k = line.indexOf("=");
    if (k > 0) tr[line.slice(0, k)] = line.slice(k + 1).trim();
  }
  let ip = tr.ip || null;
  if (!ip) ip = (await acct.checkExitIp(a))?.ip ?? null;
  if (!ip) return { ok: false, reason: "拿不到出口 IP：代理不可达或网络不通" };

  const [info, risk] = await Promise.all([
    lookupIpInfo(ip),
    curlProbe(`https://proxycheck.io/v2/${ip}?vpn=1&risk=1&asn=1`, null, process.env, 6).then((r) => {
      try {
        const j = JSON.parse(r?.body || "");
        const d = j[ip];
        return d ? { risk: Number(d.risk ?? 0), type: d.type || "", proxy: d.proxy === "yes", provider: d.provider || "" } : null;
      } catch {
        return null;
      }
    }),
  ]);

  // 信任分：100 − 风险分，再按标记扣
  let score = risk ? 100 - Math.max(0, Math.min(100, risk.risk)) : 80;
  const flags = [];
  if (risk?.proxy || info?.proxy) {
    score = Math.min(score, 30);
    flags.push("被标记为代理 / VPN");
  }
  const hosting = Boolean(info?.hosting) || /hosting|business|data ?cent/i.test(risk?.type || "");
  if (hosting) {
    score -= 15;
    flags.push("机房 IP");
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const loc = tr.loc || info?.countryCode || "";
  const tz = (a.terminal && a.terminal.tz) || "Asia/Shanghai";
  const lang = (a.terminal && a.terminal.lang) || "en_US.UTF-8";
  const ipTz = info?.timezone || "";
  const zhCountries = new Set(["CN", "TW", "HK", "MO", "SG"]);
  let st = null;
  try {
    st = JSON.parse(statusPage?.body || "").status;
  } catch {
    /* 状态页没拿到 */
  }

  return {
    ok: true,
    ip,
    at: Date.now(),
    info,
    risk,
    score,
    flags,
    kind: risk?.type || (info?.mobile ? "Mobile" : hosting ? "Hosting" : "Residential"),
    claude: {
      loc,
      colo: tr.colo || "",
      supported: loc ? !CLAUDE_BLOCKED.has(loc) : null,
      web: trace ? { ok: true, ms: trace.ms } : { ok: false, ms: 0 },
      api: api ? { ok: true, ms: api.ms } : { ok: false, ms: 0 },
      status: st ? { ok: st.indicator === "none", text: st.description } : null,
    },
    consistency: {
      tz,
      ipTz,
      tzOk: !ipTz || tz === ipTz || offsetOf(tz) === offsetOf(ipTz),
      lang,
      langOk: !info?.countryCode || zhCountries.has(info.countryCode) === /^zh/i.test(lang),
    },
  };
});

/** 某个时区当前的 UTC 偏移（分钟）。时区名不同但偏移一样的不算不一致 */
function offsetOf(tz) {
  try {
    const s = new Date().toLocaleString("en-US", { timeZone: tz, timeZoneName: "longOffset" });
    const m = s.match(/GMT([+-]\d{2}):?(\d{2})?/);
    if (!m) return 0;
    const sign = m[1].startsWith("-") ? -1 : 1;
    return Number(m[1]) * 60 + sign * Number(m[2] || 0);
  } catch {
    return NaN;
  }
}

/** 在访达里显示一个目录 —— 只允许家目录下的路径 */
ipcMain.handle("shell:reveal", async (_e, p) => {
  if (typeof p !== "string") return false;
  const abs = path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
  if (!abs.startsWith(os.homedir())) return false;
  if (!fs.existsSync(abs)) return false;
  await shell.openPath(abs);
  return true;
});

/** 账号的窗口是否还在跑（用于禁止轮换） */

// ─────────────────────────────────────────── 自查：把窗口截图存到文件
//
// 给开发期用的：设置了 CLAUDE_BUDDY_SHOT 就等窗口就绪后截一张存下来。
// 走 capturePage 而不是系统截屏，因为后者会被窗口层级/权限影响。

ipcMain.handle("debug:capture", async (_e, opts) => {
  if (!mainWindow) return null;
  const img = await mainWindow.webContents.capturePage();
  const out = (opts && opts.path) || path.join(os.tmpdir(), "claude-buddy-shot.png");
  fs.writeFileSync(out, img.toPNG());
  return out;
});

/**
 * 布局自检：把窗口调到几种极端尺寸，量有没有横向溢出、
 * 有没有元素被挤出视口、有没有文字被裁掉。
 *
 * 这比肉眼看截图靠谱 —— 溢出经常是 3-5px，肉眼看不出来。
 */
async function auditLayout() {
  const sizes = [
    [1280, 800, "基准"],
    [1000, 640, "最小窗口"],
    [1100, 700, "小笔记本"],
    [1440, 900, "大屏"],
    [1200, 680, "矮窗口"],
  ];

  // 每屏单独量：首页、账号页、抽屉、设置
  const screens = [
    ["home", null],
    ["accounts", `[...document.querySelectorAll('.nv')].find(b => b.textContent.includes('账号'))?.click()`],
    [
      "drawer",
      `(async () => {
        await new Promise(r => setTimeout(r, 300));
        document.querySelector('.ar-more')?.click();
        await new Promise(r => setTimeout(r, 400));
        const t = [...document.querySelectorAll('.drawer-s .det-k')].find(b => /统计体积|重新统计/.test(b.textContent));
        if (t) { t.click(); await new Promise(r => setTimeout(r, 700)); }
      })()`,
    ],
    [
      "settings",
      `(async () => {
        document.querySelector('.ov')?.click();
        await new Promise(r => setTimeout(r, 300));
        [...document.querySelectorAll('.nv')].find(b => b.textContent.includes('设置'))?.click();
      })()`,
    ],
  ];

  const report = [];

  for (const [screenName, action] of screens) {
    if (action) {
      try {
        await mainWindow.webContents.executeJavaScript(`(async () => { ${action} })()`, true);
        await new Promise((r) => setTimeout(r, 900));
      } catch {
        /* 跳过 */
      }
    }

    for (const [w, h, label] of sizes) {
      mainWindow.setSize(w, h);
      await new Promise((r) => setTimeout(r, 450));

      const r = await mainWindow.webContents.executeJavaScript(
        `(() => {
        const docW = document.documentElement.clientWidth;
        const docH = document.documentElement.clientHeight;
        const problems = [];

        if (document.documentElement.scrollWidth > docW + 1) {
          problems.push('文档横向溢出 ' + (document.documentElement.scrollWidth - docW) + 'px');
        }

        const all = document.querySelectorAll('.shell *');
        // 判断元素是否在可滚动祖先里 —— 在可滚动容器里的"超出"是正常滚动，不算缺陷
        const inScroller = (el) => {
          let p = el.parentElement;
          while (p && p !== document.body) {
            const cs = getComputedStyle(p);
            if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
            if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
            p = p.parentElement;
          }
          return false;
        };

        for (const el of all) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed') continue;
          if (rect.right > docW + 1 && !inScroller(el)) {
            problems.push('右溢出: ' + (el.className || el.tagName) + ' +' + Math.round(rect.right - docW) + 'px');
          }
          if (rect.bottom > docH + 1 && !inScroller(el)) {
            problems.push('下溢出: ' + (el.className || el.tagName) + ' +' + Math.round(rect.bottom - docH) + 'px');
          }
        }

        for (const el of document.querySelectorAll('.ck-name, .ck-val, .envbar-name, .an b, .det-kv b, .sim-ax-vals')) {
          const cs = getComputedStyle(el);
          if (el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis') {
            problems.push('文字被裁: ' + (el.className || el.tagName));
          }
        }

        const wm = document.querySelector('.wm');
        const wmH = wm ? wm.getBoundingClientRect().height : 0;

        return {
          docW, docH, wmH: Math.round(wmH),
          problems: [...new Set(problems)].slice(0, 6),
          count: problems.length,
        };
      })()`,
        true,
      );

      report.push({ screen: screenName, size: `${w}×${h}`, label, ...r });

      // 只在两头的尺寸存图，中间尺寸没必要
      if ((w === 1000 && h === 640) || (w === 1440 && h === 900)) {
        const img = await mainWindow.webContents.capturePage();
        fs.writeFileSync(
          path.join(process.env.CLAUDE_BUDDY_TOUR_DIR || "/tmp", `${screenName}-${w}x${h}.png`),
          img.toPNG(),
        );
      }
    }
  }

  mainWindow.setSize(1280, 800);
  console.log("[audit]", JSON.stringify(report.filter((r) => r.count > 0), null, 1));
  fs.writeFileSync(
    path.join(process.env.CLAUDE_BUDDY_TOUR_DIR || "/tmp", "layout-audit.json"),
    JSON.stringify(report, null, 2),
  );
  return report;
}

/** 开发期：让渲染层执行一段 JS（用于自动建窗口做端到端自查） */
ipcMain.handle("debug:eval", async (_e, code) => {
  if (!mainWindow) return null;
  return mainWindow.webContents.executeJavaScript(code, true);
});

/**
 * 开发期逐页截图：CLAUDE_BUDDY_TOUR=1 时按脚本切视图并各存一张。
 * 只用来核对设计稿，不在生产路径上。
 */
async function shootTour() {
  const dir = process.env.CLAUDE_BUDDY_TOUR_DIR || "/tmp/nx-tour";
  fs.mkdirSync(dir, { recursive: true });
  const steps = [
    // 1 检查
    ["01-checkup", null],
    [
      "02-create",
      `(() => {
        const next = [...document.querySelectorAll('.ob-acts .btn')].find(b => b.textContent.includes('下一步'));
        if (next && !next.disabled) next.click();
      })()`,
    ],
    // 2 建环境
    [
      "03-env",
      `(async () => {
        const input = document.querySelector('.ob-input');
        if (!input) return 'no-input';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '巡检环境');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
        const btn = [...document.querySelectorAll('.ob-row .btn')].find(b => b.textContent.includes('新建'));
        if (!btn) return 'no-new-btn';
        btn.click();
        // 等环境真的建出来（列表里出现"~/.claude-"）
        for (let i = 0; i < 40; i++) {
          const items = [...document.querySelectorAll('.ob-item-main small')];
          if (items.some(s => s.textContent.includes('.claude-'))) return 'env-created';
          await new Promise(r => setTimeout(r, 150));
        }
        return 'env-timeout';
      })()`,
    ],
    [
      "04-login",
      `(async () => {
        // React commit 有延迟：多等一拍再点，并且确认页面真的换了
        await new Promise(r => setTimeout(r, 600));
        const before = document.querySelector('.ob-step-name')?.textContent;
        const all = [...document.querySelectorAll('button')];
        const t = all.find(b => /跳过登录|下一步/.test(b.textContent) && !b.disabled);
        if (!t) return 'no-button';
        t.click();
        for (let i = 0; i < 30; i++) {
          const now = document.querySelector('.ob-step-name')?.textContent;
          if (now && now !== before) return 'moved:' + before + '→' + now;
          await new Promise(r => setTimeout(r, 150));
        }
        return 'stuck-at:' + before;
      })()`,
    ],
    [
      "05-network",
      `(async () => {
        // 已经到第 3 步（网络出口），扫一次代理
        document.querySelector('.proxy-scan')?.click();
        await new Promise(r => setTimeout(r, 300));
        return 'step:' + (document.querySelector('.ob-step-name')?.textContent ?? '?');
      })()`,
    ],
    // 等真实探测结果
    ["06-network-scanned", null],
    [
      "07-home",
      `(() => {
        const go = [...document.querySelectorAll('.ob-acts .btn')].find(b => b.textContent.includes('开始使用'));
        if (go) go.click();
      })()`,
    ],
    [
      "08-accounts",
      `[...document.querySelectorAll('.nv')].find((b) => b.textContent.includes('账号'))?.click()`,
    ],
    [
      "09-account-detail",
      `(async () => {
        // 等账号行渲染出来再点，别用固定 sleep 赌时序
        let more = null;
        for (let i = 0; i < 40; i++) {
          more = document.querySelector('.ar-more');
          if (more) break;
          await new Promise(r => setTimeout(r, 150));
        }
        if (!more) return 'no-ar-more:' + [...document.querySelectorAll('.ar')].length;
        more.click();
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('.drawer')) break;
          await new Promise(r => setTimeout(r, 150));
        }
        // 展开痕迹 + 会话
        const clickByText = async (re) => {
          const b = [...document.querySelectorAll('.drawer-s .det-k')].find(x => re.test(x.textContent));
          if (b) { b.click(); await new Promise(r => setTimeout(r, 800)); }
          return Boolean(b);
        };
        const a = await clickByText(/统计体积|重新统计/);
        // 按所在段落找按钮 —— 登录区也有个"刷新"，不能用文字模糊匹配
        let b = false;
        const sessSec = [...document.querySelectorAll('.drawer-s')].find(sec => sec.textContent.includes('历史会话'));
        const sessBtn = sessSec ? sessSec.querySelector('.det-k') : null;
        if (sessBtn) { sessBtn.click(); b = true; await new Promise(r => setTimeout(r, 900)); }
        // 画完这一帧再报，别让调用方抢在渲染前截图
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 500));
        const dr = document.querySelector('.drawer');
        const box = dr ? dr.getBoundingClientRect() : null;
        // 滚到最底部，把"历史会话 / 删除环境"也露出来
        const body = document.querySelector('.drawer-b');
        if (body) body.scrollTop = body.scrollHeight;
        await new Promise(r => setTimeout(r, 400));
        return 'drawer:' + Boolean(dr) + ' size:' + (box ? Math.round(box.width) + 'x' + Math.round(box.height) : '-') + ' traces:' + a + ' sessions:' + b
          + ' scrollH:' + (body ? body.scrollHeight : 0);
      })()`,
    ],
    [
      "10-settings",
      `[...document.querySelectorAll('.nv')].find((b) => b.textContent.includes('设置'))?.click()`,
    ],
    [
      "11-palette",
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}))`,
    ],
    [
      "11-dark",
      `(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        [...document.querySelectorAll('.nv')].find((b)=>b.textContent.includes('设置'))?.click();
        await new Promise(r=>setTimeout(r,300));
        [...document.querySelectorAll('.seg button')].find((b)=>b.textContent==='深色')?.click();
        await new Promise(r=>setTimeout(r,300));
        [...document.querySelectorAll('.nv')].find((b)=>b.textContent.includes('账号'))?.click();
      })()`,
    ],
  ];

  for (const [name, code] of steps) {
    if (code) {
      try {
        const r = await mainWindow.webContents.executeJavaScript(`(async () => (${code}))()`, true);
        if (r !== undefined) console.log(`[tour] ${name} →`, JSON.stringify(r));
      } catch (err) {
        console.error(`[tour] ${name} 失败:`, err?.message);
      }
      await new Promise((r) => setTimeout(r, 1600));
    }
    // 等登录 PTY 起 shell、跑 rc、打出 URL 并停在 Paste code
    // 建环境要写磁盘 + 更新状态，多等一会再点下一步
    if (name === "03-env") await new Promise((r) => setTimeout(r, 2200));
    if (name === "05-network") await new Promise((r) => setTimeout(r, 5000));
    const img = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  }
  console.log("[claude-buddy] tour 截图完成:", dir);

  // 几何自检：量关键容器的实际盒子，跟设计稿的数值逐条对
  const geo = await mainWindow.webContents.executeJavaScript(
    `(() => {
      const q = (sel) => document.querySelector(sel);
      const box = (sel) => { const el = q(sel); if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { w: Math.round(r.width), h: Math.round(r.height),
                 left: Math.round(r.left), top: Math.round(r.top),
                 pad: cs.padding, margin: cs.margin, gap: cs.gap, radius: cs.borderRadius }; };
      return {
        vw: innerWidth, vh: innerHeight,
        iconSizes: (() => {
          const seen = new Map();
          document.querySelectorAll('svg').forEach((s) => {
            const r = s.getBoundingClientRect();
            const k = Math.round(r.width);
            seen.set(k, (seen.get(k) || 0) + 1);
          });
          return Object.fromEntries([...seen].sort((a, b) => a[0] - b[0]));
        })(),
        navIcon: (() => { const s = document.querySelector('.nv svg'); if (!s) return null;
          const r = s.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        sidebar: box('.ws'), lights: box('.lights'), newBtn: box('.new'),
        home: box('.home'), greet: box('.greet'), composer: box('.composer'),
        st: box('.st'), stNav: box('.st-nav'), stBody: box('.st-body'),
        pg: box('.pg'), banner: box('.banner'), ar: box('.ar'),
        sh: box('.sh'), tw: box('.tw'), twbar: box('.tw-bar'),
        insp: box('.insp'), inSection: box('.in-s'), wh: box('.wh'),
      };
    })()`,
    true,
  );
  fs.writeFileSync(path.join(dir, "geometry.json"), JSON.stringify(geo, null, 2));
  console.log("[claude-buddy] 几何:", JSON.stringify(geo));

  app.quit();
}

// ─────────────────────────────────────────── 开发期自动建窗（端到端自查用）
//
// 设了 CLAUDE_BUDDY_E2E_WINDOW 就等窗口就绪后自动建一个终端窗口，
// 用来验证「渲染层 → IPC → 环境组装 → PTY → xterm」整条链。
// 生产环境这个变量不会存在，走不到这里。

function autoWindowIfRequested() {
  const cwd = process.env.CLAUDE_BUDDY_E2E_WINDOW;
  if (!cwd || !mainWindow) return;
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const payload = JSON.stringify({
      id: "w-e2e-" + Date.now().toString(36),
      title: path.basename(cwd) || "demo",
      accountId: "default",
      cwd,
      isolation: "local",
      runsClaude: process.env.CLAUDE_BUDDY_E2E_CLAUDE === "1",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    mainWindow.webContents
      .executeJavaScript(
        `(() => {
          const w = ${payload};
          window.__claudeBuddyE2EAddWindow && window.__claudeBuddyE2EAddWindow(w);
          return true;
        })()`,
        true,
      )
      .catch((e) => console.error("[claude-buddy] e2e 建窗失败:", e?.message));
  }, 1200);
}

// ─────────────────────────────────────────── 生命周期

app.whenReady().then(() => {
  // 开发态 Dock 图标不会自动用打包图标，显式设一次
  if (process.platform === "darwin" && app.dock) {
    const icon = dockIconPath();
    if (icon) {
      try {
        app.dock.setIcon(icon);
      } catch (err) {
        console.error("[claude-buddy] Dock 图标设置失败：", err?.message);
      }
    }
  }

  // 系统主题变化推给渲染层（theme=system 时用）
  nativeTheme.on("updated", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("theme:system", nativeTheme.shouldUseDarkColors);
    }
  });

  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "ClaudeBuddy",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "编辑",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "窗口",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
      ]),
    );
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  console.log("[claude-buddy] 所有窗口已关闭，准备退出");
  // 终端宿主：最后一个窗口关掉就该退出，macOS 也这样 ——
  // 留着后台进程跑 PTY 不是这个应用该有的行为
  for (const id of [...terms.keys()]) killTerm(id);
  app.quit();
});
