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
    gitInfo: async () => ({ branch: "main", changes: [], totalAdd: 0, totalDel: 0 }),
    recentProjects: async () => previewRecent,
    sessionUsage: async () => null,

    onSystemTheme: () => () => {},
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).claudeBuddy = bridge;
}
