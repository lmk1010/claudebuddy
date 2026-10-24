/**
 * ClaudeBuddy 的数据模型 —— 整个应用对"隔离"的定义都在这里。
 *
 * 隔离不是一句口号，拆成四层，每层对应一组真实可改的开关：
 *
 *   1. **配置隔离** — 一份独立的 CLAUDE_CONFIG_DIR。
 *      token、projects、file-history、telemetry、stats 全在目录里。
 *      这是最硬的一层，只要目录不同就不可能串号。
 *
 *   2. **网络隔离** — 一组出口代理环境变量。
 *      Claude Code 明确读 HTTPS_PROXY / HTTP_PROXY，遥测里还会上报
 *      https_proxy 字段；出口 IP 是风控里最实在的关联线之一，
 *      所以"一个账号固定一个出口"比什么都重要。
 *
 *   3. **身份隔离** — ~/.claude.json 里的 userID / machineID。
 *      这两个就是遥测上报的 device_id（实证 331/331 相等），
 *      可以再生，但换什么值都比不上"换一个账号"来得彻底。
 *
 *   4. **环境画像** — uname / 终端 / shell / 包管理器组合。
 *      报告里说得很清楚：这是换不掉的一条线。客户端能做的只是
 *      "别让它跟另一个账号的画像完全重合"，所以我们记录它、展示它，
 *      不假装能改掉它。
 *
 * 还有一条**谁都改不了**的：账号 UUID。它是风控真正的支点，
 * account_on_hold 在 API 请求 / OAuth 回调 / Token 刷新三个环节都判定。
 * 界面上必须诚实地告诉用户这一点，而不是给一个"已完全隔离"的假象。
 */

import { tr } from "./i18n";

/** 主题 */
export type ThemeMode = "light" | "dark" | "system";

/** 顶层视图 */
export type View = "home" | "sessions" | "session" | "accounts" | "network" | "settings" | "clean";

/** 权限模式 —— 对应 claude --permission-mode */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "manual"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";

export const PERMISSION_LABEL: Record<PermissionMode, string> = {
  get default() { return tr("跟随 Claude 设置", "Claude's default"); },
  get acceptEdits() { return tr("自动接受编辑", "Auto-accept edits"); },
  get plan() { return tr("计划模式", "Plan mode"); },
  get manual() { return tr("逐次确认", "Ask each time"); },
  get auto() { return tr("自动判定", "Auto"); },
  get dontAsk() { return tr("不问不做", "Don't ask"); },
  get bypassPermissions() { return tr("跳过所有确认", "Skip all permissions"); },
};

/** 只给引导页挑三个常用的，其余在设置里 */
export const PERMISSION_COMMON: PermissionMode[] = ["default", "acceptEdits", "plan"];

// ─────────────────────────────────────────── 账号

/** 账号的登录状态 —— 由 claude auth status 读回，不是猜的 */
export type AuthState =
  | "signedOut" // 目录存在但没有凭据
  | "signedIn" // 有凭据且能读到账号
  | "expired" // 有凭据但已失效
  | "suspended" // 暂时风控（account_on_hold）
  | "unknown"; // 读不到（CLI 未安装 / 超时）

/** 出口代理配置 */
export interface ProxyConfig {
  /** http | socks5 | none */
  protocol: "http" | "socks5" | "none";
  host: string;
  port: number;
  /** 可选账号密码，多数本地代理不需要 */
  username?: string;
  password?: string;
  /** 不走代理的地址，默认 localhost */
  noProxy?: string;
}

/** 身份（~/.claude.json 里的两个 64 位 hex） */
export interface Identity {
  userID: string | null;
  machineID: string | null;
  /** 下一次会话是否要轮换成新的 */
  rotateOnNextLaunch: boolean;
  /** 上次轮换时间 */
  rotatedAt?: number;
}

/** 环境画像：只读快照，用来发现两个账号是否长得太像 */
export interface EnvironmentProfile {
  platform: string;
  arch: string;
  osRelease: string;
  shell: string;
  terminal: string;
  /** 该账号下出现过的 git remote 哈希前缀（跨设备关联线之一） */
  repoHashes: string[];
  capturedAt: number;
}

/** 终端画像：这些会进 Claude Code 的 env 上报，能拉开环境差异 */
export interface TerminalProfile {
  /** TERM —— 终端类型，影响 env.terminal 上报 */
  term: string;
  /** LANG —— 语言/编码 */
  lang: string;
  /** TZ —— 时区 */
  tz: string;
}

export const TERM_OPTIONS = [
  "xterm-256color",
  "screen-256color",
  "tmux-256color",
  "xterm",
  "vt100",
] as const;

export const LANG_OPTIONS = [
  "en_US.UTF-8",
  "zh_CN.UTF-8",
  "ja_JP.UTF-8",
  "ko_KR.UTF-8",
  "en_GB.UTF-8",
] as const;

export const TZ_OPTIONS = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
] as const;

export const DEFAULT_TERMINAL: TerminalProfile = {
  term: "xterm-256color",
  lang: "en_US.UTF-8",
  tz: "Asia/Shanghai",
};

/** 一个账号 = 一间屋子 */
export interface Account {
  id: string;
  /** 显示名，例如 主力 / 工作 / 备用 */
  label: string;
  /** 相对 ~/ 的配置目录，必须以 .claude 开头 */
  configDir: string;
  /** 头像底色 */
  tint: string;

  /** 登录态（由主进程读回） */
  auth: AuthState;
  email?: string;
  accountUuid?: string;
  organizationUuid?: string;
  tier?: string;

  /** 网络出口 */
  proxy: ProxyConfig;
  /** 要求必须先有可用出口才允许开会话 —— 没配就拦，不只是一个黄字提醒 */
  enforceProxy?: boolean;
  /** 上次测到的出口 IP，用于发现 IP 跳变 */
  lastExitIp?: string;
  /** 会话里 Claude 说过「账号正在暂时风控」的时间；重新登录成功后清掉 */
  heldAt?: number;
  /** 这个环境登录时用哪个浏览器（browsersList 的 id），记住上次的选择 */
  loginBrowser?: string;
  lastExitCheckedAt?: number;

  /** 身份 */
  identity: Identity;
  /** 环境画像 */
  profile?: EnvironmentProfile;
  /** 终端画像 —— 每个环境可以不同，用来拉开 env 上报的差异 */
  terminal: TerminalProfile;

  /** 风险偏好：这个账号允许的权限上限 */
  maxPermission: PermissionMode;
  createdAt: number;
  lastUsedAt: number;
  /** 用户备注 */
  note?: string;
}

// ─────────────────────────────────────────── 会话

export interface ShellWindow {
  id: string;
  title: string;
  accountId: string;
  cwd: string;
  runsClaude: boolean;
  startedAt: number;
  lastActivityAt: number;
  branch?: string | null;
  /** 本窗口实际生效的出口（账号级或缺省直连） */
  exitIp?: string;
  /** 启动 Claude Code 时用的权限模式（建窗口时从首页的选择记下来，恢复会话时照旧） */
  permission?: PermissionMode;
}

// ─────────────────────────────────────────── 全局状态

export interface BuddyState {
  accounts: Account[];
  windows: ShellWindow[];
  activeWindowId: string | null;
  activeAccountId: string | null;
  view: View;
  theme: ThemeMode;
  uiScale: number;
  onboarded: boolean;
  lastCwd: string | null;
  permission: PermissionMode;

  /** 节奏看护 */
  rhythmGuard: boolean;
  rhythmThreshold: number;

  /** 终端外观 */
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  copyOnSelect: boolean;
  terminalFontSize: number;
  terminalFontFamily: string;
  /** 界面语言；没有就跟系统 */
  lang?: "zh" | "en";
  /** 终端配色：auto = 跟随应用明暗，其余见 termThemes */
  terminalTheme?: string;
  terminalLineHeight?: number;
  /** 终端四周留白：compact / normal / wide */
  terminalPadding?: "compact" | "normal" | "wide";
  /** 启动时把上次没关的会话重新拉起来 */
  restoreSessions: boolean;
  /** 侧栏是否展开 */
  sidebarOpen: boolean;

  bannerDismissed: boolean;
  /** 引导完成到第几步（1 环境 / 2 登录 / 3 网络 / 4 完成） */
  onboardingStep: number;
}

// ─────────────────────────────────────────── 运行期数据

/**
 * 账号的实时快照 —— 来自主进程 accountStatus()，不是本地缓存。
 * 界面上的"已登录 / 暂时风控"必须用这个，否则就是在骗人。
 */
export interface AccountStatusSnapshot {
  exists: boolean;
  auth: AuthState;
  configDir: string;
  email: string | null;
  accountUuid: string | null;
  orgUuid: string | null;
  tier: string | null;
  identity: { userID: string | null; machineID: string | null };
  profile?: EnvironmentProfile;
}

export interface RhythmStats {
  lastHour: number;
  perMinute: number;
  medianGap: number;
  sessionTotal: number;
  sessionSeconds: number;
  buckets: number[];
}

export type RiskLevel = "calm" | "watch" | "hot" | "critical";

export const RISK_LABEL: Record<RiskLevel, string> = {
  get calm() { return tr("空闲", "Idle"); },
  get watch() { return tr("正常", "Normal"); },
  get hot() { return tr("偏快", "Fast"); },
  get critical() { return tr("过快", "Too fast"); },
};

export const RISK_PILL: Record<RiskLevel, string> = {
  calm: "p-idle",
  watch: "p-ok",
  hot: "p-warn",
  critical: "p-bad",
};

/** 阈值来自对真实封号案例的逆向：112 次/小时、间隔中位数 6.7s、最短 0.5s */
export const RHYTHM_THRESHOLDS = {
  perMinuteWatch: 6,
  perMinuteHot: 12,
  gapHot: 10,
} as const;

/** hot = 用户在设置里调的阈值；watch 取它的一半 */
export function riskOf(stats: RhythmStats, hot: number = RHYTHM_THRESHOLDS.perMinuteHot): RiskLevel {
  if (stats.perMinute >= hot) return "critical";
  if (stats.perMinute >= Math.ceil(hot / 2)) return "hot";
  if (stats.perMinute > 0) return "watch";
  return "calm";
}

export interface RecentProject {
  cwd: string;
  name: string;
  accountId: string;
  configDir: string;
  lastActive: number;
  sessions: number;
}

export interface GitChange {
  path: string;
  add: number;
  del: number;
}

export interface GitInfo {
  branch: string | null;
  changes: GitChange[];
  totalAdd: number;
  totalDel: number;
  /** git remote 的 SHA-256 前 16 位 —— 跨设备关联线，界面要能看见 */
  remoteHash?: string | null;
}

// ─────────────────────────────────────────── 默认值与工厂

/**
 * 环境标识色。
 *
 * 原来四档全是墨灰，侧栏、页签上几个环境的标记长一个样，等于没标。
 * 换成六个低饱和、彼此拉得开的色相，深浅两种主题下都能一眼分清。
 */
export const ACCOUNT_TINTS = ["#3d3b36", "#c4704f", "#4f7fb0", "#4e9a86", "#b5873a", "#8466ae"] as const;

/** 旧版的墨灰色板 —— 读到这些就按顺序换成新色板里的颜色 */
export const LEGACY_TINTS = ["#141413", "#3d3b36", "#6b6862", "#9a968c"];

/** 挑一个还没被用掉的标识色 */
export function nextTint(used: string[]): string {
  const taken = new Set(used.map((t) => t.toLowerCase()));
  return ACCOUNT_TINTS.find((t) => !taken.has(t)) ?? ACCOUNT_TINTS[used.length % ACCOUNT_TINTS.length];
}

export const DIRECT_PROXY: ProxyConfig = { protocol: "none", host: "", port: 0 };

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 目录名从 label 生成，只保留小写字母数字，避免任何路径歧义 */
export function configDirFor(label: string, taken: string[]): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  let dir = `.claude-${base || "acc"}`;
  let n = 2;
  while (taken.includes(dir)) {
    dir = `.claude-${base || "acc"}-${n++}`;
  }
  return dir;
}

export function createAccount(label: string, taken: string[], tint: string): Account {
  const now = Date.now();
  return {
    id: newId("acc"),
    label,
    configDir: configDirFor(label, taken),
    tint,
    auth: "signedOut",
    proxy: { ...DIRECT_PROXY },
    identity: { userID: null, machineID: null, rotateOnNextLaunch: false },
    terminal: { ...DEFAULT_TERMINAL },
    maxPermission: "acceptEdits",
    createdAt: now,
    lastUsedAt: now,
  };
}

/** 默认账号：接管用户已有的 ~/.claude，不新建目录 */
export function defaultAccount(): Account {
  const now = Date.now();
  return {
    id: "default",
    label: "默认",
    configDir: ".claude",
    tint: "#3d3b36",
    auth: "unknown",
    proxy: { ...DIRECT_PROXY },
    identity: { userID: null, machineID: null, rotateOnNextLaunch: false },
    terminal: { ...DEFAULT_TERMINAL },
    maxPermission: "acceptEdits",
    createdAt: now,
    lastUsedAt: now,
    note: "接管已有的 ~/.claude",
  };
}

export const AUTH_LABEL: Record<AuthState, string> = {
  get signedOut() { return tr("未登录", "Signed out"); },
  get signedIn() { return tr("已登录", "Signed in"); },
  get expired() { return tr("凭据失效", "Credentials expired"); },
  get suspended() { return tr("暂时风控", "Temporarily restricted"); },
  get unknown() { return tr("未知", "Unknown"); },
};

export const AUTH_PILL: Record<AuthState, string> = {
  signedOut: "p-idle",
  signedIn: "p-ok",
  expired: "p-warn",
  suspended: "p-bad",
  unknown: "p-idle",
};

// ─────────────────────────────────────────── 代理

/** 把配置拼成 URL —— Claude Code 与 curl 都认这种形式 */
export function proxyUrl(p: ProxyConfig): string | null {
  if (p.protocol === "none" || !p.host || !p.port) return null;
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@`
    : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

/** 订阅档位的人话：default_claude_max_5x → Max 5x */
export function tierLabel(tier: string | null | undefined): string {
  if (!tier) return "";
  const t = tier.toLowerCase();
  const m = t.match(/max_(\d+x)/);
  if (m) return `Max ${m[1]}`;
  if (t.includes("max")) return "Max";
  if (t.includes("pro")) return "Pro";
  if (t.includes("team")) return "Team";
  if (t.includes("enterprise")) return "Enterprise";
  if (t.includes("free")) return "Free";
  return tier.replace(/^default_claude_/, "");
}

/** 界面上显示的短形式：socks5://127.0.0.1:1080 */
export function proxyLabel(p: ProxyConfig): string {
  const url = proxyUrl(p);
  return url ?? tr("直连", "Direct");
}

// ─────────────────────────────────────────── 格式化

export function prettyName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || "~";
}

export function shortenHome(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return tr("刚刚", "Just now");
  if (min < 60) return tr(`${min} 分钟前`, `${min}m ago`);
  const hr = Math.floor(min / 60);
  if (hr < 24) return tr(`${hr} 小时前`, `${hr}h ago`);
  const day = Math.floor(hr / 24);
  if (day === 1) return tr("昨天", "Yesterday");
  if (day < 7) return tr(`${day} 天前`, `${day}d ago`);
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shortTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return tr("刚刚", "now");
  if (min < 60) return tr(`${min} 分`, `${min}m`);
  const hr = Math.floor(min / 60);
  if (hr < 24) return tr(`${hr} 时`, `${hr}h`);
  const day = Math.floor(hr / 24);
  if (day === 1) return tr("昨天", "yesterday");
  if (day < 7) return tr(`${day} 天`, `${day}d`);
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

export function fmtDuration(sec: number): string {
  if (sec < 60) {
    const s = Math.max(0, Math.round(sec));
    return tr(`${s} 秒`, `${s}s`);
  }
  const m = Math.floor(sec / 60);
  if (m < 60) return tr(`${m} 分`, `${m}m`);
  const mm = String(m % 60).padStart(2, "0");
  return tr(`${Math.floor(m / 60)} 时 ${mm} 分`, `${Math.floor(m / 60)}h ${mm}m`);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return tr("夜深了", "Working late");
  if (h < 11) return tr("早上好", "Good morning");
  if (h < 13) return tr("中午好", "Good afternoon");
  if (h < 18) return tr("下午好", "Good afternoon");
  return tr("晚上好", "Good evening");
}

/* ─────────────────────────── 环境相似度 ─────────────────────────── */

/**
 * 一条关联线：名字、两边各自的值、能不能拉开。
 *
 * 分两类非常重要：
 *   · fixed  = 内核/架构/主机名，同一台机器上永远相同，改不掉
 *   · movable = 设备码/出口 IP/终端画像，这些是软件真正能拉开的
 *
 * 如果把 fixed 也算进"相似度"，任何两个环境的相似度都接近 100%，
 * 用户会被一个没有信息量的数字吓到或误导。
 */
export interface SimilarityAxis {
  key: string;
  label: string;
  a: string;
  b: string;
  /** true = 这一项换不掉 */
  fixed: boolean;
  /** 两边是否不同 */
  differs: boolean;
  /** 两边至少有一边量不出来 —— 界面上说「未知」，不说「相同」 */
  unknown?: boolean;
}

export interface SimilarityReport {
  axes: SimilarityAxis[];
  /** 能拉开的项里，真正拉开了几项 */
  movableTotal: number;
  movableDiffered: number;
  /** 有效隔离度 0-100：能拉开的部分实际拉开了多少 */
  isolationScore: number;
}

export function compareEnvironments(
  a: Account,
  b: Account,
  ipOf: (id: string) => string | null | undefined,
  /** 每个环境碰过的仓库指纹；不传就退回账号上的 profile */
  repoOf?: (id: string) => string[] | undefined,
): SimilarityReport {
  const short = (v?: string | null) => (v && v.length > 10 ? `${v.slice(0, 10)}…` : v || "—");

  /**
   * 仓库指纹：同一个 git remote 在两个环境里算出同一个哈希，
   * 所以「共用仓库」是一条真存在、且用户看不见的连线。
   * 两边都有数据才能下结论，只有一边有就说未知 —— 不猜。
   */
  const reposA = repoOf?.(a.id) ?? a.profile?.repoHashes ?? [];
  const reposB = repoOf?.(b.id) ?? b.profile?.repoHashes ?? [];
  const sharedRepos = reposA.filter((h) => reposB.includes(h)).length;
  const repoKnown = reposA.length > 0 && reposB.length > 0;

  const axes: SimilarityAxis[] = [
    // ── 换不掉：同一台机器上必然相同 ──
    {
      key: "platform",
      label: tr("系统内核", "OS kernel"),
      a: tr("同机", "Same machine"),
      b: tr("同机", "Same machine"),
      fixed: true,
      differs: false,
    },
    {
      key: "arch",
      label: tr("CPU 架构", "CPU architecture"),
      a: tr("同机", "Same machine"),
      b: tr("同机", "Same machine"),
      fixed: true,
      differs: false,
    },
    {
      key: "account",
      label: tr("账号 UUID", "Account UUID"),
      a: short(a.accountUuid),
      b: short(b.accountUuid),
      fixed: true,
      differs: Boolean(a.accountUuid && b.accountUuid && a.accountUuid !== b.accountUuid),
    },
    // ── 能拉开 ──
    {
      key: "device",
      label: tr("设备码", "Device ID"),
      a: short(a.identity.userID),
      b: short(b.identity.userID),
      fixed: false,
      differs: Boolean(a.identity.userID && b.identity.userID && a.identity.userID !== b.identity.userID),
    },
    {
      key: "ip",
      label: tr("出口 IP", "Exit IP"),
      a: ipOf(a.id) ?? a.lastExitIp ?? "—",
      b: ipOf(b.id) ?? b.lastExitIp ?? "—",
      fixed: false,
      differs: Boolean(
        (ipOf(a.id) ?? a.lastExitIp) &&
          (ipOf(b.id) ?? b.lastExitIp) &&
          (ipOf(a.id) ?? a.lastExitIp) !== (ipOf(b.id) ?? b.lastExitIp),
      ),
    },
    {
      key: "term",
      label: tr("终端类型", "Terminal type"),
      a: a.terminal?.term ?? "—",
      b: b.terminal?.term ?? "—",
      fixed: false,
      differs: (a.terminal?.term ?? "") !== (b.terminal?.term ?? ""),
    },
    {
      key: "lang",
      label: tr("语言环境", "Locale"),
      a: a.terminal?.lang ?? "—",
      b: b.terminal?.lang ?? "—",
      fixed: false,
      differs: (a.terminal?.lang ?? "") !== (b.terminal?.lang ?? ""),
    },
    {
      key: "tz",
      label: tr("时区", "Time zone"),
      a: a.terminal?.tz ?? "—",
      b: b.terminal?.tz ?? "—",
      fixed: false,
      differs: (a.terminal?.tz ?? "") !== (b.terminal?.tz ?? ""),
    },
    {
      key: "repo",
      label: tr("仓库哈希", "Repo hash"),
      a: reposA.length ? tr(`${reposA.length} 个仓库`, `${reposA.length} repos`) : "—",
      b: reposB.length ? tr(`${reposB.length} 个仓库`, `${reposB.length} repos`) : "—",
      fixed: false,
      unknown: !repoKnown,
      differs: repoKnown ? sharedRepos === 0 : false,
    },
  ];

  const movable = axes.filter((x) => !x.fixed);
  const differed = movable.filter((x) => x.differs).length;
  return {
    axes,
    movableTotal: movable.length,
    movableDiffered: differed,
    isolationScore: movable.length ? Math.round((differed / movable.length) * 100) : 0,
  };
}

/** 一键把 B 的可移动项改成和 A 不同（避免用户手动配） */
export function suggestDistinctTerminal(a: Account, used: TerminalProfile[]): TerminalProfile {
  const pick = <T extends string>(opts: readonly T[], current: T, taken: T[]): T => {
    const free = opts.filter((o) => o !== current && !taken.includes(o));
    return free[0] ?? opts.find((o) => o !== current) ?? current;
  };
  const base = a.terminal ?? DEFAULT_TERMINAL;
  return {
    term: pick(TERM_OPTIONS, base.term, used.map((u) => u.term as (typeof TERM_OPTIONS)[number])),
    lang: pick(LANG_OPTIONS, base.lang, used.map((u) => u.lang as (typeof LANG_OPTIONS)[number])),
    tz: pick(TZ_OPTIONS, base.tz, used.map((u) => u.tz as (typeof TZ_OPTIONS)[number])),
  };
}
