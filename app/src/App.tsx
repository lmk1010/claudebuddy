import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import SessionMain from "./components/SessionMain";
import Inspector, { InspectorEmpty } from "./components/Inspector";
import AccountsPage, { CreateEnvDialog, EnvModal, ImportDialog, type EnvSection } from "./components/Accounts";
import Sessions from "./components/Sessions";
import Home from "./components/Home";
import Settings, { type SettingsCat } from "./components/Settings";
import CommandPalette from "./components/CommandPalette";
import CleanPage from "./components/CleanPage";
import NetTestPage from "./components/NetTestPage";
import Guide from "./components/Guide";
import { setLang, systemLang, tr } from "./lib/i18n";
import { resetNetReports } from "./components/NetReport";
import { setPendingPrompt } from "./lib/pendingPrompt";
import { browserLabel, loadBrowsers } from "./components/LoginButton";
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
  DesktopProbe,
  SessionSummary,
} from "./lib/bridge";
import "./styles/app.css";
import "./styles/ui.css";
import "./styles/guide.css";

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
  // 语言在渲染前定下来：下面所有子组件里的 tr() 读的都是这一次的值
  setLang(state.lang ?? systemLang());

  /**
   * 切语言时，把应用自己起的名字一起换掉：默认环境叫「默认 / Default」，
   * 开在家目录的会话叫「主目录 / Home」。用户自己改过的名字不动。
   */
  const langNow = state.lang ?? systemLang();
  useEffect(() => {
    resetNetReports();
    setState((s) => {
      const accName = tr("默认", "Default");
      const winName = tr("主目录", "Home");
      let changed = false;
      const accounts = s.accounts.map((a) => {
        if (a.configDir === ".claude" && (a.label === "默认" || a.label === "Default") && a.label !== accName) {
          changed = true;
          return { ...a, label: accName };
        }
        return a;
      });
      const windows = s.windows.map((w) => {
        if ((w.title === "主目录" || w.title === "Home") && w.title !== winName) {
          changed = true;
          return { ...w, title: winName };
        }
        return w;
      });
      return changed ? { ...s, accounts, windows } : s;
    });
    // 账号数变化 = 存档刚读进来，也要对一遍
  }, [langNow, state.accounts.length]);
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
  const [settingsCat, setSettingsCat] = useState<SettingsCat>("general");
  /** 回调里要读最新 state 又不想把 state 塞进依赖时用 */
  const stateRef = useRef(state);
  stateRef.current = state;
  const exitIpRef = useRef(exitIp);
  exitIpRef.current = exitIp;
  /** 进设置之前在哪一页 —— 「返回应用」回到那里，而不是一律回首页 */
  const lastViewRef = useRef<View>("home");
  useEffect(() => {
    if (state.view !== "settings") lastViewRef.current = state.view;
  }, [state.view]);
  const [loginTerm, setLoginTerm] = useState<Record<string, string>>({});
  const [traces, setTraces] = useState<Record<string, TraceItem[] | undefined>>({});
  /** 每个环境碰过的仓库指纹：undefined = 还没量（要跑 git，按需取） */
  const [repos, setRepos] = useState<Record<string, string[] | undefined>>({});
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
                .map((w) => (w.cwd === i.home && w.title === prettyName(i.home) ? { ...w, title: tr("主目录", "Home") } : w))
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
      title: r.ok ? tr("装好了", "Installed") : tr("安装失败", "Install failed"),
      body: r.ok ? tr("可以继续了", "You can continue") : tr("看下面的日志，或者自己在终端里装", "Check the log below, or install it yourself in a terminal"),
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

  const [desktop, setDesktop] = useState<DesktopProbe | null>(null);
  /** 安全状态：常驻右栏顶部，四步全过才显示"环境就绪" */
  const [safetyOpen, setSafetyOpen] = useState(false);
  const safety = useMemo(
    () =>
      assessSafety(
        activeAccount,
        activeAccount ? status[activeAccount.id] : undefined,
        activeAccount ? exitIp[activeAccount.id] : null,
        desktop,
      ),
    [activeAccount, status, exitIp, desktop],
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
      report: compareEnvironments(
        drawerAccount,
        other,
        (id) => exitIp[id],
        (id) => repos[id],
      ),
    };
  }, [drawerAccount, state.accounts, exitIp, repos]);

  /**
   * Claude Desktop 的本地体检。
   *
   * 只读文件和进程，不发请求 —— 探测本身不能变成新的风控信号。
   * 主进程那边有 30 秒缓存，这边隔几分钟问一次就够了。
   */
  useEffect(() => {
    let alive = true;
    const load = () => {
      void window.claudeBuddy.desktopProbe().then(
        (r) => {
          if (alive) setDesktop(r);
        },
        () => {
          /* 探测失败就当没装，不干扰使用 */
        },
      );
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  /**
   * 打开环境详情时，把参与对比的两个环境的仓库指纹量出来。
   *
   * 这一步要真的跑 git（本地、不联网），所以不能塞进状态刷新，
   * 也不能每次保存都跑 —— 只在箱庭打开时取一次，取到就缓在 repos 里。
   */
  useEffect(() => {
    if (!drawerAccountId) return;
    const others = stateRef.current.accounts.filter((a) => a.id !== drawerAccountId);
    const other = others.find((a) => a.auth === "signedIn") ?? others[0];
    for (const id of [drawerAccountId, other?.id]) {
      if (!id || repos[id] !== undefined) continue;
      void window.claudeBuddy.accountRepos(id).then(
        (h) => setRepos((m) => ({ ...m, [id]: h })),
        () => setRepos((m) => ({ ...m, [id]: [] })),
      );
    }
  }, [drawerAccountId, repos]);

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
        title: tr("终端画像已换", "Terminal profile changed"),
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
          // 会话里 Claude 亲口说过「账号正在暂时风控」的，凭据再在也照样标出来，直到重新登录
          auth: s.auth === "signedIn" && stateRef.current.accounts.find((a) => a.id === id)?.heldAt ? "suspended" : s.auth,
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
    const off = window.claudeBuddy.onLoginExit(({ id, exitCode }) => {
      setLoginTerm((m) => {
        if (!(id in m)) return m;
        const n = { ...m };
        delete n[id];
        return n;
      });
      // 重新登录成功 = 换了凭据，之前记下的「暂时风控」作废，重新判断
      if (exitCode === 0) {
        stateRef.current = {
          ...stateRef.current,
          accounts: stateRef.current.accounts.map((a) => (a.id === id ? { ...a, heldAt: undefined } : a)),
        };
        setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, heldAt: undefined } : a)) }));
      }
      void refreshAccount(id);
    });
    // 会话里 Claude 说账号在暂时风控：记下来、立刻标红，并告诉用户
    const offFlag = window.claudeBuddy.onAccountFlag(({ accountId }) => {
      const acc = stateRef.current.accounts.find((a) => a.id === accountId);
      setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, heldAt: Date.now() } : a)) }));
      setStatus((prev) => (prev[accountId] ? { ...prev, [accountId]: { ...prev[accountId], auth: "suspended" } } : prev));
      setToast({
        title: tr(`「${acc?.label ?? ""}」的账号进入暂时风控`, `"${acc?.label ?? ""}" is temporarily restricted`),
        body: tr("这是风控状态，不等于封号。可以先换一个环境用、等它解除；要看具体原因去 claude.ai/restricted", "This is a risk-control state, not necessarily a ban. Switch to another environment and let it clear; check claude.ai/restricted for the reason"),
      });
    });
    return () => {
      off();
      offFlag();
    };
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
      setToast({ title: tr("登录成功", "Signed in"), body: status[accId]?.email ?? "" });
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
  const spawnWindow = useCallback((account: Account, cwd: string, runsClaude: boolean, firstPrompt?: string) => {
    /**
     * 强制代理的硬闸。
     *
     * 首页那个按钮只是其中一个人口，侧栏、右键、历史会话都能开会话，
     * 所以拦截只能放在这里——否则“必须走代理”就只是句口号。
     */
    const px = account.proxy;
    if (account.enforceProxy && !(px && px.protocol !== "none" && px.host)) {
      setEditor({ id: account.id, section: "network" });
      setToast({
        title: tr("这个环境还没配出口", "No exit configured yet"),
        body: tr(
          "它设了必须走代理才允许开会话，所以这次没有启动。先在网络出口里配一个可用的线路。",
          "It is set to require a proxy before a session can start, so nothing was launched. Configure a working route first.",
        ),
      });
      return;
    }
    // 家目录的目录名就是用户名，几个会话全叫同一个名字 分不清 —— 直接叫「主目录」
    const base = cwd === home ? tr("主目录", "Home") : prettyName(cwd);
    const win: ShellWindow = {
      id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: base,
      accountId: account.id,
      cwd,
      runsClaude,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      permission: stateRef.current.permission,
    };
    if (firstPrompt) setPendingPrompt(win.id, firstPrompt);
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
      // 第一句话作为 Claude Code 的启动参数传进去，不再等几秒后往终端里「打字」——
      // Claude 启动慢一点（比如在自动更新）那句话就丢了或者打进了 shell
      spawnWindow(acc, cwd, true, text);
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
      setToast({ title: tr(`正在克隆 ${name}`, `Cloning ${name}`), body: tr(`到 ${prettyName(parent)} 下，完成后自动启动 Claude Code`, `Into ${prettyName(parent)}. Claude Code starts when it finishes`) });
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
        title: tr(`关闭「${w.title}」？`, `Close “${w.title}”?`),
        body: tr("这个会话的终端进程会被结束，正在跑的命令会中断。对话记录还在环境目录里。", "This session's terminal process will end and any running command will be interrupted. The conversation history stays in the environment folder."),
        okLabel: tr("关闭会话", "Close session"),
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
        title: tr(`关闭其他 ${rest.length} 个会话？`, `Close ${rest.length} other sessions?`),
        body: tr("这些会话的终端进程都会被结束，正在跑的命令会中断。", "These sessions' terminal processes will end and any running commands will be interrupted."),
        okLabel: tr(`关闭 ${rest.length} 个`, `Close ${rest.length}`),
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
        title: tr(`关闭${what}？`, `Close ${what}?`),
        body: tr("这些会话的终端进程都会被结束，正在跑的命令会中断。对话记录还在环境目录里。", "These sessions' terminal processes will end and any running commands will be interrupted. Conversation history stays in the environment folder."),
        okLabel: tr(`关闭 ${ids.length} 个`, `Close ${ids.length}`),
        onOk: () => ids.forEach(closeWindow),
      });
    },
    [closeWindow],
  );

  const reveal = useCallback(async (p: string) => {
    const ok = await window.claudeBuddy.reveal(p);
    if (!ok) setToast({ title: tr("打不开这个目录", "Can't open this folder"), body: tr("目录不存在，或者不在家目录下", "The folder doesn't exist or isn't under your home folder") });
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
      setToast({ title: tr(`已创建 ${acc.label}`, `Created ${acc.label}`), body: tr(`~/${acc.configDir} · 设备码与画像已独立分配`, `~/${acc.configDir} · Device ID and profile assigned separately`) });
      return acc;
    },
    [state.accounts],
  );

  const importDir = useCallback(
    (configDir: string, label: string) => {
      if (state.accounts.some((a) => a.configDir === configDir)) {
        setToast({ title: tr("这个目录已经导入过了", "This folder has already been imported") });
        return;
      }
      const acc: Account = {
        ...defaultAccount(),
        id: `acc-${configDir.replace(/^\./, "").replace(/[^a-z0-9]/g, "-")}`,
        label: label || configDir,
        configDir,
        tint: nextTint(state.accounts.map((a) => a.tint)),
        note: tr("导入的已有环境", "Imported existing environment"),
      };
      setState((s) => ({ ...s, accounts: [...s.accounts, acc], activeAccountId: acc.id }));
      void refreshAccount(acc.id);
      setToast({ title: tr(`已导入 ${acc.label}`, `Imported ${acc.label}`), body: `~/${acc.configDir}` });
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

  /** 哪些环境已经用过这个出口 IP（包含刚测出来还没存的值） */
  const exitHoldersOf = useCallback(
    (ip: string, exceptId: string) =>
      stateRef.current.accounts
        .filter((a) => a.id !== exceptId && (a.lastExitIp === ip || exitIpRef.current[a.id] === ip))
        .map((a) => a.label),
    [],
  );

  /**
   * 记下出口 IP —— 但这个 IP 已经在别的环境名下时，先问一句再落。
   *
   * 风控不看这台机器上开了几个环境，看的是同一个出口后面出现了哪些身份。
   * 两个环境共用一个出口，等于把这两条线亲手连起来，所以发现就要说一声。
   * 返回 false 表示卡在确认框上、还没写入。
   */
  const recordExitIp = useCallback(
    (id: string, ip: string): boolean => {
      const holders = exitHoldersOf(ip, id);
      const commit = () => {
        setExitIp((m) => ({ ...m, [id]: ip }));
        setState((s) => ({
          ...s,
          accounts: s.accounts.map((a) =>
            a.id === id ? { ...a, lastExitIp: ip, lastExitCheckedAt: Date.now() } : a,
          ),
        }));
      };
      if (holders.length === 0) {
        commit();
        return true;
      }
      setConfirm({
        title: tr("这个出口已经有环境在用了", "This exit is already in use"),
        body: tr(
          `${ip} 已经被「${holders.join("、")}」用过。两个环境共用同一个出口，服务端看到的就是同一台机器后面的两个身份 —— 这也正是风控最容易把它们连起来的一条线。确定要这么做？`,
          `${ip} has already been used by ${holders.join(", ")}. Two environments behind one exit look like two identities on one machine, which is exactly the link that gets picked up. Are you sure?`,
        ),
        okLabel: tr("仍然用这个 IP", "Use it anyway"),
        onOk: commit,
      });
      return false;
    },
    [exitHoldersOf],
  );

  /**
   * 登录。browser 不给就用这个环境上次选的；给了就记住，下次直接用。
   * 提示等 CLI 真把链接交出来（login:url）再报「已在 xx 打开」，不提前说。
   */
  const login = useCallback(
    async (id: string, browser?: string) => {
      const acc = stateRef.current.accounts.find((a) => a.id === id);
      const choice = browser ?? acc?.loginBrowser ?? "system";
      if (browser && acc && acc.loginBrowser !== browser) {
        setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, loginBrowser: browser } : a)) }));
      }
      setBusy((b) => ({ ...b, [id]: true }));
      const r = await window.claudeBuddy.accountLogin(id, choice);
      setBusy((b) => ({ ...b, [id]: false }));
      if (r.ok && r.termId) {
        setLoginTerm((m) => ({ ...m, [id]: r.termId! }));
      } else {
        setToast({ title: tr("登录启动失败", "Couldn't start sign-in"), body: tr("请确认已安装 claude CLI", "Make sure the claude CLI is installed") });
      }
    },
    [],
  );

  useEffect(
    () =>
      window.claudeBuddy.onLoginUrl(({ browser }) => {
        void loadBrowsers().then((list) =>
          setToast(
            browser === "copy"
              ? { title: tr("登录链接已复制", "Sign-in link copied"), body: tr("粘到任意浏览器打开，授权后这里会自动识别", "Paste it into any browser. We'll detect it here once you authorize") }
              : { title: tr(`已在「${browserLabel(list, browser)}」打开授权页`, `Opened the authorization page in ${browserLabel(list, browser)}`), body: tr("在网页上点授权，回来会自动识别", "Click authorize on the page, then come back. We'll detect it automatically") },
          ),
        );
      }),
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
        title: r.ok ? tr("已退出登录", "Signed out") : tr("退出失败", "Sign-out failed"),
        body: r.ok ? tr("凭据已从 Keychain 清除", "Credentials removed from Keychain") : r.output.slice(0, 120),
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
        setToast({ title: tr("出口检测失败", "Exit check failed"), body: r.reason ?? tr("网络不通或代理不可达", "Network unreachable or proxy unavailable") });
        return;
      }
      const prev = state.accounts.find((a) => a.id === id)?.lastExitIp ?? null;
      // 撞到别的环境用过的出口就不落库，也不再叠一个 toast：确认框已经在问了
      if (!recordExitIp(id, r.ip)) return;
      setToast({
        title: tr(`出口 IP ${r.ip}`, `Exit IP ${r.ip}`),
        body: prev && prev !== r.ip ? tr(`注意：从 ${prev} 变了，频繁跳变本身是信号`, `Note: changed from ${prev}. Frequent changes are a signal in themselves`) : tr("已记录，跟这个账号绑定", "Saved and tied to this account"),
      });
    },
    [state.accounts, recordExitIp],
  );

  const rotate = useCallback(
    async (id: string) => {
      setBusy((b) => ({ ...b, [id]: true }));
      const r = await window.claudeBuddy.accountRotateIdentity(id);
      setBusy((b) => ({ ...b, [id]: false }));
      if (!r.ok) {
        setToast({ title: tr("轮换失败", "Rotation failed"), body: r.reason });
        return;
      }
      await refreshAccount(id);
      setToast({
        title: tr("设备身份已轮换", "Device identity rotated"),
        body: tr(`新 userID ${r.userID?.slice(0, 12)}… · 账号本身没变`, `New userID ${r.userID?.slice(0, 12)}… · The account itself is unchanged`),
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
    setToast({ title: tr("已复制", "Copied"), body: text });
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
        // 再按一次 ⌘, 就退出设置，跟 macOS 原生应用一样
        update({ view: state.view === "settings" ? lastViewRef.current : "settings" });
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
        // 设置里按 Esc 返回应用；有弹窗、或焦点在输入框里时不抢
        else if (
          state.view === "settings" &&
          !document.querySelector(".mask, .cmenu") &&
          !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        )
          update({ view: lastViewRef.current });
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
        settingsCat={settingsCat}
        onSettingsCat={setSettingsCat}
        onExitSettings={() => update({ view: lastViewRef.current })}
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
              if (cwd) setToast({ title: tr(`已选择 ${prettyName(cwd)}`, `Selected ${prettyName(cwd)}`) });
            }}
            onSetCwd={(cwd) => update({ lastCwd: cwd })}
            onEditNetwork={(id) => setEditor({ id, section: "network" })}
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
              onEditNetwork={(id) => setEditor({ id, section: "network" })}
              termState={state}
              onTermChange={update}
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
                title: tr(`退出「${a?.label ?? ""}」的登录？`, `Sign out of “${a?.label ?? ""}”?`),
                body: tr("会从 Keychain 清掉这个环境的凭据，之后要重新授权。", "This removes the environment's credentials from Keychain. You'll need to authorize again."),
                okLabel: tr("退出登录", "Sign out"),
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
            onPatch={(patch) => {
              // 出口 IP 单独走一道：其它字段直接写，IP 要先看是不是已有环境占着
              const { lastExitIp, ...rest } = patch;
              if (lastExitIp) recordExitIp(drawerAccount.id, lastExitIp);
              if (Object.keys(rest).length > 0) patchAccount(drawerAccount.id, rest);
            }}
            account={drawerAccount}
            status={status[drawerAccount.id]}
            exitIp={exitIp[drawerAccount.id] ?? null}
            loginTermId={loginTerm[drawerAccount.id] ?? null}
            traces={traces[drawerAccount.id]}
            keychain={keychain}
            busy={Boolean(busy[drawerAccount.id])}
            onClose={() => setEditor(null)}
            onLogin={(browser) => login(drawerAccount.id, browser)}
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
                setToast({ title: tr("没能删除", "Couldn't delete"), body: r.reason });
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
                title: tr(`已移除 ${acc.label}`, `Removed ${acc.label}`),
                body: r.purged ? tr("磁盘目录也一起删了", "The folder on disk was deleted too") : tr("目录保留在磁盘上", "The folder was kept on disk"),
              });
            }}
            onClearTraces={async (keys) => {
              setBusy((b) => ({ ...b, [drawerAccount.id]: true }));
              const r = await window.claudeBuddy.accountClearTraces(drawerAccount.id, keys);
              setBusy((b) => ({ ...b, [drawerAccount.id]: false }));
              if (!r.ok) {
                setToast({ title: tr("清理失败", "Cleanup failed"), body: r.reason ?? "" });
                return;
              }
              await loadTraces(drawerAccount.id);
              setToast({
                title: r.removed.length ? tr(`清掉了 ${r.removed.length} 项`, `Removed ${r.removed.length} items`) : tr("没有可清的项", "Nothing to clean up"),
                body: r.failed.length ? tr(`${r.failed.length} 项被跳过`, `${r.failed.length} skipped`) : tr("凭据和身份已保留", "Credentials and identity were kept"),
              });
            }}
          />
        )}

        {view === "settings" && settingsCat !== "clean" && settingsCat !== "guide" && (
          <Settings key={settingsCat} cat={settingsCat} state={state} update={update} />
        )}

        {view === "settings" && settingsCat === "guide" && (
          <>
            <div className="wh" />
            <Guide
              onGo={(to) => {
                if (to === "home" || to === "sessions" || to === "accounts") update({ view: to });
                else if (to === "net") update({ view: "network" });
                else if (to === "editNet" || to === "editLogin") {
                  update({ view: "accounts" });
                  if (activeAccount) setEditor({ id: activeAccount.id, section: to === "editNet" ? "network" : "general" });
                } else setSettingsCat(to);
              }}
            />
          </>
        )}

        {view === "network" && (
          <>
            <div className="wh" />
            <NetTestPage accounts={state.accounts} />
          </>
        )}

        {view === "settings" && settingsCat === "clean" && (
          <CleanPage
            inUse={state.accounts.filter((a) => state.windows.some((w) => w.accountId === a.id)).map((a) => a.configDir)}
            onRelogin={() => {
              // 去环境页，直接打开当前环境的「通用」—— 登录按钮就在最上面
              update({ view: "accounts" });
              const target = activeAccount ?? state.accounts[0];
              if (target) setEditor({ id: target.id, section: "general" });
            }}
            onPurged={(paths) => {
              // 目录被移走的环境从列表里摘掉；还有会话开着的先留着，免得把正在用的页签弄丢
              const gone = new Set(paths.map((p) => p.replace(/^.*\//, "")));
              setState((s) => {
                const busyIds = new Set(s.windows.map((w) => w.accountId));
                const accounts = s.accounts.filter(
                  (a) => a.configDir === ".claude" || !gone.has(a.configDir) || busyIds.has(a.id),
                );
                if (accounts.length === s.accounts.length) return s;
                return {
                  ...s,
                  accounts,
                  activeAccountId: accounts.some((a) => a.id === s.activeAccountId)
                    ? s.activeAccountId
                    : (accounts[0]?.id ?? null),
                };
              });
              void refreshAll();
            }}
          />
        )}

        {!ptyOk && (
          <div className="browser-note">
            {tr("浏览器预览模式 · 无 PTY，终端与登录不可用", "Browser preview · no PTY, terminal and sign-in unavailable")}
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
          onSettings={(cat) => {
            setSettingsCat(cat);
            update({ view: "settings" });
          }}
          onTogglePanel={() => setInspectorOpen((v) => !v)}
          onToggleSidebar={() => update({ sidebarOpen: !state.sidebarOpen })}
          onClone={() => setCloneOpen(true)}
          onSwitchAccount={(id) => {
            update({ activeAccountId: id });
            const a = state.accounts.find((x) => x.id === id);
            if (a) setToast({ title: tr(`已切到 ${a.label}`, `Switched to ${a.label}`), body: `~/${a.configDir}` });
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
            onOpenClean={() => {
              setMenu(null);
              setSettingsCat("clean");
              update({ view: "settings" });
            }}
            onOpenSettings={(cat) => {
              setMenu(null);
              if (cat) setSettingsCat(cat);
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

      {/* 展开侧栏按钮必须放在 DOM 最后：Electron 按 DOM 顺序合并拖拽区，
          放在前面会被后面顶栏的 -webkit-app-region: drag 盖掉，看得见却点不动 */}
      {!state.sidebarOpen && (
        <button className="ib ws-open" title={tr("展开侧栏 ⌘\\", "Show sidebar ⌘\\")} onClick={() => update({ sidebarOpen: true })}>
          <IconPanel />
        </button>
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
  onOpenClean,
}: {
  onOpenClean: () => void;
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
        <div className="pop-hint">{tr("启动 Claude Code 时用哪种权限模式", "Permission mode for new Claude Code sessions")}</div>
        {/* 跟 Claude Code 的启动参数一一对应：选什么，启动命令里就带什么（右边小字就是实际参数） */}
        {(
          [
            // 不带参数 = 用 Claude 自己 settings 里的默认模式（每个人不一样，比如有人设成 auto）
            ["default", tr("跟随 Claude 设置", "Use Claude's default"), "claude", IconSettings, false],
            ["manual", tr("逐次确认", "Ask each time"), "--permission-mode manual", IconShield, false],
            ["acceptEdits", tr("自动接受编辑", "Auto-accept edits"), "--permission-mode acceptEdits", IconAuto, false],
            ["plan", tr("计划模式", "Plan mode"), "--permission-mode plan", IconPlan, false],
            ["auto", tr("自动判定", "Auto"), "--permission-mode auto", IconAuto, false],
            ["bypassPermissions", tr("跳过所有确认", "Skip all permissions"), "--dangerously-skip-permissions", IconShield, true],
          ] as const
        ).map(([p, label, flag, Icon, danger]) => (
          <div key={p}>
            {danger && <div className="pop-sep" />}
            <button
              className={`pi pi-perm${state.permission === p ? " on" : ""}${danger ? " danger" : ""}`}
              onClick={() => onPickPermission(p)}
              role="menuitemradio"
              aria-checked={state.permission === p}
              title={
                danger
                  ? tr("Claude 执行任何命令、改任何文件都不再问你。只在你信得过的目录里用", "Claude runs any command and edits any file without asking. Only use in folders you trust")
                  : undefined
              }
            >
              <Icon size={15} />
              <span className="pi-main">{label}</span>
              <small className="mono">{flag}</small>
              <span className="pi-mark">{state.permission === p ? <IconCheck size={11} /> : null}</span>
            </button>
          </div>
        ))}
      </div>
    );
  }

  const cur = state.accounts.find((a) => a.id === state.activeAccountId) ?? state.accounts[0];
  return (
      <div className="pop pop-env" ref={ref} style={style} data-dir={dir} role="menu">
        <div className="pop-hint">{tr("切换环境 · 新会话会建在选中的环境里", "Switch environment · New sessions start in the selected one")}</div>
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
            <span className="pi-main">{tr(`编辑「${cur.label}」…`, `Edit “${cur.label}”…`)}</span>
          </button>
        )}
        <button className="pi" onClick={onManageAccounts} role="menuitem">
          <IconAccounts size={15} />
          <span className="pi-main">{tr("管理环境…", "Manage environments…")}</span>
        </button>
        <button className="pi" onClick={onOpenClean} role="menuitem">
          <IconTrash size={15} />
          <span className="pi-main">{tr("清理本机…", "Clean up this Mac…")}</span>
        </button>
        <button className="pi" onClick={onGuide} role="menuitem">
          <IconAuto size={15} />
          <span className="pi-main">{tr("新手引导", "Onboarding")}</span>
        </button>
        <button className="pi" onClick={() => onOpenSettings("guide")} role="menuitem">
          <IconPlan size={15} />
          <span className="pi-main">{tr("使用教程", "Guide")}</span>
        </button>
        <button className="pi" onClick={() => onOpenSettings()} role="menuitem">
          <IconSettings size={15} />
          <span className="pi-main">{tr("设置…", "Settings…")}</span>
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
    <Modal onClose={onClose} className="dlg-sm" label={tr("从 Git 克隆", "Clone from Git")}>
      {(close) => (
        <>
          <div className="dlg-h">
            <h2>{tr("从 Git 克隆", "Clone from Git")}</h2>
            <button className="ib" title={tr("关闭 esc", "Close esc")} onClick={close}>
              <IconClose />
            </button>
          </div>
          <p>{tr("粘贴仓库地址，下一步选放在哪个目录下。克隆完成后会在仓库里直接启动 Claude Code。", "Paste the repository URL, then choose which folder to clone into. Claude Code starts in the repo when cloning finishes.")}</p>
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
              {tr("取消", "Cancel")}
            </button>
            <button className="btn pri" disabled={!ok} onClick={() => onClone(url.trim())}>
              {tr("选择目录并克隆", "Choose folder and clone")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
