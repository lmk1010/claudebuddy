/**
 * 浏览器降级桥 —— 只在 Electron 之外（直接开 vite dev）生效。
 *
 * 它不是安全边界，也不模拟 PTY 与 CLI：终端会显示提示，
 * 登录/登出这类需要真实进程的操作会明确失败，而不是假装成功。
 */

import type { ClaudeBuddyBridge } from "./bridge";

export function installBrowserFallback(): void {
  if (typeof window === "undefined") return;
  if (window.claudeBuddy) return;

  const unsupported = "浏览器预览模式没有主进程，请用 npm run app 启动 Electron";

  /* 预览模式给一份“用过一阵子”的存档：直接落在主页，而不是每次从引导屏开始。
     只影响浏览器直开 vite 的场景，Electron 里这段根本不会执行。 */
  const now = Date.now();
  const previewAccounts = [
    {
      id: "default",
      label: "个人",
      configDir: ".claude",
      tint: "#141413",
      auth: "signedIn" as const,
      email: "mk@personal.dev",
      proxy: { protocol: "none" as const, host: "", port: 0 },
      identity: { userID: "u-preview", machineID: "m-preview", rotateOnNextLaunch: false },
      terminal: { env: {}, shell: "" },
      createdAt: now - 90 * 86400_000,
      lastUsedAt: now - 120_000,
    },
    {
      id: "acc-main",
      label: "工作",
      configDir: ".claude-main",
      tint: "#3d3b36",
      auth: "signedIn" as const,
      email: "mk@company.com",
      proxy: { protocol: "http" as const, host: "127.0.0.1", port: 7890 },
      identity: { userID: "u-preview-2", machineID: "m-preview-2", rotateOnNextLaunch: false },
      terminal: { env: {}, shell: "" },
      createdAt: now - 30 * 86400_000,
      lastUsedAt: now - 3600_000,
    },
  ];
  const previewState = {
    accounts: previewAccounts,
    windows: [],
    activeWindowId: null,
    activeAccountId: "default",
    view: "home" as const,
    theme: "system" as const,
    uiScale: 1,
    onboarded: true,
    lastCwd: "/Users/you/work/api-server",
    permission: "acceptEdits" as const,
    rhythmGuard: true,
    rhythmThreshold: 12,
    cursorStyle: "bar" as const,
    cursorBlink: true,
    copyOnSelect: false,
    terminalFontSize: 13,
    terminalFontFamily: "JetBrains Mono",
    restoreSessions: true,
    sidebarOpen: true,
    bannerDismissed: false,
    onboardingStep: 1,
  };
  const previewRecent = [
    {
      cwd: "/Users/you/work/api-server",
      name: "api-server",
      accountId: "default",
      configDir: ".claude",
      sessions: 14,
      lastActive: now - 120_000,
    },
    {
      cwd: "/Users/you/work/migrate-db",
      name: "migrate-db",
      accountId: "acc-main",
      configDir: ".claude-main",
      sessions: 6,
      lastActive: now - 3600_000,
    },
    {
      cwd: "/Users/you/AI/neox-shell",
      name: "neox-shell",
      accountId: "default",
      configDir: ".claude",
      sessions: 9,
      lastActive: now - 86400_000,
    },
  ];

  const bridge: ClaudeBuddyBridge = {
    info: async () => ({
      platform: "browser",
      home: "/Users/you",
      username: "Alex",
      version: "preview",
      ptyAvailable: false,
      darkMode: false,
      forcedTheme: null,
    }),
    loadState: async () => previewState,
    saveState: async () => true,

    spawnTerm: async () => ({ ok: false, error: unsupported }),
    writeTerm: () => {},
    resizeTerm: () => {},
    killTerm: () => {},
    onTermData: () => () => {},
    onTermExit: () => () => {},
    activity: async () => [],

    /* 代理探测：浏览器里没有本机网络能力 */
    proxyDiscover: async () => ({ list: [], directIp: null }),
    proxyTest: async () => ({ ok: false, ip: null, reason: unsupported }),

    /* 环境自检：浏览器里查不了真实环境，全部标成未知 */
    checkupRun: async () => ({
      ok: false,
      items: [
        {
          key: "claude",
          label: "Claude Code",
          status: "warn" as const,
          title: "无法检测",
          detail: "浏览器预览模式查不到本机环境",
          fix: "用 npm run app 启动 Electron",
          action: null,
        },
      ],
      claudePath: null,
      blocking: [],
    }),
    checkupInstall: async () => ({ ok: false, code: -1, error: unsupported }),
    checkupRecheck: async () => ({
      ok: false,
      items: [],
      claudePath: null,
      blocking: [],
    }),
    onCheckupLog: () => () => {},

    /* 浏览器里没有主进程，发不了探测请求 —— 如实返回"没测"，不要编结果。 */
    diagnoseRun: async () => ({
      ok: false,
      checkedAt: new Date().toISOString(),
      exitIp: null,
      layers: [],
      blocker: null,
      uaVerdict: {
        tested: false,
        uaDecidesResult: false,
        browser: null,
        cli: null,
        summary: unsupported,
      },
      headline: unsupported,
      unverified: [],
    }),

    /* 体检与清理都依赖主进程读磁盘和 Keychain，浏览器里没有 —— 如实返回未支持。 */
    cleanupSurvey: async () => ({
      ok: false,
      checkedAt: new Date().toISOString(),
      accounts: [],
      orphans: [],
      suggested: { accountIds: [], services: [], reason: unsupported },
    }),
    cleanupPurge: async () => ({
      ok: false,
      moved: [],
      keychainDeleted: [],
      unregistered: [],
      failed: [{ reason: unsupported }],
      trashRoot: "",
    }),

    accountStatus: async (id) => ({
      exists: true,
      auth: "signedIn",
      configDir: `~/.claude-${id}`,
      email: "mk@personal.dev",
      accountUuid: "u-preview",
      orgUuid: null,
      tier: "Max",
      identity: { userID: "u-preview", machineID: "m-preview" },
    }),
    accountLogin: async () => ({ ok: false, termId: undefined }),
    browsersList: async () => [
      { id: "system", label: "系统默认浏览器", sub: "", group: "default" },
      { id: "chrome:Profile 2", label: "Chrome · 工作", sub: "work@gmail.com", group: "browser" },
      { id: "chrome:Profile 5", label: "Chrome · 实验室", sub: "lab@example.com", group: "browser" },
      { id: "edge:Default", label: "Edge", sub: "", group: "browser" },
      { id: "safari", label: "Safari", sub: "", group: "browser" },
      { id: "chrome:private", label: "Chrome 无痕窗口", sub: "不带任何已登录的账号", group: "private", private: true },
      { id: "copy", label: "复制登录链接", sub: "自己粘到任意浏览器", group: "copy" },
    ],
    onLoginUrl: () => () => {},
    setLang: async () => true,
    accountCloseLogin: async () => false,
    accountLogout: async () => ({ ok: false, output: unsupported }),
    accountCheckExit: async () => ({ ok: false, ip: null, reason: unsupported }),
    accountRotateIdentity: async () => ({ ok: false, reason: unsupported }),
    accountTraces: async () => [],
    accountClearTraces: async () => ({
      ok: false,
      removed: [],
      failed: [],
      reason: unsupported,
    }),
    accountKeychain: async () => [],
    accountScan: async () => [],
    accountSessions: async () => [],
    accountRemove: async () => ({ ok: false, reason: unsupported }),
    onLoginExit: () => () => {},
    onAccountFlag: () => () => {},

    pickFolder: async () => "/Users/you/projects/demo",
    openExternal: async (url) => {
      window.open(url, "_blank");
      return true;
    },
    reveal: async () => false,
    ipInfo: async (ip) => ({
      ip,
      country: "美国",
      countryCode: "US",
      region: "加利福尼亚",
      city: "洛杉矶",
      isp: "Preview Networks",
      org: "",
      as: "AS00000 Preview",
      mobile: false,
      proxy: false,
      hosting: true,
    }),
    netTest: async (id) => {
      await new Promise((r) => setTimeout(r, 900));
      const T = (tid: string, host: string, role: string, d: number, c: number, t: number, f: number, j: number, code: number, err?: string) => ({
        id: tid, host, url: `https://${host}/`, role, rounds: 4, okCount: err ? 0 : 4, loss: err ? 100 : 0,
        dns: d, tcp: c, tls: t, ttfb: f, total: d + c + t + f, min: d + c + t + f - j, max: d + c + t + f + j, jitter: j,
        code: err ? 0 : code, remoteIp: "160.79.104.10", tlsOk: err ? null : true, http: "2", error: err ?? null,
      });
      return {
        ok: true, at: Date.now(), tookMs: 14020, route: { label: id ? "环境" : "本机直连", proxy: id ? "http://127.0.0.1:7890" : null }, rounds: 4,
        targets: [
          T("api", "api.anthropic.com", "模型 API（对话、补全都走这里）", 2, 1, 704, 306, 229, 404),
          T("web", "claude.ai", "登录授权、网页", 2, 0, 584, 303, 146, 200),
          T("console", "console.anthropic.com", "OAuth 回调、账号", 2, 0, 781, 403, 582, 301),
          T("dist", "storage.googleapis.com", "Claude Code 安装包 / 自动更新", 3, 1, 410, 220, 90, 400),
          T("status", "status.claude.com", "官方状态页", 68, 1, 842, 560, 682, 200),
        ],
        dns: [
          { host: "api.anthropic.com", sys: ["160.79.104.10", "2607:6bc0::10"], doh: ["160.79.104.10"], dohVia: "Google", fake: false, bogus: false, mismatch: false },
          { host: "claude.ai", sys: ["160.79.104.10"], doh: ["160.79.104.10"], dohVia: "Google", fake: false, bogus: false, mismatch: false },
          { host: "console.anthropic.com", sys: ["160.79.104.10"], doh: ["160.79.104.10"], dohVia: "Google", fake: false, bogus: false, mismatch: false },
        ],
        local: { systemProxy: [{ kind: "HTTPS", addr: "127.0.0.1:7890" }, { kind: "SOCKS", addr: "127.0.0.1:7890" }], processProxy: [], tunLikely: !id, fakeIp: false, ipv6: "240e:45a:2e02:402d::1" },
        exits: { direct: "185.186.60.71", route: id ? "185.186.60.71" : null },
        exitInfo: {
          direct: { ip: "185.186.60.71", country: "美国", countryCode: "US", region: "加利福尼亚", city: "洛杉矶", isp: "Guidance Hosting Inc", org: "", as: "AS6282", mobile: false, proxy: false, hosting: false },
          route: null,
          v6: { ip: "240e::1", country: "中国", countryCode: "CN", region: "安徽", city: "合肥", isp: "China Telecom", org: "", as: "AS4134", mobile: false, proxy: false, hosting: false },
        },
      };
    },
    netReport: async () => ({
      ok: true,
      ip: "185.186.60.71",
      at: Date.now(),
      info: {
        ip: "185.186.60.71",
        country: "美国",
        countryCode: "US",
        region: "加利福尼亚",
        city: "洛杉矶",
        isp: "Guidance Hosting Inc",
        org: "Atlantis Broadband LLC",
        as: "AS6282 Fiber Optical Network LLC",
        mobile: false,
        proxy: false,
        hosting: false,
        timezone: "America/Los_Angeles",
      },
      risk: { risk: 0, type: "Residential", proxy: false, provider: "Fiber Optical Network LLC" },
      score: 100,
      flags: [],
      kind: "Residential",
      claude: {
        loc: "US",
        colo: "LAX",
        supported: true,
        web: { ok: true, ms: 312 },
        api: { ok: true, ms: 790 },
        status: { ok: true, text: "All Systems Operational" },
      },
      consistency: { tz: "Asia/Shanghai", ipTz: "America/Los_Angeles", tzOk: false, lang: "en_US.UTF-8", langOk: true },
    }),
    gitInfo: async () => ({ branch: "main", changes: [], totalAdd: 0, totalDel: 0 }),
    recentProjects: async () => previewRecent,
    sessionUsage: async () => null,

    onSystemTheme: () => () => {},
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).claudeBuddy = bridge;
}
