import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import SessionMain from "./components/SessionMain";
import Inspector, { InspectorEmpty } from "./components/Inspector";
import AccountsPage, { CreateEnvDialog, EnvModal, ImportDialog, type EnvSection } from "./components/Accounts";
import Sessions from "./components/Sessions";
import Home from "./components/Home";
import Settings, { type SettingsCat } from "./components/Settings";
import CommandPalette from "./components/CommandPalette";
import Onboarding from "./components/Onboarding";
import Modal, { ConfirmDialog } from "./components/Modal";
import { assessSafety } from "./components/SafetyBadge";
import {
  IconAccounts,
  IconAuto,
  IconCheck,
  IconClose,
  IconGear,
  IconPanel,
  IconPlan,
  IconSettings,
  IconShield,
  IconTrash,
} from "./components/iconAliases";
import {
  ACCOUNT_TINTS,
  LEGACY_TINTS,
  nextTint,
  AUTH_LABEL,
  createAccount,
  defaultAccount,
  prettyName,
  compareEnvironments,
  suggestDistinctTerminal,
  type Account,
  type AccountStatusSnapshot,
  type BuddyState,
  type GitInfo,
  type PermissionMode,
  type ProxyConfig,
  type RecentProject,
  type RhythmStats,
  type ShellWindow,
  type ThemeMode,
  type View,
} from "./lib/model";
import type {
  CheckupResult,
  ProxyCandidate,
  SessionUsage,
  TraceItem,
  KeychainEntry,
  ScannedDir,
  SessionSummary,
} from "./lib/bridge";
import "./styles/app.css";
import "./styles/ui.css";

/**
 * ClaudeBuddy 主应用。
 *
 * 一条数据主线：账号是所有隔离的载体。
 *   · 账号 → 配置目录 → CLAUDE_CONFIG_DIR → 一整套独立痕迹
 *   · 账号 → 代理 → HTTPS_PROXY → 一个固定的网络出口
 *   · 账号 → userID / machineID → 遥测里的 device_id
 *
 * 所有"状态"都从主进程实时读，不在渲染层缓存结论：
 * 登录态、出口 IP、身份、痕迹体积，都不是本地猜的。
 */

const EMPTY_STATE: BuddyState = {
  accounts: [defaultAccount()],
  windows: [],
  activeWindowId: null,
  activeAccountId: null,
  view: "home",
  theme: "system",
  uiScale: 1,
  onboarded: false,
  lastCwd: null,
  permission: "acceptEdits",
  rhythmGuard: true,
  rhythmThreshold: 12,
  cursorStyle: "bar",
  cursorBlink: true,
  copyOnSelect: false,
  terminalFontSize: 13,
  terminalFontFamily: "JetBrains Mono",
  restoreSessions: true,
  sidebarOpen: true,
  bannerDismissed: false,
  onboardingStep: 1,
};

/** 触发弹层的按钮矩形（视口坐标）—— 弹层靠它决定上下左右 */
interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type Menu =
  | { kind: "account"; at: AnchorRect }
  | { kind: "permission"; at: AnchorRect }
  | null;

export default function App() {
  const [state, setState] = useState<BuddyState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [sysDark, setSysDark] = useState(false);
  const [forcedTheme, setForcedTheme] = useState<"light" | "dark" | null>(null);
  const [ptyOk, setPtyOk] = useState(true);
  const [username, setUsername] = useState("");
  const [home, setHome] = useState("/Users/you");

  // 账号实时状态（全部来自主进程）
  const [status, setStatus] = useState<Record<string, AccountStatusSnapshot>>({});
  const [exitIp, setExitIp] = useState<Record<string, string | null>>({});
  const [, setChecking] = useState<Record<string, boolean>>({});
  /** 从别处直接跳进设置的某个分类（比如账号菜单里的「清理本机」） */
  const [settingsCat, setSettingsCat] = useState<SettingsCat | null>(null);
  const [loginTerm, setLoginTerm] = useState<Record<string, string>>({});
  const [traces, setTraces] = useState<Record<string, TraceItem[] | undefined>>({});
  const [keychain, setKeychain] = useState<KeychainEntry[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [scanned, setScanned] = useState<ScannedDir[] | null>(null);

  // 运行期
  const [stats, setStats] = useState<RhythmStats | null>(null);
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [git, setGit] = useState<GitInfo | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [menu, setMenu] = useState<Menu>(null);
  const [palette, setPalette] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  /**
   * 右侧面板默认收起。
   *
   * 它显示的是「这个会话在跑什么」，而绝大多数时间用户在看终端本身；
   * 默认展开等于把三分之一宽度让给一个暂时不需要看的报表。
   */
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; body?: string } | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  /** 编辑环境弹窗：哪个环境、先停在哪个分类 */
  const [editor, setEditor] = useState<{ id: string; section: EnvSection } | null>(null);
  const drawerAccountId = editor?.id ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  /** 二次确认（关会话等不可撤回的操作） */
  const [confirm, setConfirm] = useState<{ title: string; body: string; okLabel: string; onOk: () => void } | null>(
    null,
  );
  /** 让主界面输入框重新拿焦点的信号 —— 侧栏「新建会话」在主界面上再点一次时用 */
  const [focusSignal, setFocusSignal] = useState(0);
  /** 每个环境的历史会话：undefined = 还没加载 */
  const [sessionsByAccount, setSessionsByAccount] = useState<
    Record<string, SessionSummary[] | undefined>
  >({});

  // ── 环境自检：打开软件第一件事就是查能不能用
  const [checkup, setCheckup] = useState<CheckupResult | null>(null);
  const [checkingUp, setCheckingUp] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState("");

  // ── 代理探测：找本机可用的小飞机
  const [proxyCandidates, setProxyCandidates] = useState<ProxyCandidate[] | null>(null);
  const [directIp, setDirectIp] = useState<string | null>(null);
  const [scanningProxy, setScanningProxy] = useState(false);

  const loadedRef = useRef(false);
  const lastIdRef = useRef("");

  // ── 启动加载
  useEffect(() => {
    let alive = true;
    void (async () => {
      const i = await window.claudeBuddy.info();
      if (!alive) return;
      setSysDark(i.darkMode);
      setUsername(i.username);
      setHome(i.home);
      setPtyOk(i.ptyAvailable);
      if (i.forcedTheme) setForcedTheme(i.forcedTheme);

      const raw = (await window.claudeBuddy.loadState()) as Partial<BuddyState> | null;
      if (!alive) return;
      if (raw && Array.isArray(raw.accounts) && raw.accounts.length > 0) {
        // 旧版标识色全是墨灰、互相分不清 —— 按顺序换成新色板，第一个保持墨色
        const accs = raw.accounts
          .map(normalizeAccount)
          .map((a, i) =>
            LEGACY_TINTS.includes(a.tint.toLowerCase()) ? { ...a, tint: ACCOUNT_TINTS[i % ACCOUNT_TINTS.length] } : a,
          );
        const ids = new Set(accs.map((a) => a.id));
        /**
         * 丢掉引用了已删除环境的会话。
         * 留着的话启动时会拿一个不存在的 accountId 去 spawn，
         * 终端里直接冒一句「启动失败：未知账号」。
         */
        const wins =
          Array.isArray(raw.windows) && raw.restoreSessions !== false
            ? raw.windows
                .filter((w) => ids.has(w.accountId))
                // 老会话：开在家目录、名字还是用户名的，改叫「主目录」
                .map((w) => (w.cwd === i.home && w.title === prettyName(i.home) ? { ...w, title: "主目录" } : w))
            : [];
        const keptActive = wins.some((w) => w.id === raw.activeWindowId);
        setState({
          ...EMPTY_STATE,
          ...raw,
          accounts: accs,
          windows: wins,
          activeWindowId: raw.restoreSessions !== false && keptActive ? (raw.activeWindowId ?? null) : null,
          activeAccountId: raw.activeAccountId ?? raw.accounts[0]?.id ?? null,
          theme: isTheme(raw.theme) ? raw.theme : "system",
          view: isView(raw.view) && !(raw.restoreSessions === false && raw.view === "session") ? raw.view : "home",
        });
      } else {
        setState((s) => ({ ...s, theme: i.darkMode ? "dark" : "light" }));
      }
      loadedRef.current = true;
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    window.claudeBuddy.saveState(state);
  }, [state]);

  // 主题
  const resolvedTheme: "light" | "dark" =
    forcedTheme ?? (state.theme === "system" ? (sysDark ? "dark" : "light") : state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${13.5 * state.uiScale}px`;
  }, [state.uiScale]);

  useEffect(() => {
    const off = window.claudeBuddy.onSystemTheme?.((dark) => setSysDark(dark));
    return off;
  }, []);

  const update = useCallback((patch: Partial<BuddyState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  /** 跑环境自检 —— 启动时、装完之后、用户手动点，都走这里 */
  const runCheckup = useCallback(async () => {
    setCheckingUp(true);
    try {
      setCheckup(await window.claudeBuddy.checkupRun());
    } finally {
      setCheckingUp(false);
    }
  }, []);

  /** 一键装 Claude Code，日志实时显示 */
  const installCli = useCallback(async () => {
    setInstalling(true);
    setInstallLog("");
    const r = await window.claudeBuddy.checkupInstall();
    setInstalling(false);
    setCheckup(await window.claudeBuddy.checkupRecheck());
    setToast({
      title: r.ok ? "装好了" : "安装失败",
      body: r.ok ? "可以继续了" : "看下面的日志，或者自己在终端里装",
    });
  }, []);

  // 装的时候把日志接过来
  useEffect(() => {
    const off = window.claudeBuddy.onCheckupLog((text) =>
      setInstallLog((prev) => (prev + text).slice(-4000)),
    );
    return off;
  }, []);

  const activeAccount = useMemo(
    () => state.accounts.find((a) => a.id === state.activeAccountId) ?? state.accounts[0] ?? null,
    [state.accounts, state.activeAccountId],
  );

  /** 找本机可用代理：系统代理 + 常见端口，只列实测能通的 */
  const scanProxy = useCallback(async () => {
    setScanningProxy(true);
    try {
      const r = await window.claudeBuddy.proxyDiscover(activeAccount?.id);
      setProxyCandidates(r.list);
      setDirectIp(r.directIp);
    } finally {
      setScanningProxy(false);
    }
  }, [activeAccount?.id]);

  const activeWindow = useMemo(
    () => state.windows.find((w) => w.id === state.activeWindowId) ?? null,
    [state.windows, state.activeWindowId],
  );

  /** 抽屉当前指向的账号（按 id 查，切账号不会串） */
  const drawerAccount = useMemo(
    () => (drawerAccountId ? state.accounts.find((a) => a.id === drawerAccountId) ?? null : null),
    [state.accounts, drawerAccountId],
  );

  /** 安全状态：常驻右栏顶部，四步全过才显示"环境就绪" */
  const [safetyOpen, setSafetyOpen] = useState(false);
  const safety = useMemo(
    () =>
      assessSafety(
        activeAccount,
        activeAccount ? status[activeAccount.id] : undefined,
        activeAccount ? exitIp[activeAccount.id] : null,
      ),
    [activeAccount, status, exitIp],
  );

  /**
   * 和"另一个环境"的对比。
   *
   * 挑哪个作对照：优先选另一个已登录的环境 —— 那才是真正需要拉开的两间屋子。
   * 只有一个环境时不显示，免得自说自话。
   */
  const drawerSimilar = useMemo(() => {
    if (!drawerAccount) return null;
    const others = state.accounts.filter((a) => a.id !== drawerAccount.id);
    if (others.length === 0) return null;
    const other = others.find((a) => a.auth === "signedIn") ?? others[0];
    return {
      otherLabel: other.label,
      report: compareEnvironments(drawerAccount, other, (id) => exitIp[id]),
    };
  }, [drawerAccount, state.accounts, exitIp]);

  /**
   * 一键拉开差距：把终端画像换成和现有环境都不同的一组。
   *
   * 只动能动的东西 —— 内核、架构、账号 UUID 一律不碰，也不假装能碰。
   */
  const diversify = useCallback(
    (acc: Account) => {
      const used = state.accounts.filter((a) => a.id !== acc.id).map((a) => a.terminal);
      const next = suggestDistinctTerminal(acc, used.filter(Boolean));
      setState((s) => ({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === acc.id ? { ...a, terminal: next } : a,
        ),
      }));
      setToast({
        title: "终端画像已换",
        body: `${next.term} · ${next.lang} · ${next.tz}`,
      });
    },
    [state.accounts],
  );

  // ── 刷新账号状态（登录态 + 身份）
  const refreshAccount = useCallback(async (id: string) => {
    try {
      const s = await window.claudeBuddy.accountStatus(id);
      setStatus((prev) => ({
        ...prev,
        [id]: {
          exists: s.exists,
          auth: s.auth,
          configDir: s.configDir,
          email: s.email,
          accountUuid: s.accountUuid,
          orgUuid: s.orgUuid,
          tier: s.tier,
          identity: s.identity,
          profile: s.profile
            ? { ...s.profile, repoHashes: [] }
            : undefined,
        },
      }));
    } catch {
      /* 主进程不可用时保持上一次的值 */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    for (const a of state.accounts) {
      await refreshAccount(a.id);
    }
  }, [state.accounts, refreshAccount]);

  useEffect(() => {
    if (!ready) return;
    void refreshAll();
    void window.claudeBuddy.recentProjects(activeAccount?.id).then(setRecent);
    // 首次启动没走完引导时，先把环境查清楚
    if (!state.onboarded) void runCheckup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, refreshAll, activeAccount?.id]);

  // 登录中轮询：只认 CLI 写下的结果，2 秒一次
  useEffect(() => {
    const loggingIn = Object.keys(loginTerm);
    if (loggingIn.length === 0) return;
    const t = setInterval(() => {
      for (const id of loggingIn) void refreshAccount(id);
    }, 2000);
    return () => clearInterval(t);
  }, [loginTerm, refreshAccount]);

  // 登录成功后，把该账号的 email 回写到本地账号表
  useEffect(() => {
    let changed = false;
    const next = state.accounts.map((a) => {
      const s = status[a.id];
      if (!s) return a;
      const patch: Partial<Account> = {};
      if (s.auth !== a.auth) patch.auth = s.auth;
      if (s.email && s.email !== a.email) patch.email = s.email;
      if (s.tier && s.tier !== a.tier) patch.tier = s.tier;
      if (s.accountUuid && s.accountUuid !== a.accountUuid) patch.accountUuid = s.accountUuid;
      if (Object.keys(patch).length === 0) return a;
      changed = true;
      return { ...a, ...patch };
    });
    if (changed) setState((s) => ({ ...s, accounts: next }));
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // 登录进程退出：清掉控制台并复核状态，避免界面挂在"等待输出"
  useEffect(() => {
    const off = window.claudeBuddy.onLoginExit(({ id }) => {
      setLoginTerm((m) => {
        if (!(id in m)) return m;
        const n = { ...m };
        delete n[id];
        return n;
      });
      void refreshAccount(id);
    });
    return off;
  }, [refreshAccount]);

  // 登录终端只在"正在等授权"时才有意义：一旦账号已登录就立刻收掉，
  // 否则 shell 会一直挂着，界面永远停在"等待 CLI 输出"
  useEffect(() => {
    for (const [accId, termId] of Object.entries(loginTerm)) {
      if (status[accId]?.auth !== "signedIn") continue;
      void window.claudeBuddy.accountCloseLogin(accId, termId);
      setLoginTerm((m) => {
        const n = { ...m };
        delete n[accId];
        return n;
      });
      setToast({ title: "登录成功", body: status[accId]?.email ?? "" });
    }
  }, [status, loginTerm]);

  // 页面卸载时把还开着的登录终端关掉，不留孤儿进程
  useEffect(() => {
    const onUnload = () => {
      for (const [accId, termId] of Object.entries(loginTerm)) {
        void window.claudeBuddy.accountCloseLogin(accId, termId);
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [loginTerm]);

  // ── 节奏采样
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!activeWindow || !state.rhythmGuard) {
        setStats(null);
        return;
      }
      const rows = await window.claudeBuddy.activity();
      if (!alive) return;
      const mine = rows.find((r) => r.id === activeWindow.id);
      if (!mine) {
        setStats(null);
        return;
      }
      const perMinute = mine.buckets.length ? mine.buckets[mine.buckets.length - 1] : 0;
      setStats({
        lastHour: mine.lastHour,
        perMinute,
        medianGap: mine.lastHour > 1 ? mine.sessionSeconds / mine.lastHour : 0,
        sessionTotal: mine.lastHour,
        sessionSeconds: mine.sessionSeconds,
        buckets: mine.buckets,
      });
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeWindow, state.rhythmGuard]);

  // ── 上下文用量
  useEffect(() => {
    if (!activeWindow || !activeAccount) {
      setUsage(null);
      return;
    }
    let alive = true;
    const read = () => {
      void window.claudeBuddy
        .sessionUsage({ configDir: activeAccount.configDir, cwd: activeWindow.cwd })
        .then((u) => {
          if (alive) setUsage(u);
        });
    };
    read();
    const t = setInterval(read, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeWindow, activeAccount]);

  // ── git
  useEffect(() => {
    if (!activeWindow) {
      setGit(null);
      return;
    }
    let alive = true;
    const read = () => {
      void window.claudeBuddy.gitInfo(activeWindow.cwd).then((g) => {
        if (alive) setGit(g);
      });
    };
    read();
    const t = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeWindow]);

  // ── 建会话
  const spawnWindow = useCallback((account: Account, cwd: string, runsClaude: boolean) => {
    // 家目录的目录名就是用户名，几个会话全叫同一个名字 分不清 —— 直接叫「主目录」
    const base = cwd === home ? "主目录" : prettyName(cwd);
    const win: ShellWindow = {
      id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: base,
      accountId: account.id,
      cwd,
      runsClaude,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    setState((s) => ({
      ...s,
      // 同一个目录开第二个时，页签上要能分得清：api-server · 2
      windows: [
        ...s.windows,
        {
          ...win,
          title: (() => {
            const taken = new Set(s.windows.map((w) => w.title));
            if (!taken.has(base)) return base;
            let n = 2;
            while (taken.has(`${base} · ${n}`)) n++;
            return `${base} · ${n}`;
          })(),
        },
      ],
      activeWindowId: win.id,
      activeAccountId: account.id,
      view: "session",
      lastCwd: cwd,
    }));
    setShowDiff(false);
    // 进会话先看终端本身，右栏要看再展开
    setInspectorOpen(false);
    void refreshAccount(account.id);
  }, [refreshAccount, home]);

  // 记住最后建的窗口，把首句送进去
  useEffect(() => {
    if (activeWindow) lastIdRef.current = activeWindow.id;
  }, [activeWindow]);

  const pickFolder = useCallback(async (): Promise<string | null> => {
    const picked = await window.claudeBuddy.pickFolder();
    if (!picked) return null;
    update({ lastCwd: picked });
    return picked;
  }, [update]);

  const newSession = useCallback(
    async (runsClaude = true) => {
      const acc = activeAccount;
      if (!acc) return;
      const cwd = state.lastCwd ?? (await pickFolder()) ?? home;
      spawnWindow(acc, cwd, runsClaude);
    },
    [activeAccount, state.lastCwd, pickFolder, home, spawnWindow],
  );

  /**
   * 「新建会话」= 回到主界面、输入框拿焦点。
   * 跟 Claude Desktop 的 New chat 一样：先落到起点，环境和目录都在眼前，写一句回车就开。
   */
  const goNew = useCallback(() => {
    setState((s) => ({ ...s, view: "home" }));
    setFocusSignal((n) => n + 1);
  }, []);

  /** 主界面回车：在当前环境 + 当前目录里起 Claude Code；没选过目录先选 */
  const homeSubmit = useCallback(
    async (text: string) => {
      const acc = activeAccount;
      if (!acc) return;
      const cwd = state.lastCwd ?? (await pickFolder());
      if (!cwd) return;
      spawnWindow(acc, cwd, true);
      if (text) {
        setTimeout(() => window.claudeBuddy.writeTerm(lastIdRef.current, text + "\r"), 2400);
      }
    },
    [activeAccount, state.lastCwd, pickFolder, spawnWindow],
  );

  /**
   * 从 Git 克隆：选一个父目录 → 在那里起一个属于当前账号的 shell →
   * 把 git clone && cd && claude 敲进去。走的仍是这个账号的隔离环境。
   */
  const cloneRepo = useCallback(
    async (url: string) => {
      const acc = activeAccount;
      if (!acc) return;
      const parent = await window.claudeBuddy.pickFolder();
      if (!parent) return;
      const name = repoName(url);
      setCloneOpen(false);
      spawnWindow(acc, parent, false);
      const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
      setTimeout(
        () =>
          window.claudeBuddy.writeTerm(
            lastIdRef.current,
            `git clone ${q(url)} ${q(name)} && cd ${q(name)} && claude\r`,
          ),
        1200,
      );
      setToast({ title: `正在克隆 ${name}`, body: `到 ${prettyName(parent)} 下，完成后自动启动 Claude Code` });
    },
    [activeAccount, spawnWindow],
  );

  /**
   * 请求关闭：先弹确认，确认后才真的关。
   * 直接关会丢掉这个会话的终端进程，而它可能正在跑任务。
   */
  const closeWindow = useCallback((id: string) => {
    window.claudeBuddy.killTerm(id);
    setState((s) => {
      const idx = s.windows.findIndex((w) => w.id === id);
      const windows = s.windows.filter((w) => w.id !== id);
      // 关掉当前页签时落到相邻那一个（右边优先），跟浏览器一样
      const activeWindowId =
        s.activeWindowId === id ? (windows[Math.min(idx, windows.length - 1)]?.id ?? null) : s.activeWindowId;
      return {
        ...s,
        windows,
        activeWindowId,
        view: windows.length === 0 && s.view === "session" ? "home" : s.view,
      };
    });
  }, []);

  const requestCloseWindow = useCallback(
    (id: string) => {
      const w = state.windows.find((x) => x.id === id);
      if (!w) return;
      setConfirm({
        title: `关闭「${w.title}」？`,
        body: "这个会话的终端进程会被结束，正在跑的命令会中断。对话记录还在环境目录里。",
        okLabel: "关闭会话",
        onOk: () => closeWindow(id),
      });
    },
    [state.windows, closeWindow],
  );

  const requestCloseOthers = useCallback(
    (id: string) => {
      const rest = state.windows.filter((x) => x.id !== id);
      if (rest.length === 0) return;
      setConfirm({
        title: `关闭其他 ${rest.length} 个会话？`,
        body: "这些会话的终端进程都会被结束，正在跑的命令会中断。",
        okLabel: `关闭 ${rest.length} 个`,
        onOk: () => {
          for (const w of rest) closeWindow(w.id);
          setState((s) => ({ ...s, activeWindowId: id }));
        },
      });
    },
    [state.windows, closeWindow],
  );

  const renameWindow = useCallback((id: string, title: string) => {
    setState((s) => ({ ...s, windows: s.windows.map((w) => (w.id === id ? { ...w, title } : w)) }));
  }, []);

  const requestCloseMany = useCallback(
    (ids: string[], what: string) => {
      if (ids.length === 0) return;
      setConfirm({
        title: `关闭${what}？`,
        body: "这些会话的终端进程都会被结束，正在跑的命令会中断。对话记录还在环境目录里。",
        okLabel: `关闭 ${ids.length} 个`,
        onOk: () => ids.forEach(closeWindow),
      });
    },
    [closeWindow],
  );

  const reveal = useCallback(async (p: string) => {
    const ok = await window.claudeBuddy.reveal(p);
    if (!ok) setToast({ title: "打不开这个目录", body: "目录不存在，或者不在家目录下" });
  }, []);

  const patchAccount = useCallback((id: string, patch: Partial<Account>) => {
    setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }, []);

  // ── 账号操作
  /**
   * 新环境：终端画像自动分配成和现有环境不重样的一组。
   *
   * 用户不需要知道 TERM/LANG/TZ 是什么 —— 软件本来就该自动做对。
   * 想手动改的，去账号详情里改。
   */
  const addAccount = useCallback(
    (label: string): Account => {
      const taken = state.accounts.map((a) => a.configDir);
      const base = createAccount(label, taken, nextTint(state.accounts.map((a) => a.tint)));
      const used = state.accounts.map((a) => a.terminal).filter(Boolean);
      const acc: Account = { ...base, terminal: suggestDistinctTerminal(base, used) };
      setState((s) => ({
        ...s,
        accounts: [...s.accounts, acc],
        activeAccountId: acc.id,
      }));
      setToast({ title: `已创建 ${acc.label}`, body: `~/${acc.configDir} · 设备码与画像已独立分配` });
      return acc;
    },
    [state.accounts],
  );

  const importDir = useCallback(
    (configDir: string, label: string) => {
      if (state.accounts.some((a) => a.configDir === configDir)) {
        setToast({ title: "这个目录已经导入过了" });
        return;
      }
      const acc: Account = {
        ...defaultAccount(),
        id: `acc-${configDir.replace(/^\./, "").replace(/[^a-z0-9]/g, "-")}`,
        label: label || configDir,
        configDir,
        tint: nextTint(state.accounts.map((a) => a.tint)),
        note: "导入的已有环境",
      };
      setState((s) => ({ ...s, accounts: [...s.accounts, acc], activeAccountId: acc.id }));
      void refreshAccount(acc.id);
      setToast({ title: `已导入 ${acc.label}`, body: `~/${acc.configDir}` });
    },
    [state.accounts, refreshAccount],
  );

  const setProxy = useCallback((id: string, proxy: ProxyConfig) => {
    setState((s) => ({
      ...s,
      accounts: s.accounts.map((a) => (a.id === id ? { ...a, proxy } : a)),
    }));
    setExitIp((prev) => ({ ...prev, [id]: null }));
  }, []);

  const login = useCallback(
    async (id: string) => {
      setBusy((b) => ({ ...b, [id]: true }));
      const r = await window.claudeBuddy.accountLogin(id);
      setBusy((b) => ({ ...b, [id]: false }));
      if (r.ok && r.termId) {
        setLoginTerm((m) => ({ ...m, [id]: r.termId! }));
        setToast({ title: "已打开授权页", body: "浏览器里完成授权后会自动识别" });
      } else {
        setToast({ title: "登录启动失败", body: "请确认已安装 claude CLI" });
      }
    },
    [],
  );

  const logout = useCallback(
    async (id: string) => {
      setBusy((b) => ({ ...b, [id]: true }));
      const r = await window.claudeBuddy.accountLogout(id);
      setBusy((b) => ({ ...b, [id]: false }));
      setLoginTerm((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
      await refreshAccount(id);
      setToast({
        title: r.ok ? "已退出登录" : "退出失败",
        body: r.ok ? "凭据已从 Keychain 清除" : r.output.slice(0, 120),
      });
    },
    [refreshAccount],
  );

  const checkExit = useCallback(
    async (id: string) => {
      setChecking((c) => ({ ...c, [id]: true }));
      const r = await window.claudeBuddy.accountCheckExit(id);
      setChecking((c) => ({ ...c, [id]: false }));
      if (!r.ok || !r.ip) {
        setToast({ title: "出口检测失败", body: r.reason ?? "网络不通或代理不可达" });
        return;
      }
      const prev = state.accounts.find((a) => a.id === id)?.lastExitIp ?? null;
      setExitIp((m) => ({ ...m, [id]: r.ip }));
      setState((s) => ({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === id ? { ...a, lastExitIp: r.ip!, lastExitCheckedAt: Date.now() } : a,
        ),
      }));
      setToast({
        title: `出口 IP ${r.ip}`,
        body: prev && prev !== r.ip ? `注意：从 ${prev} 变了，频繁跳变本身是信号` : "已记录，跟这个账号绑定",
      });
    },
    [state.accounts],
  );

  const rotate = useCallback(
    async (id: string) => {
      setBusy((b) => ({ ...b, [id]: true }));
      const r = await window.claudeBuddy.accountRotateIdentity(id);
      setBusy((b) => ({ ...b, [id]: false }));
      if (!r.ok) {
        setToast({ title: "轮换失败", body: r.reason });
        return;
      }
      await refreshAccount(id);
      setToast({
        title: "设备身份已轮换",
        body: `新 userID ${r.userID?.slice(0, 12)}… · 账号本身没变`,
      });
    },
    [refreshAccount],
  );

  const loadTraces = useCallback(async (id: string) => {
    const t = await window.claudeBuddy.accountTraces(id);
    setTraces((m) => ({ ...m, [id]: t }));
  }, []);

  const loadKeychain = useCallback(async () => {
    const k = await window.claudeBuddy.accountKeychain();
    setKeychain(k);
  }, []);

  const scanImport = useCallback(async () => {
    setScanned(await window.claudeBuddy.accountScan());
  }, []);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => {});
    setToast({ title: "已复制", body: text });
  }, []);

  // ── 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (meta && e.key === ",") {
        e.preventDefault();
        update({ view: "settings" });
        return;
      }
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        goNew();
        return;
      }
      if (meta && e.key.toLowerCase() === "t") {
        e.preventDefault();
        // 在当前会话的同一环境、同一目录再开一个；没有会话就回主界面
        const acc = activeWindow && state.accounts.find((a) => a.id === activeWindow.accountId);
        if (activeWindow && acc && state.view === "session") spawnWindow(acc, activeWindow.cwd, true);
        else goNew();
        return;
      }
      if (meta && e.key.toLowerCase() === "w") {
        if (activeWindow && state.view === "session") {
          e.preventDefault();
          requestCloseWindow(activeWindow.id);
        }
        return;
      }
      if (meta && e.key === "\\") {
        e.preventDefault();
        setState((s) => ({ ...s, sidebarOpen: !s.sidebarOpen }));
        return;
      }
      if (meta && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setInspectorOpen((v) => !v);
        return;
      }
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setShowDiff((v) => !v);
        return;
      }
      // 弹窗自己处理 Esc（带退场动画），这里只管菜单和命令面板
      if (e.key === "Escape") {
        if (palette) setPalette(false);
        else if (menu) setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeWindow, goNew, menu, palette, requestCloseWindow, spawnWindow, state.accounts, state.view, update]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 开发期钩子：主进程可以直接推一个窗口进来
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__claudeBuddyE2EAddWindow = (w: ShellWindow) => {
      setState((s) => ({
        ...s,
        windows: [...s.windows.filter((x) => x.id !== w.id), w],
        activeWindowId: w.id,
        view: "session",
      }));
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__claudeBuddyState = () => state;
  }, [state]);


  if (!ready) return <div className="shell" />;

  // ── 首次引导
  if (!state.onboarded) {
    return (
      <div className="shell">
        <div className="wm">
          <Onboarding
            checkup={checkup}
            checkingUp={checkingUp}
            installLog={installLog}
            installing={installing}
            accounts={state.accounts}
            status={status}
            activeAccount={activeAccount}
            busy={Boolean(activeAccount && busy[activeAccount.id])}
            loginTermId={activeAccount ? (loginTerm[activeAccount.id] ?? null) : null}
            exitIp={exitIp}
            proxyCandidates={proxyCandidates}
            directIp={directIp}
            scanningProxy={scanningProxy}
            onRunCheckup={() => void runCheckup()}
            onInstall={() => void installCli()}
            onCopyCmd={(cmd) => copy(cmd)}
            onOpenFolderScan={async () => window.claudeBuddy.accountScan()}
            onImportDir={importDir}
            onCreateAccount={addAccount}
            onSelectAccount={(id) => update({ activeAccountId: id })}
            onLogin={login}
            onScanProxy={() => void scanProxy()}
            onSetProxy={setProxy}
            onCheckExit={checkExit}
            onFinish={() => {
              update({ onboarded: true, view: "home" });
              void refreshAll();
            }}
            onExit={
              // 已经配过环境的人是从设置里回来重看引导的，给个出口
              state.accounts.length > 1 || state.accounts.some((a) => a.auth === "signedIn")
                ? () => update({ onboarded: true })
                : undefined
            }
          />
        </div>
      </div>
    );
  }

  const view: View = state.view;

  return (
    <div className={`shell${state.sidebarOpen ? "" : " ws-closed"}`}>
      {!state.sidebarOpen && (
        <button className="ib ws-open" title="展开侧栏 ⌘\\" onClick={() => update({ sidebarOpen: true })}>
          <IconPanel />
        </button>
      )}
      <Sidebar
        open={state.sidebarOpen}
        windows={state.windows}
        accounts={state.accounts}
        activeId={state.activeWindowId}
        activeAccount={activeAccount}
        accountStatus={status}
        view={view}
        username={username}
        onSelectWindow={(id) => update({ activeWindowId: id, view: "session" })}
        onCloseWindow={requestCloseWindow}
        onNew={goNew}
        onNav={(v) => update({ view: v })}
        onAccount={(el) => setMenu(anchor("account", el))}
        accountMenuOpen={menu?.kind === "account"}
        onToggleSidebar={() => update({ sidebarOpen: false })}
        onRename={renameWindow}
        onCopy={copy}
        onReveal={(p) => void reveal(p)}
      />

      <div className={`wm${view === "session" && activeWindow ? " term-bg" : ""}`}>
        {view === "sessions" && (
          <Sessions
            accounts={state.accounts}
            windows={state.windows}
            activeWindowId={state.activeWindowId}
            history={sessionsByAccount}
            onLoadHistory={async (id) => {
              const list = await window.claudeBuddy.accountSessions(id);
              setSessionsByAccount((m) => ({ ...m, [id]: list }));
            }}
            onOpen={(id) => update({ activeWindowId: id, view: "session" })}
            onRequestClose={requestCloseWindow}
            onResume={(id, cwd) => {
              const acc = state.accounts.find((a) => a.id === id);
              if (acc) spawnWindow(acc, cwd, true);
            }}
            onNew={goNew}
            onSearch={() => setPalette(true)}
            onRename={renameWindow}
            onCloseMany={requestCloseMany}
            onCopy={copy}
            onReveal={(p) => void reveal(p)}
            onEditAccount={(id) => setEditor({ id, section: "general" })}
          />
        )}

        {(view === "home" || (view === "session" && !activeWindow)) && (
          <Home
            key={focusSignal}
            username={username}
            accounts={state.accounts}
            activeAccount={activeAccount}
            status={status}
            runningBy={state.windows.reduce<Record<string, number>>((m, w) => {
              m[w.accountId] = (m[w.accountId] ?? 0) + 1;
              return m;
            }, {})}
            cwd={state.lastCwd}
            permission={state.permission}
            recent={recent}
            onSelectAccount={(id) => update({ activeAccountId: id })}
            onEditAccount={(id) => setEditor({ id, section: "general" })}
            onCreateAccount={() => setCreateOpen(true)}
            onLogin={(id) => {
              void login(id);
              setEditor({ id, section: "general" });
            }}
            onPickFolder={async () => {
              const cwd = await pickFolder();
              if (cwd) setToast({ title: `已选择 ${prettyName(cwd)}` });
            }}
            onPickPermission={(el) => setMenu(anchor("permission", el))}
            onStart={(t) => void homeSubmit(t)}
            onQuickStart={(proj) => {
              const acc = state.accounts.find((a) => a.id === proj.accountId) ?? activeAccount;
              if (!acc) return;
              spawnWindow(acc, proj.cwd, true);
            }}
            onQuickBlank={() => void newSession(false)}
            onQuickClone={() => setCloneOpen(true)}
            onSearch={() => setPalette(true)}
            onSettings={() => update({ view: "settings" })}
          />
        )}

        {view === "session" &&
          activeWindow && (
            <SessionMain
              windows={state.windows}
              accounts={state.accounts}
              active={activeWindow}
              git={git}
              uiScale={state.uiScale}
              fontSize={state.terminalFontSize}
              fontFamily={state.terminalFontFamily}
              cursorStyle={state.cursorStyle}
              cursorBlink={state.cursorBlink}
              copyOnSelect={state.copyOnSelect}
              ptyOk={ptyOk}
              onSelect={(id) => update({ activeWindowId: id })}
              onToggleConsole={() => setShowDiff(false)}
              onTogglePanel={() => setInspectorOpen((v) => !v)}
              panelOpen={inspectorOpen}
              onRequestClose={requestCloseWindow}
              onRequestCloseOthers={requestCloseOthers}
              onRename={renameWindow}
              showDiff={showDiff}
              onToggleDiff={() => setShowDiff((v) => !v)}
              onNew={() => {
                const acc = state.accounts.find((a) => a.id === activeWindow.accountId) ?? activeAccount;
                if (acc) spawnWindow(acc, activeWindow.cwd, true);
              }}
            />
          )}

        {view === "accounts" && (
          <AccountsPage
            accounts={state.accounts}
            activeId={activeAccount?.id ?? null}
            status={status}
            sessionCount={state.windows.reduce<Record<string, number>>((m, w) => {
              m[w.accountId] = (m[w.accountId] ?? 0) + 1;
              return m;
            }, {})}
            bannerDismissed={state.bannerDismissed}
            onDismissBanner={() => update({ bannerDismissed: true })}
            onCreate={() => setCreateOpen(true)}
            onScanImport={() => void scanImport()}
            onOpenDetail={(a, section) => setEditor({ id: a.id, section: section ?? "general" })}
            onSetActive={(id) => update({ activeAccountId: id })}
            onNewIn={(id) => {
              update({ activeAccountId: id });
              goNew();
            }}
            onLogin={(id) => {
              void login(id);
              setEditor({ id, section: "general" });
            }}
            onLogout={(id) => {
              const a = state.accounts.find((x) => x.id === id);
              setConfirm({
                title: `退出「${a?.label ?? ""}」的登录？`,
                body: "会从 Keychain 清掉这个环境的凭据，之后要重新授权。",
                okLabel: "退出登录",
                onOk: () => void logout(id),
              });
            }}
            onCheckExit={(id) => void checkExit(id)}
            onCopy={copy}
            onReveal={(p) => void reveal(p)}
          />
        )}

        {drawerAccountId && drawerAccount && (
          <EnvModal
            key={drawerAccount.id}
            initialSection={editor?.section}
            canRemove={state.accounts.length > 1}
            onPatch={(patch) => patchAccount(drawerAccount.id, patch)}
            account={drawerAccount}
            status={status[drawerAccount.id]}
            exitIp={exitIp[drawerAccount.id] ?? null}
            loginTermId={loginTerm[drawerAccount.id] ?? null}
            traces={traces[drawerAccount.id]}
            keychain={keychain}
            busy={Boolean(busy[drawerAccount.id])}
            onClose={() => setEditor(null)}
            onLogin={() => login(drawerAccount.id)}
            onLogout={() => logout(drawerAccount.id)}
            onRotate={() => rotate(drawerAccount.id)}
            onLoadTraces={() => loadTraces(drawerAccount.id)}
            onLoadKeychain={loadKeychain}
            onSetProxy={(p) => setProxy(drawerAccount.id, p)}
            onRefresh={() => refreshAccount(drawerAccount.id)}
            onCancelLogin={() => {
              const tid = loginTerm[drawerAccount.id];
              void window.claudeBuddy.accountCloseLogin(drawerAccount.id, tid);
              setLoginTerm((m) => {
                const n = { ...m };
                delete n[drawerAccount.id];
                return n;
              });
            }}
            onOpenTerminal={() => spawnWindow(drawerAccount, state.lastCwd ?? home, true)}
            onDiversify={() => diversify(drawerAccount)}
            similar={drawerSimilar}
            sessions={sessionsByAccount[drawerAccount.id]}
            onLoadSessions={async () => {
              const list = await window.claudeBuddy.accountSessions(drawerAccount.id);
              setSessionsByAccount((m) => ({ ...m, [drawerAccount.id]: list }));
            }}
            onOpenSession={(s) => spawnWindow(drawerAccount, s.cwd, true)}
            onRemove={async (purge) => {
              const acc = drawerAccount;
              setBusy((b) => ({ ...b, [acc.id]: true }));
              const r = await window.claudeBuddy.accountRemove(acc.id, purge);
              setBusy((b) => ({ ...b, [acc.id]: false }));
              if (!r.ok) {
                setToast({ title: "没能删除", body: r.reason });
                return;
              }
              setState((s) => {
                const accounts = s.accounts.filter((a) => a.id !== acc.id);
                return {
                  ...s,
                  accounts,
                  activeAccountId:
                    s.activeAccountId === acc.id ? (accounts[0]?.id ?? null) : s.activeAccountId,
                };
              });
              setEditor(null);
              setToast({
                title: `已移除 ${acc.label}`,
                body: r.purged ? "磁盘目录也一起删了" : "目录保留在磁盘上",
              });
            }}
            onClearTraces={async (keys) => {
              setBusy((b) => ({ ...b, [drawerAccount.id]: true }));
              const r = await window.claudeBuddy.accountClearTraces(drawerAccount.id, keys);
              setBusy((b) => ({ ...b, [drawerAccount.id]: false }));
              if (!r.ok) {
                setToast({ title: "清理失败", body: r.reason ?? "" });
                return;
              }
              await loadTraces(drawerAccount.id);
              setToast({
                title: r.removed.length ? `清掉了 ${r.removed.length} 项` : "没有可清的项",
                body: r.failed.length ? `${r.failed.length} 项被跳过` : "凭据和身份已保留",
              });
            }}
          />
        )}

        {view === "settings" && (
          <Settings
            key={settingsCat ?? "default"}
            initialCat={settingsCat ?? undefined}
            state={state}
            update={update}
            onClose={() => update({ view: "home" })}
          />
        )}

        {!ptyOk && (
          <div className="browser-note">
            浏览器预览模式 · 无 PTY，终端与登录不可用
          </div>
        )}
      </div>

      {view === "session" && (
        <div className={`insp-wrap${inspectorOpen ? "" : " shut"}`}>
            {activeWindow ? (
              <Inspector
                win={activeWindow}
                accountLabel={activeAccount?.label ?? "—"}
                accountEmail={activeAccount ? status[activeAccount.id]?.email : undefined}
                proxy={activeAccount?.proxy}
                stats={stats}
                threshold={state.rhythmThreshold}
                usage={usage}
                git={git}
                safety={safety}
                safetyOpen={safetyOpen}
                onToggleSafety={() => setSafetyOpen((v) => !v)}
                onCopy={copy}
                onShowDiff={() => setShowDiff(true)}
                onClose={() => setInspectorOpen(false)}
              />
            ) : (
              <InspectorEmpty />
            )}
          </div>
      )}

      {palette && (
        <CommandPalette
          windows={state.windows}
          accounts={state.accounts}
          onClose={() => setPalette(false)}
          onOpenWindow={(id) => update({ activeWindowId: id, view: "session" })}
          onNew={goNew}
          onNav={(v) => update({ view: v })}
          onTogglePanel={() => setInspectorOpen((v) => !v)}
          onToggleSidebar={() => update({ sidebarOpen: !state.sidebarOpen })}
          onClone={() => setCloneOpen(true)}
          onSwitchAccount={(id) => {
            update({ activeAccountId: id });
            const a = state.accounts.find((x) => x.id === id);
            if (a) setToast({ title: `已切到 ${a.label}`, body: `~/${a.configDir}` });
          }}
          onOpenDiff={() => {
            update({ view: "session" });
            setShowDiff(true);
          }}
        />
      )}

      {menu && (
        <>
          <div className="pop-backdrop" onClick={() => setMenu(null)} />
          <MenuBody
            menu={menu}
            state={state}
            onPickAccount={(id) => {
              update({ activeAccountId: id });
              setMenu(null);
            }}
            onPickPermission={(p: PermissionMode) => {
              update({ permission: p });
              setMenu(null);
            }}
            onEditAccount={(id) => {
              setMenu(null);
              setEditor({ id, section: "general" });
            }}
            onManageAccounts={() => {
              setMenu(null);
              update({ view: "accounts" });
            }}
            onGuide={() => {
              setMenu(null);
              update({ onboarded: false });
            }}
            onOpenSettings={(cat) => {
              setMenu(null);
              setSettingsCat(cat ?? null);
              update({ view: "settings" });
            }}
          />
        </>
      )}

      {cloneOpen && <CloneDialog onClose={() => setCloneOpen(false)} onClone={(u) => void cloneRepo(u)} />}

      {createOpen && (
        <CreateEnvDialog
          existing={state.accounts.map((a) => a.label)}
          onClose={() => setCreateOpen(false)}
          onCreate={(label) => {
            const acc = addAccount(label);
            void refreshAccount(acc.id);
            // 建完直接进编辑，第一件事就是登录
            setTimeout(() => setEditor({ id: acc.id, section: "general" }), 160);
          }}
        />
      )}

      {scanned && (
        <ImportDialog
          list={scanned}
          imported={state.accounts.map((a) => a.configDir)}
          onImport={importDir}
          onClose={() => setScanned(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          okLabel={confirm.okLabel}
          onOk={confirm.onOk}
          onClose={() => setConfirm(null)}
        />
      )}

      {toast && (
        <div className="toast">
          <div>
            <b>{toast.title}</b>
            {toast.body ? <small>{toast.body}</small> : null}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 弹层锚点 —— 只记录按钮在哪，**不在这里算坐标**。
 *
 * 早前这里是 onclick 里直接量 getBoundingClientRect 然后 Math.min 夹住，
 * 结果侧栏底部那个账号按钮（贴着窗口底边）算出来的 y 被强行顶到
 * "窗口高 - 260"，菜单凭空出现在按钮上方一截、左右也对不齐。
 * 菜单该往上开还是往下开，取决于它自己有多高 —— 那只有渲染出来才知道，
 * 所以定位挪到 MenuBody 里做（useLayoutEffect 先量后摆，不会闪）。
 */
function anchor(kind: "account" | "permission", el: HTMLElement): Menu {
  const r = el.getBoundingClientRect();
  return {
    kind,
    at: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
  } as Menu;
}

function isTheme(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}
function isView(v: unknown): v is View {
  return (
    v === "home" ||
    v === "sessions" ||
    v === "session" ||
    v === "accounts" ||
    v === "settings"
  );
}

/** 老状态文件升级：补齐新增字段，避免旧数据把新字段变成 undefined */
function normalizeAccount(a: Partial<Account>): Account {
  const base = defaultAccount();
  return {
    ...base,
    ...a,
    id: a.id ?? base.id,
    label: a.label ?? base.label,
    configDir: a.configDir ?? base.configDir,
    proxy: a.proxy ?? { protocol: "none", host: "", port: 0 },
    identity: a.identity ?? { userID: null, machineID: null, rotateOnNextLaunch: false },
    auth: a.auth ?? "unknown",
    maxPermission: a.maxPermission ?? "acceptEdits",
    createdAt: a.createdAt ?? Date.now(),
    lastUsedAt: a.lastUsedAt ?? Date.now(),
  };
}

/**
 * 弹层本体 —— 先渲染到不可见位置量出真实尺寸，再决定往哪开。
 *
 * 为什么不能提前算：菜单项数量是变的（账号几个、有没有分隔线），
 * 高度只有渲染完才知道。以前写死 `Math.min(y, vh - 260)` 就是拿
 * 一个猜的数字去夹，贴着窗口底的按钮必然错位。
 *
 * 三个规则（跟 CDS 的 popover 一致）：
 *   1. 下方空间够就往下开，不够就翻上去（侧栏底部账号按钮走这条）
 *   2. 横向优先左对齐锚点；右边放不下就改成右对齐锚点，都不行才夹到边界
 *   3. 离窗口边至少留 8px，不让菜单贴死在边上
 */
const GAP = 6;
const EDGE = 8;

function useAnchoredPosition(at: AnchorRect) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 先量：此时元素在 left/top=-9999，宽度仍按内容撑开
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 纵向：下方够就往下，否则翻到上方；上方也不够就选空间大的一侧并夹住
    const below = vh - at.bottom - GAP - EDGE;
    const above = at.top - GAP - EDGE;
    let top: number;
    if (below >= height) top = at.bottom + GAP;
    else if (above >= height) top = at.top - GAP - height;
    else top = below >= above ? Math.max(EDGE, vh - height - EDGE) : EDGE;

    // 横向：默认左对齐锚点；右侧溢出就右对齐；仍然溢出就夹到边界
    let left = at.left;
    if (left + width > vw - EDGE) {
      left = at.right - width;
      if (left < EDGE) left = Math.min(EDGE, vw - width - EDGE);
    }
    if (left < EDGE) left = EDGE;

    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [at.left, at.right, at.top, at.bottom]);

  return { ref, pos };
}

function MenuBody({
  menu,
  state,
  onPickAccount,
  onPickPermission,
  onEditAccount,
  onManageAccounts,
  onGuide,
  onOpenSettings,
}: {
  onGuide: () => void;
  onOpenSettings: (cat?: SettingsCat) => void;
  menu: NonNullable<Menu>;
  state: BuddyState;
  onPickAccount: (id: string) => void;
  onPickPermission: (p: PermissionMode) => void;
  onEditAccount: (id: string) => void;
  onManageAccounts: () => void;
}) {
  const { ref, pos } = useAnchoredPosition(menu.at);
  // 首次量之前先藏在屏幕外，避免在 (0,0) 闪一帧
  const style = pos
    ? { left: pos.left, top: pos.top }
    : { left: -9999, top: -9999, visibility: "hidden" as const };

  // 从触发按钮那一侧长出来，而不是永远从上面掉下来
  const dir = pos && pos.top < menu.at.top ? "up" : "down";

  if (menu.kind === "permission") {
    return (
      <div className="pop" ref={ref} style={style} data-dir={dir} role="menu">
        <div className="pop-hint">权限模式决定 Claude Code 会问你多少</div>
        {(
          [
            ["default", "逐次确认", "每一步都先问你", IconShield],
            ["acceptEdits", "自动接受编辑", "改文件不再逐次确认", IconAuto],
            ["plan", "计划模式", "只出方案，不动文件", IconPlan],
          ] as const
        ).map(([p, label, desc, Icon]) => (
          <button
            key={p}
            className={`pi${state.permission === p ? " on" : ""}`}
            onClick={() => onPickPermission(p)}
            role="menuitemradio"
            aria-checked={state.permission === p}
          >
            <Icon size={15} />
            <span className="pi-main">{label}</span>
            <small>{desc}</small>
            <span className="pi-mark">
              {state.permission === p ? <IconCheck size={11} /> : null}
            </span>
          </button>
        ))}
      </div>
    );
  }

  const cur = state.accounts.find((a) => a.id === state.activeAccountId) ?? state.accounts[0];
  return (
      <div className="pop pop-env" ref={ref} style={style} data-dir={dir} role="menu">
        <div className="pop-hint">切换环境 · 新会话会建在选中的环境里</div>
        {state.accounts.map((a) => {
          const on = a.id === state.activeAccountId;
          return (
            <button
              key={a.id}
              className={`pi${on ? " on" : ""}`}
              onClick={() => onPickAccount(a.id)}
              role="menuitemradio"
              aria-checked={on}
            >
              <span className="av xs" style={{ background: a.tint }}>
                {a.label.slice(0, 1)}
              </span>
              <span className="pi-main">{a.label}</span>
              <small>{AUTH_LABEL[a.auth] ?? AUTH_LABEL.unknown}</small>
              <span className="pi-mark">{on ? <IconCheck size={11} /> : null}</span>
            </button>
          );
        })}
        <div className="pop-sep" />
        {cur && (
          <button className="pi" onClick={() => onEditAccount(cur.id)} role="menuitem">
            <IconGear size={15} />
            <span className="pi-main">编辑「{cur.label}」…</span>
          </button>
        )}
        <button className="pi" onClick={onManageAccounts} role="menuitem">
          <IconAccounts size={15} />
          <span className="pi-main">管理环境…</span>
        </button>
        <button className="pi" onClick={() => onOpenSettings("clean")} role="menuitem">
          <IconTrash size={15} />
          <span className="pi-main">清理本机…</span>
        </button>
        <button className="pi" onClick={onGuide} role="menuitem">
          <IconAuto size={15} />
          <span className="pi-main">新手引导</span>
        </button>
        <button className="pi" onClick={() => onOpenSettings()} role="menuitem">
          <IconSettings size={15} />
          <span className="pi-main">设置…</span>
          <small>⌘,</small>
        </button>
      </div>
  );
}

/** git@github.com:a/b.git / https://x/a/b → b */
function repoName(url: string): string {
  const tail = url.trim().replace(/\/+$/, "").split(/[/:]/).pop() ?? "repo";
  return tail.replace(/\.git$/, "") || "repo";
}

function CloneDialog({ onClose, onClone }: { onClose: () => void; onClone: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const ok = /^(https?:\/\/|git@|ssh:\/\/)\S+$/.test(url.trim());
  return (
    <Modal onClose={onClose} className="dlg-sm" label="从 Git 克隆">
      {(close) => (
        <>
          <div className="dlg-h">
            <h2>从 Git 克隆</h2>
            <button className="ib" title="关闭 esc" onClick={close}>
              <IconClose />
            </button>
          </div>
          <p>粘贴仓库地址，下一步选放在哪个目录下。克隆完成后会在仓库里直接启动 Claude Code。</p>
          <input
            className="dlg-in mono selectable"
            autoFocus
            value={url}
            placeholder="https://github.com/owner/repo.git"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ok) onClone(url.trim());
            }}
          />
          <div className="dlg-acts">
            <button className="btn ghost" onClick={close}>
              取消
            </button>
            <button className="btn pri" disabled={!ok} onClick={() => onClone(url.trim())}>
              选择目录并克隆
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
