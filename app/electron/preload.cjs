/**
 * 渲染层与主进程之间唯一的通道。
 *
 * 安全约定：
 *   · 渲染层拿不到 fs / child_process / env —— 只有下面这些具名方法。
 *   · 账号一律用 id 引用，目录与环境由主进程组装。
 *   · 所有返回值都是纯数据，不含函数与路径逃逸能力。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeBuddy", {
  /* ── 应用信息 ── */
  info: () => ipcRenderer.invoke("app:info"),

  /* ── 状态持久化 ── */
  loadState: () => ipcRenderer.invoke("state:load"),
  saveState: (state) => ipcRenderer.invoke("state:save", state),

  /* ── 终端 ── */
  spawnTerm: (opts) => ipcRenderer.invoke("term:spawn", opts),
  writeTerm: (id, data) => ipcRenderer.send("term:write", { id, data }),
  resizeTerm: (id, cols, rows) => ipcRenderer.send("term:resize", { id, cols, rows }),
  killTerm: (id) => ipcRenderer.send("term:kill", { id }),
  attachTerm: (id) => ipcRenderer.invoke("term:attach", { id }),
  liveTerms: () => ipcRenderer.invoke("term:live"),
  onTermData: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on("term:data", h);
    return () => ipcRenderer.off("term:data", h);
  },
  onTermExit: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on("term:exit", h);
    return () => ipcRenderer.off("term:exit", h);
  },

  /* ── 节奏采样 ── */
  activity: () => ipcRenderer.invoke("term:activity"),

  /* ── 代理 ── */
  proxyDiscover: (id) => ipcRenderer.invoke("proxy:discover", { id }),
  proxyTest: (proxy) => ipcRenderer.invoke("proxy:test", proxy),

  /* ── 环境自检 ── */
  checkupRun: () => ipcRenderer.invoke("checkup:run"),
  checkupInstall: () => ipcRenderer.invoke("checkup:install"),
  checkupRecheck: () => ipcRenderer.invoke("checkup:recheck"),
  onCheckupLog: (cb) => {
    const h = (_e, text) => cb(text);
    ipcRenderer.on("checkup:log", h);
    return () => ipcRenderer.off("checkup:log", h);
  },

  /* ── 连通性归因：403 是哪一层挡的 ── */
  diagnoseRun: () => ipcRenderer.invoke("diagnose:run"),

  /* ── 账号体检与清理 ── */
  cleanupSurvey: () => ipcRenderer.invoke("cleanup:survey"),
  cleanupPurge: (payload) => ipcRenderer.invoke("cleanup:purge", payload),

  /* ── 账号：登录闭环 ── */
  accountStatus: (id) => ipcRenderer.invoke("account:status", { id }),
  accountLogin: (id, browser) => ipcRenderer.invoke("account:login", { id, browser }),
  browsersList: () => ipcRenderer.invoke("browsers:list"),
  setLang: (l) => ipcRenderer.invoke("app:setLang", l),
  onLoginUrl: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on("login:url", h);
    return () => ipcRenderer.removeListener("login:url", h);
  },
  accountCloseLogin: (id, termId) => ipcRenderer.invoke("account:closeLogin", { id, termId }),
  accountLogout: (id) => ipcRenderer.invoke("account:logout", { id }),
  accountCheckExit: (id) => ipcRenderer.invoke("account:checkExit", { id }),
  accountRotateIdentity: (id) => ipcRenderer.invoke("account:rotateIdentity", { id }),
  accountTraces: (id) => ipcRenderer.invoke("account:traces", { id }),
  accountRepos: (id) => ipcRenderer.invoke("account:repos", { id }),
  desktopProbe: (force) => ipcRenderer.invoke("desktop:probe", { force }),
  leakProbe: (force) => ipcRenderer.invoke("leak:udp", { force }),
  riskAudit: () => ipcRenderer.invoke("risk:audit"),
  accountClearTraces: (id, keys, includeCredentials) =>
    ipcRenderer.invoke("account:clearTraces", { id, keys, includeCredentials }),
  accountKeychain: () => ipcRenderer.invoke("account:keychain"),
  accountScan: () => ipcRenderer.invoke("account:scan"),
  accountRemove: (id, purge) => ipcRenderer.invoke("account:remove", { id, purge }),
  accountSessions: (id) => ipcRenderer.invoke("account:sessions", { id }),
  accountSessions: (id, limit) => ipcRenderer.invoke("account:sessions", { id, limit }),
  onLoginExit: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on("login:exit", h);
    return () => ipcRenderer.off("login:exit", h);
  },
  onAccountFlag: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on("account:flag", h);
    return () => ipcRenderer.off("account:flag", h);
  },

  /* ── 系统 ── */
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  reveal: (p) => ipcRenderer.invoke("shell:reveal", p),
  ipInfo: (ip) => ipcRenderer.invoke("ip:info", ip),
  netReport: (id) => ipcRenderer.invoke("account:netReport", { id }),
  netTest: (id, rounds) => ipcRenderer.invoke("net:test", { id, rounds }),

  /* ── 项目与工作区 ── */
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  gitInfo: (cwd) => ipcRenderer.invoke("git:info", cwd),
  recentProjects: (id) => ipcRenderer.invoke("projects:recent", { id }),
  sessionUsage: (opts) => ipcRenderer.invoke("session:usage", opts),

  /* ── 自动更新 ── */
  updateState: () => ipcRenderer.invoke("update:state"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateDownload: () => ipcRenderer.invoke("update:download"),
  updateInstall: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on("update:state", h);
    return () => ipcRenderer.off("update:state", h);
  },

  /* ── 系统主题 ── */
  onSystemTheme: (cb) => {
    const h = (_e, dark) => cb(dark);
    ipcRenderer.on("theme:system", h);
    return () => ipcRenderer.off("theme:system", h);
  },
});
