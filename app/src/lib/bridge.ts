/** 主进程 ↔ 渲染层的类型契约。实现见 electron/preload.cjs。 */

import type { Account, AuthState, GitInfo, RecentProject } from "./model";

export interface AppInfo {
  platform: string;
  home: string;
  username: string;
  version: string;
  versions?: { electron: string; chrome: string; node: string };
  arch?: string;
  /** Darwin 内核版本，如 24.6.0 */
  osVersion?: string;
  userData?: string;
  ptyAvailable: boolean;
  darkMode: boolean;
  forcedTheme: "light" | "dark" | null;
}

export interface SpawnOpts {
  id: string;
  account: string;
  cwd: string;
  cols: number;
  rows: number;
  command?: string;
  /** 启动 claude 时的权限模式；主进程只认白名单 */
  permission?: string;
  /** 第一句话，作为 claude 的启动参数（主进程负责转义） */
  prompt?: string;
}

export interface AccountStatus {
  exists: boolean;
  auth: AuthState;
  configDir: string;
  email: string | null;
  accountUuid: string | null;
  orgUuid: string | null;
  tier: string | null;
  identity: { userID: string | null; machineID: string | null };
  profile?: {
    platform: string;
    arch: string;
    osRelease: string;
    shell: string;
    terminal: string;
    capturedAt: number;
  };
}

export interface LoginHandle {
  ok: boolean;
  termId?: string;
}

export interface ExitCheck {
  ok: boolean;
  ip: string | null;
  reason?: string;
  source?: string;
  at?: number;
}

export interface RotateResult {
  ok: boolean;
  reason?: string;
  userID?: string;
  machineID?: string;
}

/**
 * Claude Desktop 的本地体检结果。
 *
 * 桌面端不归任何环境管：Cookies、IndexedDB、Safe Storage 都是整机一份，
 * 所以它在服务端就是同一台机器上的另一个身份。这里只报告看到了什么。
 */
export interface DesktopProbe {
  installed: boolean;
  appPath?: string | null;
  running: boolean;
  hasSafeStorage: boolean;
  supportDir?: string;
  exists: boolean;
  sizeBytes?: number;
  lastActiveAt?: number;
  /** none / maybe / stale / likely / running-no-key / running */
  signedIn: "none" | "maybe" | "stale" | "likely" | "running-no-key" | "running";
  checkedAt?: number;
  error?: string;
}

/** 一个进程当前的一条 UDP 外连 */
export interface UdpFlow {
  command: string;
  pid: number;
  local: string;
  remote: string;
  /** 命中 STUN 端口：有人在问「我的公网 IP 是多少」 */
  stun: boolean;
  external: boolean;
}

/** 某个应用（本应用 / Claude Desktop）的 UDP 泄漏面 */
export interface LeakTarget {
  key: string;
  label: string;
  running: boolean;
  pids: number[];
  flows: UdpFlow[];
  stun: UdpFlow[];
}

/**
 * UDP / STUN 泄漏体检。
 *
 * STUN 走 UDP，代理管不到它 —— Chromium 系的客户端会用它问出真实公网 IP，
 * 那个 IP 是整机出口，不管每个环境配了什么代理都一样。
 */
export interface LeakReport {
  targets: LeakTarget[];
  stunDetected: boolean;
  udpDetected: boolean;
  checkedAt?: number;
  error?: string;
}

export interface TraceItem {
  key: string;
  label: string;
  path: string;
  critical: boolean;
  exists: boolean;
  size: number;
  count: number;
}

export interface ClearResult {
  ok: boolean;
  removed: string[];
  failed: { key: string; reason: string }[];
  reason?: string;
}

export interface KeychainEntry {
  service: string;
  account: string | null;
}

export interface ScannedDir {
  configDir: string;
  sessions: number;
  lastActive: number;
  sizeBytes: number;
  email: string | null;
  tier: string | null;
  hasIdentity: boolean;
}

/** 一个环境里的一次历史会话 */
export interface SessionSummary {
  id: string;
  /** 编码过的项目目录名 */
  project: string;
  /** 还原出来的工作目录 */
  cwd: string;
  /** 首条用户消息，当标题 */
  title: string;
  lastActive: number;
  sizeBytes: number;
}

/* ── 环境自检 ── */

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckItem {
  key: string;
  label: string;
  status: CheckStatus;
  /** 一句话结论，例如「已安装 2.1.309」「没装」 */
  title: string;
  detail: string;
  /** 怎么修 */
  fix: string | null;
  /** 需要界面给什么按钮 */
  action: "install" | null;
}

export interface CheckupResult {
  /** 没有 fail 项才为 true */
  ok: boolean;
  items: CheckItem[];
  claudePath: string | null;
  blocking: string[];
}

/* ── 连通性归因 ── */

/**
 * 一次归因的结论。
 *
 * 四层各自独立判定，`blocker` 只指向最该先处理的那一层 ——
 * 其余层即使有问题也先放着，否则会同时改好几样，测不出是哪样起的作用。
 */
export interface DiagnoseLayer {
  id: "network" | "challenge" | "account" | "quota";
  label: string;
  status: "ok" | "warn" | "fail" | "unknown";
  /** 实测到的原样数据 */
  detail: string;
  /** 这一层意味着什么、该做什么 */
  note: string;
}

export interface DiagnoseResult {
  ok: boolean;
  checkedAt: string;
  exitIp: { ip: string; asn: string; isp: string; city: string; hosting: boolean } | null;
  layers: DiagnoseLayer[];
  blocker: DiagnoseLayer["id"] | null;
  /** UA 对照实验：同一请求换 UA 结果是否不同 */
  uaVerdict: {
    tested: boolean;
    uaDecidesResult: boolean;
    browser: number | null;
    cli: number | null;
    summary: string;
  };
  headline: string;
  /** 没有测到的东西，避免把推断当结论 */
  unverified: string[];
}

/* ── 账号体检与清理 ── */

export interface CleanupAccount {
  id: string;
  kind: "default" | "claude-dir" | "codex-profile";
  name: string;
  path: string;
  keychainService: string;
  hasKeychain: boolean;
  hasCredentials: boolean;
  email: string | null;
  tier: string | null;
  sizeBytes: number;
  lastActive: number;
  sessions: number;
  /**
   * ok 正常 · signed-out 掉了登录但目录里有东西（重登可救回）
   * · empty 真正的空壳（没凭据、没对话记录）
   */
  state: "ok" | "signed-out" | "empty";
}

export interface CleanupSurvey {
  ok: boolean;
  checkedAt: string;
  accounts: CleanupAccount[];
  orphans: { service: string; reason: string }[];
  suggested: { accountIds: string[]; services: string[]; reason: string };
}

export interface CleanupResult {
  ok: boolean;
  moved: { id: string; dest: string }[];
  keychainDeleted: string[];
  unregistered: string[];
  failed: { id?: string; service?: string; reason: string }[];
  trashRoot: string;
}

/* ── 代理探测 ── */

/** ip-api.com 查到的出口 IP 归属 */
export interface IpInfo {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  isp: string;
  org: string;
  as: string;
  /** 移动网络 */
  mobile: boolean;
  /** 被标记为代理 / VPN / Tor 出口 */
  proxy: boolean;
  /** 机房 / 云服务器 IP */
  hosting: boolean;
  /** IP 所在时区，如 America/Los_Angeles */
  timezone?: string;
}

/** 登录用的浏览器选项 */
export interface BrowserOption {
  id: string;
  label: string;
  /** 用户资料登着的谷歌账号，或一句说明 */
  sub: string;
  group: "default" | "browser" | "private" | "copy";
  private?: boolean;
}

/** 网络测试：一个目标的分阶段计时（毫秒，均为多次的平均） */
export interface NetTarget {
  id: string;
  host: string;
  url: string;
  role: string;
  rounds: number;
  okCount: number;
  /** 失败率 % */
  loss: number;
  dns: number;
  tcp: number;
  tls: number;
  ttfb: number;
  total: number;
  min: number;
  max: number;
  jitter: number;
  code: number;
  remoteIp: string;
  tlsOk: boolean | null;
  http: string;
  error: string | null;
}

export interface NetTest {
  ok: boolean;
  at: number;
  tookMs: number;
  route: { label: string; proxy: string | null };
  rounds: number;
  targets: NetTarget[];
  dns: { host: string; sys: string[]; doh: string[] | null; dohVia: string | null; fake: boolean; bogus: boolean; mismatch: boolean }[];
  local: {
    systemProxy: { kind: string; addr: string }[] | null;
    processProxy: { key: string; value: string }[];
    tunLikely: boolean;
    fakeIp: boolean;
    ipv6: string | null;
  };
  exits: { direct: string | null; route: string | null };
  exitInfo: { direct: IpInfo | null; route: IpInfo | null; v6: IpInfo | null };
}

/** 出口体检：站在 Claude 的角度看一个环境的出口 */
export interface NetReport {
  ok: boolean;
  reason?: string;
  ip?: string;
  at?: number;
  info?: IpInfo | null;
  /** proxycheck.io：risk 0–100，越低越干净 */
  risk?: { risk: number; type: string; proxy: boolean; provider: string } | null;
  /** 我们估的信任分 0–100 */
  score?: number;
  flags?: string[];
  kind?: string;
  claude?: {
    loc: string;
    colo: string;
    supported: boolean | null;
    web: { ok: boolean; ms: number };
    api: { ok: boolean; ms: number };
    status: { ok: boolean; text: string } | null;
  };
  consistency?: { tz: string; ipTz: string; tzOk: boolean; lang: string; langOk: boolean };
}

export interface ProxyCandidate {
  host: string;
  port: number;
  protocol: "http" | "socks5";
  label: string;
  /** system = 系统代理，scan = 端口扫描，current = 已配置的 */
  from: "system" | "scan" | "current";
  ok: boolean;
  /** 实测出口 IP */
  ip: string | null;
  reason: string | null;
}

export interface ProxyDiscovery {
  list: ProxyCandidate[];
  directIp: string | null;
}

export interface ActivityRow {
  id: string;
  sessionSeconds: number;
  lastHour: number;
  idleSeconds: number;
  buckets: number[];
}

export interface SessionUsage {
  input: number;
  output: number;
  at: string | null;
  model: string | null;
}

export interface ClaudeBuddyBridge {
  info(): Promise<AppInfo>;
  loadState(): Promise<unknown>;
  saveState(state: unknown): Promise<boolean>;

  spawnTerm(opts: SpawnOpts): Promise<{ ok: boolean; error?: string; pid?: number }>;
  writeTerm(id: string, data: string): void;
  resizeTerm(id: string, cols: number, rows: number): void;
  killTerm(id: string): void;
  onTermData(cb: (p: { id: string; data: string }) => void): () => void;
  onTermExit(cb: (p: { id: string; exitCode: number }) => void): () => void;

  activity(): Promise<ActivityRow[]>;

  accountStatus(id: string): Promise<AccountStatus>;

  /* 环境自检 */
  checkupRun(): Promise<CheckupResult>;
  checkupInstall(): Promise<{ ok: boolean; code: number; error?: string }>;
  checkupRecheck(): Promise<CheckupResult>;
  onCheckupLog(cb: (text: string) => void): () => void;

  /** 连通性归因：403 是哪一层挡的 */
  diagnoseRun(): Promise<DiagnoseResult>;

  /** 账号体检：列出所有账号并标出可清理项 */
  cleanupSurvey(): Promise<CleanupSurvey>;
  /** 执行清理：移到回收站 + 删 Keychain 条目 */
  cleanupPurge(payload: {
    accountIds?: string[];
    services?: string[];
    allowMainKeychain?: boolean;
  }): Promise<CleanupResult>;

  /* 代理探测 */
  proxyDiscover(id?: string): Promise<ProxyDiscovery>;
  proxyTest(proxy: {
    host: string;
    port: number;
    protocol: "http" | "socks5";
  }): Promise<{ ok: boolean; ip: string | null; reason: string | null }>;
  /** browser：登录用哪个浏览器（browsersList 里的 id），不给就用系统默认 */
  accountLogin(id: string, browser?: string): Promise<LoginHandle>;
  /** 本机能用来登录的浏览器、用户资料、隐私窗口 */
  browsersList(): Promise<BrowserOption[]>;
  /** 界面语言同步给主进程 */
  setLang(lang: "zh" | "en"): Promise<boolean>;
  /** CLI 交出授权链接时触发（已经按选择打开 / 复制） */
  onLoginUrl(cb: (p: { id: string; url: string; browser: string }) => void): () => void;
  accountCloseLogin(id: string, termId?: string): Promise<boolean>;
  accountLogout(id: string): Promise<{ ok: boolean; output: string }>;
  accountCheckExit(id: string): Promise<ExitCheck>;
  accountRotateIdentity(id: string): Promise<RotateResult>;
  accountTraces(id: string): Promise<TraceItem[]>;
  /** 这个环境碰过的仓库指纹（git remote 的 sha256 前 16 位） */
  accountRepos(id: string): Promise<string[]>;
  /** Claude Desktop 的本地体检：不联网、不解密，只读文件与进程 */
  desktopProbe(force?: boolean): Promise<DesktopProbe>;
  /** UDP / STUN 泄漏体检：只跑 lsof / ps 看 socket，不发包 */
  leakProbe(force?: boolean): Promise<LeakReport>;
  accountClearTraces(
    id: string,
    keys: string[],
    includeCredentials?: boolean,
  ): Promise<ClearResult>;
  accountKeychain(): Promise<KeychainEntry[]>;
  accountScan(): Promise<ScannedDir[]>;
  /** 移除环境记录；purge 为 true 时连磁盘目录一起删（主进程会二次校验路径） */
  accountSessions(id: string): Promise<SessionSummary[]>;
  accountSessions(id: string): Promise<SessionSummary[]>;
  accountRemove(
    id: string,
    purge?: boolean,
  ): Promise<{ ok: boolean; purged?: boolean; configDir?: string; reason?: string }>;
  onLoginExit(cb: (p: { id: string; exitCode: number }) => void): () => void;
  /** 会话里看到 Claude 说「账号在暂时风控」时，主进程把这个环境标出来 */
  onAccountFlag(cb: (p: { accountId: string; auth: "suspended" }) => void): () => void;

  pickFolder(): Promise<string | null>;
  /** 在系统浏览器里打开链接（登录授权用） */
  openExternal(url: string): Promise<boolean>;
  /** 在访达里打开目录（只限家目录下） */
  reveal(path: string): Promise<boolean>;
  /** 出口 IP 的归属与类型；查不到返回 null */
  ipInfo(ip: string): Promise<IpInfo | null>;
  /** 出口体检（走这个环境的代理） */
  netReport(id: string): Promise<NetReport>;
  /** 网络测试；id 为 null = 本机直连 */
  netTest(id: string | null, rounds?: number): Promise<NetTest>;
  gitInfo(cwd: string): Promise<GitInfo>;
  recentProjects(id?: string): Promise<RecentProject[]>;
  sessionUsage(opts: { configDir: string; cwd: string }): Promise<SessionUsage | null>;

  onSystemTheme(cb: (dark: boolean) => void): () => void;
}

declare global {
  interface Window {
    claudeBuddy: ClaudeBuddyBridge;
  }
}

/** 供组件取账号快照用的辅助类型 */
export type AccountSnapshot = Account;
