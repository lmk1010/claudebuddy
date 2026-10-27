import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Account, AccountStatusSnapshot } from "../lib/model";
import type { KeychainEntry, ScannedDir, SessionSummary, TraceItem, DesktopProbe, LeakReport } from "../lib/bridge";
import { ACCOUNT_TINTS, AUTH_LABEL, healthOf, proxyLabel, proxyModeOf, relTime, tierLabel, LANG_OPTIONS, TERM_OPTIONS, TZ_OPTIONS, systemTz, type Exit, type ProxyMode, type SimilarityReport } from "../lib/model";
import LoginConsole from "./LoginConsole";
import HealthSection from "./EnvHealth";
import ExitList from "./ExitList";
import ExitPicker from "./ExitPicker";
import ProxyModeCard from "./ProxyModeCard";
import BrowserSection from "./EnvBrowser";
import Art from "./Art";
import Modal from "./Modal";
import Help, { Steps } from "./Help";
import NetReportCard from "./NetReport";
import ExitGuide from "./ExitGuide";
import LoginButton from "./LoginButton";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { tr } from "../lib/i18n";
import {
  IconCheck,
  IconClock,
  IconClose,
  IconCopy,
  IconChevronDown,
  IconDots,
  IconFile,
  IconGear,
  IconGlobe,
  IconKey,
  IconLock,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTerminal,
  IconTrash,
  IconWarning,
} from "./iconAliases";

/**
 * 环境页 —— 标题行、说明条、环境列表。
 *
 * 细节不铺在页面上：点一行打开编辑弹窗，弹窗里左边分类、右边内容，
 * 跟 Claude Desktop 的设置同构。
 */
interface Props {
  accounts: Account[];
  activeId: string | null;
  status: Record<string, AccountStatusSnapshot>;
  sessionCount: Record<string, number>;
  bannerDismissed: boolean;
  onDismissBanner: () => void;
  onCreate: () => void;
  onScanImport: () => void;
  onOpenDetail: (account: Account, section?: EnvSection) => void;
  onSetActive: (id: string) => void;
  onNewIn: (id: string) => void;
  onLogin: (id: string) => void;
  onLogout: (id: string) => void;
  onCheckExit: (id: string) => void;
  onCopy: (text: string) => void;
  onReveal: (path: string) => void;
}

export default function Accounts(p: Props) {
  const menu = useContextMenu();
  const envMenu = (a: Account): MenuItem[] => {
    const signedIn = (p.status[a.id]?.auth ?? a.auth) === "signedIn";
    return [
      { label: tr("编辑…", "Edit…"), icon: <IconGear size={14} />, hint: "↵", run: () => p.onOpenDetail(a) },
      {
        label: tr("设为当前环境", "Set as current environment"),
        icon: <IconCheck size={14} />,
        disabled: a.id === p.activeId,
        run: () => p.onSetActive(a.id),
      },
      { label: tr("在这个环境新建会话", "New session in this environment"), icon: <IconTerminal size={14} />, run: () => p.onNewIn(a.id) },
      "sep",
      signedIn
        ? { label: tr("退出登录", "Sign out"), icon: <IconKey size={14} />, run: () => p.onLogout(a.id) }
        : { label: tr("登录…", "Sign in…"), icon: <IconKey size={14} />, run: () => p.onLogin(a.id) },
      { label: tr("网络出口…", "Network exit…"), icon: <IconGlobe size={14} />, run: () => p.onOpenDetail(a, "network") },
      { label: tr("检测出口 IP", "Check exit IP"), icon: <IconRefresh size={14} />, run: () => p.onCheckExit(a.id) },
      "sep",
      { label: tr("复制配置目录路径", "Copy config directory path"), icon: <IconCopy size={14} />, run: () => p.onCopy(`~/${a.configDir}`) },
      { label: tr("在访达中打开目录", "Show in Finder"), icon: <IconFile size={14} />, run: () => p.onReveal(`~/${a.configDir}`) },
      "sep",
      { label: tr("删除环境…", "Delete environment…"), icon: <IconTrash size={14} />, danger: true, run: () => p.onOpenDetail(a, "clean") },
    ];
  };
  return (
    <div className="pg">
      <div className="pg-h">
        <div>
          <h1>{tr("环境", "Environments")}</h1>
          <p>
            {tr(
              `${p.accounts.length} 个环境 · 全部本机存储 · 每个独立目录、独立出口`,
              `${p.accounts.length} environments · Stored locally · Each with its own directory and exit`,
            )}
          </p>
        </div>
        <div className="pg-acts">
          <button
            className="btn"
            onClick={p.onScanImport}
            title={tr("导入本机已有的 ~/.claude* 目录", "Import existing ~/.claude* directories on this Mac")}
          >
            <IconRefresh />
            {tr("导入", "Import")}
          </button>
          <button className="btn pri" onClick={p.onCreate}>
            <IconPlus />
            {tr("新建环境", "New environment")}
          </button>
        </div>
      </div>

      {!p.bannerDismissed && (
        <div className="banner">
          <div>
            <b>{tr("每个环境一间屋子", "One room per environment")}</b>
            <p>
              {tr(
                "凭据、对话记录、file-history 全落在各自的配置目录里。切环境就是换一间屋子，不会串号，也不用反复登录。",
                "Credentials, conversation history and file-history all live in each environment's own config directory. Switching environments is like walking into another room: no mixed-up accounts, no repeated sign-ins.",
              )}
            </p>
          </div>
          <Art name="isolation" />
          <button className="banner-x" title={tr("不再显示", "Don't show again")} onClick={p.onDismissBanner}>
            <IconClose size={13} />
          </button>
        </div>
      )}

      <div className="acc">
        {p.accounts.map((a) => {
          const s = p.status[a.id];
          // 只信问过 CLI 的结果。status 里没有就说明还没测，不拿配置文件里
          // 那个猜出来的值当事实 —— 否则已登录的环境会显示“未登录”
          const auth = s?.auth ?? "unknown";
          const on = a.id === p.activeId;
          const n = p.sessionCount[a.id] ?? 0;
          return (
            <button
              key={a.id}
              className={`ar${on ? " on" : ""}`}
              onClick={() => p.onOpenDetail(a)}
              onContextMenu={(e) => menu.open(e, envMenu(a), a.label)}
              title={tr("点开编辑 · 右键更多", "Click to edit · Right-click for more")}
            >
              <span className="av" style={{ background: a.tint }}>
                {a.label.slice(0, 1)}
              </span>
              <span className="an">
                <b>
                  {a.label}
                  {on && <em className="ar-cur">{tr("当前", "Current")}</em>}
                </b>
                <small>
                  <span className="mono">~/{a.configDir}</span>
                  {auth === "signedIn" && (s?.email || a.email) ? ` · ${s?.email ?? a.email}` : ""}
                </small>
              </span>
              <span className="as" title={proxyLabel(a.proxy)}>
                {a.proxy.protocol === "none" ? tr("直连", "Direct") : a.proxy.protocol.toUpperCase()}
              </span>
              <span className="as">{n > 0 ? tr(`${n} 个会话`, `${n} sessions`) : relTime(a.lastUsedAt)}</span>
              {(() => {
                /**
                 * 健康分并进原来那个状态药丸里 —— 不新增节点。
                 *
                 * 这行的布局是写死的 6 列 grid，多插一个元素就会把
                 * “…” 挤到第二行、行高也被撑开。
                 */
                const h = healthOf(a, s, undefined, p.accounts);
                return (
                  <span
                    className={`pill ${h.level === "risk" || h.level === "blocked" ? "p-bad" : "p-ok"}`}
                    title={h.reasons.length ? h.reasons.join("；") : tr("一切就绪", "All good")}
                  >
                    {h.score} · {a.heldAt ? AUTH_LABEL.suspended : AUTH_LABEL[auth]}
                  </span>
                );
              })()}
              <span
                className="ar-more"
                role="button"
                title={tr("更多", "More")}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  menu.open({ clientX: r.right - 220, clientY: r.bottom + 4, preventDefault: () => {} }, envMenu(a), a.label);
                }}
              >
                {a.heldAt ? <IconWarning size={13} /> : <IconDots size={14} />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="pg-foot">
        {tr(
          "点一行编辑：登录、网络出口、设备身份、痕迹清理都在里面。右键或「⋯」有更多操作。",
          "Click a row to edit: sign-in, network exit, device identity and trace cleanup are all inside. Right-click or use “⋯” for more.",
        )}
      </div>
      {menu.node}
    </div>
  );
}

/* ══════════════════════ 新建环境 ══════════════════════ */

export function CreateEnvDialog({
  existing,
  onCreate,
  onClose,
}: {
  existing: string[];
  onCreate: (label: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const v = name.trim();
  const dup = existing.includes(v);
  const ok = Boolean(v) && !dup;
  return (
    <Modal onClose={onClose} className="dlg-sm" label={tr("新建环境", "New environment")}>
      {(close) => (
        <>
          <div className="dlg-h">
            <h2>{tr("新建环境", "New environment")}</h2>
            <button className="ib" title={tr("关闭 esc", "Close esc")} onClick={close}>
              <IconClose />
            </button>
          </div>
          <p>
            {tr(
              "环境 = 一个独立的 Claude Code 配置目录。一个 Claude 账号放一个环境，互相不串号、不用反复登录。",
              "An environment is a separate Claude Code config directory. Use one environment per Claude account so accounts never mix and you don't have to sign in repeatedly.",
            )}
          </p>
          <div className="dlg-guide">
            <Steps
              items={[
                <>
                  <b>{tr("起个名字", "Pick a name")}</b>
                  {tr("，比如账号的用途或邮箱前缀（主力、工作…）", ", such as the account's purpose or email prefix (Main, Work…)")}
                </>,
                <>
                  <b>{tr("登录授权", "Sign in")}</b>
                  {tr(
                    "：建好会自动打开编辑页，点「登录」在浏览器里授权",
                    ": the editor opens after creation. Click “Sign in” to authorize in your browser",
                  )}
                </>,
                <>
                  <b>{tr("网络出口（可选）", "Network exit (optional)")}</b>
                  {tr(
                    "：用梯子的话点「自动探测」选一个，多个号建议各走各的",
                    ": if you use a proxy, click “Auto-detect” and pick one. With multiple accounts, give each its own",
                  )}
                </>,
              ]}
            />
          </div>
          <input
            className="dlg-in"
            autoFocus
            value={name}
            placeholder={tr("名字，例如 主力 / 工作", "Name, e.g. Main / Work")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ok && !e.nativeEvent.isComposing) {
                onCreate(v);
                close();
              }
            }}
          />
          <div className="dlg-err">{dup ? tr("已经有同名环境了", "An environment with this name already exists") : " "}</div>
          <div className="dlg-acts">
            <button className="btn ghost" onClick={close}>
              {tr("取消", "Cancel")}
            </button>
            <button
              className="btn pri"
              disabled={!ok}
              onClick={() => {
                onCreate(v);
                close();
              }}
            >
              {tr("创建并编辑", "Create and edit")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ══════════════════════ 导入已有目录 ══════════════════════ */

export function ImportDialog({
  list,
  imported,
  onImport,
  onClose,
}: {
  list: ScannedDir[];
  imported: string[];
  onImport: (configDir: string, label: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} className="dlg-md" label={tr("导入已有环境", "Import existing environments")}>
      {(close) => (
        <>
          <div className="dlg-h">
            <h2>{tr("导入已有环境", "Import existing environments")}</h2>
            <button className="ib" title={tr("关闭 esc", "Close esc")} onClick={close}>
              <IconClose />
            </button>
          </div>
          <p>
            {tr(
              "本机扫到的 Claude Code 配置目录。导入只是登记，不会动目录里的任何东西。",
              "Claude Code config directories found on this Mac. Importing only registers them and doesn't change anything inside.",
            )}
          </p>
          {list.length === 0 ? (
            <div className="imp-empty">{tr("没有找到可导入的目录。", "No directories found to import.")}</div>
          ) : (
            <div className="imp-list">
              {list.map((d) => {
                const done = imported.includes(d.configDir);
                return (
                  <div className="imp-row" key={d.configDir}>
                    <span className="imp-main">
                      <b className="mono">~/{d.configDir}</b>
                      <small>
                        {d.email ?? tr("未登录", "Signed out")}
                        {d.tier ? ` · ${tierLabel(d.tier)}` : ""} · {tr(`${d.sessions} 个会话`, `${d.sessions} sessions`)} · {fmtSize(d.sizeBytes)}
                        {d.lastActive ? ` · ${relTime(d.lastActive)}` : ""}
                      </small>
                    </span>
                    <button
                      className={`btn${done ? " ghost" : ""}`}
                      disabled={done}
                      onClick={() => onImport(d.configDir, d.configDir.replace(/^\.claude-?/, "") || tr("个人", "Personal"))}
                    >
                      {done ? tr("已导入", "Imported") : tr("导入", "Import")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="dlg-acts">
            <button className="btn ghost" onClick={close}>
              {tr("完成", "Done")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ══════════════════════ 编辑环境（弹窗） ══════════════════════ */

export type EnvSection = "health" | "general" | "network" | "browser" | "fingerprint" | "sessions" | "clean";

/**
 * 六项，健康评分放第一位 —— 打开一个环境先告诉你“它现在怎样、哪几项不对”，
 * 再往下才是具体怎么调。
 * 之前七项（身份、画像、痕迹、删除各占一格）太碎，同一件事要在两三个菜单里找。
 */
/** 抽屉导航的三个层面。安全 → 环境 → 应用，从“出事代价最大”排到最小 */
type EnvGroup = "security" | "env" | "app";

const ENV_GROUPS: { id: EnvGroup; zh: string; en: string }[] = [
  { id: "security", zh: "安全", en: "Security" },
  { id: "env", zh: "环境", en: "Environment" },
  { id: "app", zh: "应用", en: "App" },
];

/**
 * 环境抽屉的导航。
 *
 * 分成三组而不是七项平铺：用户要先知道哪个是大的、哪个是小的。
 * 之前「健康评分」和「清理」在列表里看起来一样重，扫读时没有落点。
 */
const SECTIONS: { id: EnvSection; label: string; desc: string; icon: typeof IconGear; group: EnvGroup }[] = [
  {
    id: "health",
    group: "security",
    get label() {
      return tr("健康评分", "Health score");
    },
    get desc() {
      return tr("这个环境现在得多少分，哪几项不对", "This environment's score, and exactly what is off");
    },
    icon: IconWarning,
  },
  {
    id: "network",
    group: "security",
    get label() {
      return tr("网络出口", "Network exit");
    },
    get desc() {
      return tr(
        "这个环境走哪条线路出去，以及 Claude 看到的出口质量",
        "Which route this environment uses, and the exit quality Claude sees",
      );
    },
    icon: IconGlobe,
  },
  {
    id: "fingerprint",
    group: "security",
    get label() {
      return tr("设备指纹", "Device fingerprint");
    },
    get desc() {
      return tr(
        "设备 ID、终端类型、语言、时区 —— 都会随请求上报",
        "Device ID, terminal type, language and time zone, all reported with requests",
      );
    },
    icon: IconShield,
  },
  {
    id: "general",
    group: "env",
    get label() {
      return tr("通用", "General");
    },
    get desc() {
      return tr("名字、标识色和登录", "Name, color and sign-in");
    },
    icon: IconGear,
  },
  {
    id: "browser",
    group: "env",
    get label() {
      return tr("浏览器授权", "Browser for auth");
    },
    get desc() {
      return tr("这个环境用哪个浏览器授权，记住它", "Which browser this environment authorizes with");
    },
    icon: IconKey,
  },
  {
    id: "sessions",
    group: "env",
    get label() {
      return tr("历史会话", "Session history");
    },
    get desc() {
      return tr("这个环境跑过的会话，点一条在原目录里接着开", "Sessions run in this environment. Click one to resume it in its original directory");
    },
    icon: IconClock,
  },
  {
    id: "clean",
    group: "app",
    get label() {
      return tr("清理", "Clean up");
    },
    get desc() {
      return tr(
        "这个环境在磁盘和 Keychain 里留下的东西，以及删除环境",
        "What this environment left on disk and in Keychain, and deleting the environment",
      );
    },
    icon: IconTrash,
  },
];

/**
 * 编辑环境 —— 居中弹窗，左边菜单、右边内容。
 *
 * 之前是一整列平铺的长滚动，登录、网络、身份、痕迹全叠在一起，找一项得从头滚到尾。
 * 现在一项一个菜单，切换时内容按菜单方向滑入，左侧选中底色跟着滑过去。
 */
export function EnvModal({
  account,
  status,
  exitIp,
  loginTermId,
  traces,
  keychain,
  busy,
  peers,
  desktop,
  leak,
  initialSection = "health",
  canRemove,
  onClose,
  onPatch,
  onLogin,
  onLogout,
  onRotate,
  onCheckExit,
  onLoadTraces,
  onLoadKeychain,
  onOpenTerminal,
  onRefresh,
  onCancelLogin,
  onDiversify,
  similar,
  onClearTraces,
  onRemove,
  sessions,
  onLoadSessions,
  onOpenSession,
  exits,
  onUseExit,
  onCreateExit,
  onRenameExit,
  onDeleteExit,
  onMeasureExit,
  onRepairExit,
  onSwapNode,
  onOpenShell,
}: {
  account: Account;
  status: AccountStatusSnapshot | undefined;
  exitIp: string | null;
  loginTermId: string | null;
  traces: TraceItem[] | undefined;
  keychain: KeychainEntry[] | null;
  busy: boolean;
  initialSection?: EnvSection;
  /** 最后一个环境不能删 */
  canRemove: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<Account>) => void;
  /** browser 不给 = 用这个环境记住的浏览器 */
  onLogin: (browser?: string) => void;
  onLogout: () => void;
  onRotate: () => void;
  /** 出口重新测一次 —— 健康页上的“测一下”直接用，不用你再去网络页点 */
  onCheckExit: () => void;
  /** 全部环境：算“出口/设备码跟谁撞了”要用 */
  peers: Account[];
  desktop: DesktopProbe | null;
  leak: LeakReport | null;
  onLoadTraces: () => void;
  onLoadKeychain: () => void;
  onOpenTerminal: () => void;
  onRefresh: () => void;
  onCancelLogin: () => void;
  onDiversify: () => void;
  similar: { otherLabel: string; report: SimilarityReport } | null;
  onClearTraces: (keys: string[]) => void;
  onRemove: (purge: boolean) => void;
  sessions: SessionSummary[] | undefined;
  onLoadSessions: () => void;
  onOpenSession: (s: SessionSummary) => void;
  /** 这台机器配过的出口 */
  exits: Exit[];
  /** 把这个环境切到某个出口；undefined = 直连 */
  onUseExit: (exitId: string | undefined) => void;
  onCreateExit: (exit: Omit<Exit, "id"> & { id?: string }) => void;
  onRenameExit: (id: string, label: string) => void;
  onDeleteExit: (id: string) => void;
  /** 实测到出口的真实 IP 后写回 */
  onMeasureExit: (id: string, ip: string | null) => void;
    /** 托管实例重启后端口变了，回写出口和用它的环境 */
    onRepairExit: (id: string, port: number, host: string) => void;
    /** 托管出口换了节点 —— 把 subId/node 写回出口本身 */
    onSwapNode: (id: string, subId: string, node: string) => void;
    /** 开一个空白终端（不经 claude）自己测网络 */
    onOpenShell: () => void;
  }) {
  // 同上：没测过就是未知，不是未登录
  const auth = status?.auth ?? "unknown";
  const [sec, setSec] = useState<EnvSection>(initialSection);
  const [dir, setDir] = useState<"up" | "down">("down");
  const order: EnvSection[] = SECTIONS.map((s) => s.id);

  const go = (next: EnvSection) => {
    if (next === sec) return;
    setDir(order.indexOf(next) > order.indexOf(sec) ? "down" : "up");
    setSec(next);
  };

  // 左侧选中底色：量出当前项的位置，滑过去而不是跳过去
  const navRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ top: number; height: number } | null>(null);
  /**
   * 指示条的位置要按**相对导航容器**算，不能用 el.offsetTop。
   *
   * offsetTop 是相对「最近的定位祖先」的，而 .em-nav 自身没有 padding 时两者恰好相等；
   * 一旦容器有了 padding（或中间插了分组标题这类非定位元素），两个基准就错开，
   * 指示条会整块偏上几像素 —— 看着像“选中框没框住”。
   * 用两个 getBoundingClientRect 相减，基准就只有一个：视口。
   */
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const el = nav.querySelector<HTMLElement>(`[data-sec="${sec}"]`);
      if (!el) return;
      /**
       * 用 offsetTop，不用 getBoundingClientRect 相减。
       *
       * 指示条是 `position: absolute`，它的原点就是导航容器的 padding box；
       * offsetTop 也是相对同一个定位祖先算的 —— 两个口径一致，直接相等。
       *
       * 而 rect 相减量的是**视觉位置**，会把分组标题的 margin-top、外边距塌陷
       * 一起算进那个差值里。分组标题一旦有 margin，两者就差出 10px、20px，
       * 指示条整块冲到相邻项上 —— 这正是「选中的项和底框对不上」的成因。
       */
      setInd({ top: el.offsetTop, height: el.offsetHeight });
    };
    measure();
    /**
     * 布局一变就要重算：字体加载完、窗口缩放、分组标题出现都会让按钮挪位置，
     * 而指示条还停在旧坐标上。它不报错，只是看着别扭，所以更容易漏。
     */
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    for (const child of nav.children) ro.observe(child);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [sec]);

  // 进到需要数据的分类时自动去读，不让用户再点一次「加载」
  useEffect(() => {
    if (sec === "sessions" && sessions === undefined) onLoadSessions();
    if (sec === "clean" && traces === undefined) onLoadTraces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sec]);

  const meta = SECTIONS.find((s) => s.id === sec) ?? SECTIONS[0];

  return (
    <Modal onClose={onClose} className="em" label={tr(`编辑 ${account.label}`, `Edit ${account.label}`)}>
      {(close) => (
        <>
          <aside className="em-side">
            <div className="em-who">
              <span className="av" style={{ background: account.tint }}>
                {account.label.slice(0, 1)}
              </span>
              <span className="em-who-t">
                <b>{account.label}</b>
                <small className="mono">~/{account.configDir}</small>
              </span>
            </div>

            <div className="em-nav" ref={navRef}>
              {ind && <i className="em-ind" style={{ transform: `translateY(${ind.top}px)`, height: ind.height }} />}
              {SECTIONS.map((s, i) => {
                // 组标题：只在进入新的一组时画一次
                const newGroup = i === 0 || SECTIONS[i - 1].group !== s.group;
                const g = ENV_GROUPS.find((x) => x.id === s.group)!;
                return (
                  <Fragment key={s.id}>
                    {newGroup && <div className="em-nav-g">{tr(g.zh, g.en)}</div>}
                    <button
                      data-sec={s.id}
                      className={sec === s.id ? "on" : ""}
                      onClick={() => go(s.id)}
                    >
                      <s.icon size={15} />
                      <span>{s.label}</span>
                      {s.id === "general" && auth === "signedOut" && <em className="em-badge" title={tr("还没登录", "Not signed in yet")} />}
                    </button>
                  </Fragment>
                );
              })}
            </div>

            <div className="em-foot">
              {(() => {
                // 抽屉里只有当前这一个环境，做不了“跟谁撞了”的比较，只看自己
                const h = healthOf(account, status, undefined, [account]);
                return (
                  <span
                    className={`pill ${h.level === "risk" || h.level === "blocked" ? "p-bad" : "p-ok"}`}
                                        title={h.reasons.length ? h.reasons.join("；") : tr("一切就绪", "All good")}
                                      >
                                        {h.score} · {account.heldAt ? AUTH_LABEL.suspended : AUTH_LABEL[auth]}
                                      </span>
                                    );
                                  })()}
                                </div>
                              </aside>

          <section className="em-main">
            <div className="em-head">
              <div>
                <h2>{meta.label}</h2>
                <p>{meta.desc}</p>
              </div>
              <button className="ib" title={tr("关闭 esc", "Close esc")} onClick={close}>
                <IconClose />
              </button>
            </div>

            <div className="em-body" key={sec} data-dir={dir}>
              {sec === "health" && (
                <HealthSection
                  account={account}
                  status={status}
                  exitIp={exitIp}
                  auth={auth}
                  peers={peers}
                  desktop={desktop}
                  leak={leak}
                  traces={traces}
                  busy={busy}
                  onGo={go}
                  onLogin={onLogin}
                  onRotate={onRotate}
                  onCheckExit={onCheckExit}
                  onLoadTraces={onLoadTraces}
                  onClearTraces={onClearTraces}
                />
              )}

              {sec === "general" && (
                <GeneralSection
                  account={account}
                  exitIp={exitIp}
                  onGo={go}
                  status={status}
                  auth={auth}
                  busy={busy}
                  loginTermId={loginTermId}
                  onPatch={onPatch}
                  onLogin={onLogin}
                  onLogout={onLogout}
                  onRefresh={onRefresh}
                  onOpenTerminal={() => {
                    onOpenTerminal();
                    close();
                  }}
                  onCancelLogin={onCancelLogin}
                />
              )}

              {sec === "network" && (
                <NetworkSection
                  account={account}
                  peers={peers}
                  exits={exits}
                  onUseExit={onUseExit}
                  onCreateExit={onCreateExit}
                  onRenameExit={onRenameExit}
                  onDeleteExit={onDeleteExit}
                  onMeasureExit={onMeasureExit}
                  onRepairExit={onRepairExit}
                  onSwapNode={onSwapNode}
                  onOpenShell={onOpenShell}
                  onPatch={onPatch}
                  onIp={(ip) => {
                    onPatch({ lastExitIp: ip, lastExitCheckedAt: Date.now() });
                  }}
                  onAlign={(t) => onPatch({ terminal: { ...account.terminal, ...t } })}
                />
              )}

              {sec === "browser" && <BrowserSection account={account} onPatch={onPatch} onLogin={onLogin} />}

              {sec === "fingerprint" && (
                <>
                  <div className="em-sub">
                    <span>{tr("设备身份", "Device identity")}</span>
                  </div>
                  <div className="em-card">
                    <Row title="userID" desc={tr("遥测里的 device_id", "The device_id in telemetry")}>
                      <code className="em-code">
                        {status?.identity.userID ? `${status.identity.userID.slice(0, 18)}…` : tr("尚未生成", "Not generated yet")}
                      </code>
                    </Row>
                    <Row title="machineID" desc={tr("第一次启动 Claude Code 时生成", "Generated the first time Claude Code starts")}>
                      <code className="em-code">
                        {status?.identity.machineID ? `${status.identity.machineID.slice(0, 18)}…` : tr("尚未生成", "Not generated yet")}
                      </code>
                    </Row>
                    <Row
                      title={tr("轮换设备身份", "Rotate device identity")}
                      desc={tr("重置这台机器的画像，账号本身不变", "Resets this machine's profile. The account itself is unchanged")}
                      tip={
                        <Help title={tr("什么时候需要轮换？", "When should I rotate?")}>
                          <p>
                            {tr(
                              "Claude Code 会生成一串 userID 当作「这台设备」上报。几个号用同一串，看起来就是同一台机器。",
                              "Claude Code generates a userID and reports it as “this device”. If several accounts share one, they look like the same machine.",
                            )}
                          </p>
                          <p>
                            {tr(
                              "新建的环境本来就各自独立，一般不用动。只有从别处拷过来的目录、或者怀疑被关联时才点。轮换不会掉登录。",
                              "New environments are already independent, so you usually don't need this. Use it only for directories copied from elsewhere, or if you suspect accounts are linked. Rotating won't sign you out.",
                            )}
                          </p>
                        </Help>
                      }
                    >
                      <button className="btn" onClick={onRotate} disabled={busy}>
                        <IconShield />
                        {busy ? tr("处理中…", "Working…") : tr("轮换", "Rotate")}
                      </button>
                    </Row>
                  </div>
                  <div className="em-sub">
                    <span>{tr("终端画像", "Terminal profile")}</span>
                  </div>
                  <div className="em-card">
                    <Row title={tr("终端类型", "Terminal type")} desc="TERM / TERM_PROGRAM">
                      <select
                        className="em-sel"
                        value={account.terminal?.term ?? ""}
                        onChange={(e) => onPatch({ terminal: { ...account.terminal, term: e.target.value } })}
                      >
                        {withCurrent(TERM_OPTIONS, account.terminal?.term).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </Row>
                    <Row title={tr("语言", "Language")} desc="LANG">
                      <select
                        className="em-sel"
                        value={account.terminal?.lang ?? ""}
                        onChange={(e) => onPatch({ terminal: { ...account.terminal, lang: e.target.value } })}
                      >
                        {withCurrent(LANG_OPTIONS, account.terminal?.lang).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </Row>
                    <Row
                      title={tr("时区", "Time zone")}
                      desc={tr("TZ · 跟出口对齐才自然", "TZ · should match the exit")}
                      tip={
                        <button
                          className="em-relink"
                          title={tr("用本机系统时区", "Use the machine's time zone")}
                          onClick={() => onPatch({ terminal: { ...account.terminal, tz: systemTz() } })}
                        >
                          {tr("用本机", "Local")}
                        </button>
                      }
                    >
                      <select
                        className="em-sel"
                        value={account.terminal?.tz ?? ""}
                        onChange={(e) => onPatch({ terminal: { ...account.terminal, tz: e.target.value } })}
                      >
                        {withCurrent(TZ_OPTIONS, account.terminal?.tz).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </Row>
                    <Row
                      title={tr("和其他环境拉开差距", "Differentiate from other environments")}
                      desc={tr("换一组跟现有环境都不重样的画像", "Pick a profile that differs from all existing environments")}
                      tip={
                        <Help title={tr("终端画像是什么？", "What is a terminal profile?")}>
                          <p>
                            {tr(
                              "终端类型、语言、时区会随请求上报。几个环境一模一样，就少了一层区分。",
                              "Terminal type, language and time zone are reported with requests. If several environments are identical, they're harder to tell apart.",
                            )}
                          </p>
                          <p>
                            {tr(
                              "点「换一组」会自动挑一组跟其他环境都不重复的值，下次开会话生效。不影响你实际使用。",
                              "Click “Shuffle” to pick values no other environment uses. It takes effect for the next session and doesn't affect how you work.",
                            )}
                          </p>
                        </Help>
                      }
                    >
                      <button className="btn" onClick={onDiversify}>
                        <IconRefresh />
                        {tr("换一组", "Shuffle")}
                      </button>
                    </Row>
                  </div>

                  {similar && (
                    <div className="sim">
                      <div className="sim-head">
                        <span>{tr(`与「${similar.otherLabel}」的对比`, `Compared with “${similar.otherLabel}”`)}</span>
                        <span
                          className={`sim-score${similar.report.isolationScore >= 60 ? " good" : similar.report.isolationScore >= 30 ? " mid" : " low"}`}
                        >
                          {similar.report.isolationScore}%
                        </span>
                      </div>
                      <div className="sim-bar">
                        <i style={{ width: `${similar.report.isolationScore}%` }} />
                      </div>
                      <div className="sim-cap">
                        {tr(
                          `能拉开的 ${similar.report.movableTotal} 项里，已经拉开 ${similar.report.movableDiffered} 项`,
                          `${similar.report.movableDiffered} of ${similar.report.movableTotal} adjustable items already differ`,
                        )}
                      </div>
                      <div className="sim-axes">
                        {similar.report.axes.map((ax) => (
                          <div key={ax.key} className={`sim-ax${ax.fixed ? " fixed" : ax.differs ? " diff" : ""}`}>
                            <span className="sim-ax-name">
                              {ax.fixed && <i className="sim-lock" />}
                              {ax.label}
                            </span>
                            <span className="sim-ax-vals mono">
                              {ax.fixed
                                ? tr("同机，改不掉", "Same machine, can't change")
                                : ax.unknown
                                  ? tr("未知", "Unknown")
                                  : ax.differs
                                    ? tr("已不同", "Different")
                                    : tr("相同", "Same")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="em-note">
                    {tr(
                      "轮换换不掉账号 UUID、uname 画像、仓库哈希和出口 IP —— 这些不在本地，改不了也不假装能改。",
                      "Rotation can't change the account UUID, uname profile, repo hash or exit IP. These aren't local, so they can't be changed, and we won't pretend otherwise.",
                    )}
                  </div>
                </>
              )}

              {sec === "sessions" && (
                <>
                  <div className="em-bar">
                    <span>{sessions ? tr(`${sessions.length} 个会话`, `${sessions.length} sessions`) : tr("读取中…", "Loading…")}</span>
                    <button className="det-k" onClick={onLoadSessions}>
                      {tr("刷新", "Refresh")}
                    </button>
                  </div>
                  {sessions && sessions.length === 0 ? (
                    <div className="em-empty">{tr("这个环境还没有历史会话。", "This environment has no session history yet.")}</div>
                  ) : (
                    <div className="em-card">
                      {(sessions ?? []).slice(0, 30).map((s) => (
                        <button
                          key={s.id}
                          className="em-sess"
                          onClick={() => {
                            onOpenSession(s);
                            close();
                          }}
                          title={`${s.cwd}\n${s.title}`}
                        >
                          <span className="em-sess-t">{s.title}</span>
                          <span className="em-sess-m">
                            <span className="mono">{shortCwd(s.cwd)}</span>
                            <span>{relTime(s.lastActive)}</span>
                            <span className="mono">{fmtSize(s.sizeBytes)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {sec === "clean" && (
                <>
                  <TracesSection
                    traces={traces}
                    keychain={keychain}
                    busy={busy}
                    onLoadTraces={onLoadTraces}
                    onLoadKeychain={onLoadKeychain}
                    onClearTraces={onClearTraces}
                  />
                  <div className="em-sub">
                    <span>{tr("删除环境", "Delete environment")}</span>
                  </div>
                  <DangerSection account={account} canRemove={canRemove} busy={busy} onRemove={onRemove} />
                </>
              )}
            </div>
          </section>
        </>
      )}
    </Modal>
  );
}

function Row({ title, desc, tip, children }: { title: string; desc?: ReactNode; tip?: ReactNode; children?: ReactNode }) {
  return (
    <div className="em-row">
      <span className="em-row-t">
        <b>
          {title}
          {tip}
        </b>
        {desc && <small>{desc}</small>}
      </span>
      <span className="em-row-c">{children}</span>
    </div>
  );
}

/**
 * 下拉选项：把当前值也塞进去。
 *
 * 配置里可能存着预设之外的值（手动改过文件、或者系统时区是别的城市）。
 * 不补的话 <select> 找不到匹配项，界面就是一片空白 —— 用户以为配置丢了。
 */
function withCurrent(opts: readonly string[], current?: string): string[] {
  const list = opts as readonly string[];
  if (!current || list.includes(current)) return list.slice();
  return [current, ...list];
}

function GeneralSection({
  account,
  exitIp,
  onGo,
  status,
  auth,
  busy,
  loginTermId,
  onPatch,
  onLogin,
  onLogout,
  onRefresh,
  onOpenTerminal,
  onCancelLogin,
}: {
  account: Account;
  exitIp: string | null;
  onGo: (s: EnvSection) => void;
  status: AccountStatusSnapshot | undefined;
  auth: Account["auth"];
  busy: boolean;
  loginTermId: string | null;
  onPatch: (patch: Partial<Account>) => void;
  onLogin: (browser?: string) => void;
  onLogout: () => void;
  onRefresh: () => void;
  onOpenTerminal: () => void;
  onCancelLogin: () => void;
}) {
  const [name, setName] = useState(account.label);
  useEffect(() => setName(account.label), [account.label]);
  const commit = () => {
    const v = name.trim();
    if (v && v !== account.label) onPatch({ label: v });
    else setName(account.label);
  };
  const signedIn = auth === "signedIn";
  const hasProxy = account.proxy.protocol !== "none";
  const ipKnown = Boolean(exitIp || account.lastExitIp);
  /**
   * 两步就够：登录、配出口。出口填了代理、或者直连测过一次 IP，就算配好 ——
   * 之前把「测 IP」单列一步，配完代理每次进来还挂着一条待办，像是没配完。
   */
  const netDone = hasProxy || ipKnown;
  const steps: { done: boolean; title: string; desc: string; act: string; run: () => void }[] = [
    {
      done: signedIn,
      title: tr("登录 Claude 账号", "Sign in to Claude"),
      desc: signedIn
        ? tr(`已登录 ${status?.email ?? ""}`, `Signed in as ${status?.email ?? ""}`)
        : status?.email
          ? tr(
              `上次登录的是 ${status.email}，凭据已不在，需要重新授权`,
              `Last signed in as ${status.email}. Credentials are gone, so you need to authorize again`,
            )
          : tr(
              "点「登录」会打开浏览器，在网页上点授权，回来就自动识别",
              "Click “Sign in” to open your browser, authorize there, and come back. It's detected automatically",
            ),
      act: status?.email ? tr("重新登录", "Sign in again") : tr("登录", "Sign in"),
      run: () => onLogin(),
    },
    {
      done: netDone,
      title: tr("配网络出口", "Set up network exit"),
      desc: netDone
        ? ipKnown
          ? tr(
              `出口 ${exitIp ?? account.lastExitIp} · 本机 ${proxyLabel(account.proxy)}`,
              `Exit ${exitIp ?? account.lastExitIp} · local ${proxyLabel(account.proxy)}`,
            )
          : tr(
              `${proxyLabel(account.proxy)} · 还没测到出口 IP`,
              `${proxyLabel(account.proxy)} · exit IP not measured yet`,
            )
        : tr(
            "多个号最好各走各的线路。用梯子的话点进去「自动探测」，不用梯子选「直连」",
            "With multiple accounts, give each its own route. If you use a proxy, open it and click “Auto-detect”. Otherwise choose “Direct”",
          ),
      act: tr("去设置", "Set up"),
      run: () => onGo("network"),
    },
  ];
  const doneN = steps.filter((s) => s.done).length;

  return (
    <>
      {doneN < steps.length && (
        <div className="em-guide">
          <div className="em-guide-h">
            <b>{tr("把这个环境配好", "Finish setting up this environment")}</b>
            <span>
              {doneN}/{steps.length}
            </span>
            <i className="em-guide-bar">
              <i style={{ width: `${(doneN / steps.length) * 100}%` }} />
            </i>
          </div>
          {steps.map((s, i) => (
            <div key={s.title} className={`em-step${s.done ? " done" : ""}`}>
              <span className="em-step-n">{s.done ? <IconCheck size={11} /> : i + 1}</span>
              <span className="em-step-t">
                <b>{s.title}</b>
                <small>{s.desc}</small>
              </span>
              {!s.done &&
                (i === 0 ? (
                  // 登录这一步也能就地换浏览器 / 用户资料 / 无痕
                  <LoginButton account={account} busy={busy} waiting={Boolean(loginTermId)} label={s.act} onLogin={onLogin} />
                ) : (
                  <button className={`btn${i === steps.findIndex((x) => !x.done) ? " pri" : ""}`} onClick={s.run}>
                    {s.act}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {loginTermId && (
        <div className="em-login em-login-top">
          <LoginConsole
            termId={loginTermId}
            signedIn={signedIn}
            onCancel={() => {
              void window.claudeBuddy.accountCloseLogin(account.id, loginTermId);
              onCancelLogin();
            }}
          />
        </div>
      )}

      <div className="em-card">
        <Row title={tr("名字", "Name")} desc={tr("只在本机显示，随时能改", "Only shown on this Mac. You can change it anytime")}>
          <input
            className="em-in"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </Row>
        <Row title={tr("标识色", "Color")} desc={tr("侧栏、页签上用它区分环境", "Used to tell environments apart in the sidebar and tabs")}>
          <span className="em-tints">
            {ACCOUNT_TINTS.map((t) => (
              <button
                key={t}
                className={`em-tint${account.tint === t ? " on" : ""}`}
                style={{ background: t }}
                title={t}
                onClick={() => onPatch({ tint: t })}
              />
            ))}
          </span>
        </Row>
        <Row title={tr("配置目录", "Config directory")} desc={tr("CLAUDE_CONFIG_DIR，凭据和记录都在这里", "CLAUDE_CONFIG_DIR. Credentials and history live here")}>
          <code className="em-code">~/{account.configDir}</code>
        </Row>
      </div>

      <div className="em-sub">
        <span>{tr("登录", "Sign-in")}</span>
        <button className="det-k" onClick={onRefresh}>
          {tr("刷新状态", "Refresh status")}
        </button>
      </div>
      <div className="em-card">
        {/* 没登录但有档案 = 登录过、凭据没了。邮箱照样显示，但明说是「上次」，
            不然「未登录」旁边挂一个邮箱，看着像状态读错了 */}
        <Row
          title={tr("账号", "Account")}
          desc={
            signedIn
              ? tr("已授权，凭据在 Keychain", "Authorized. Credentials are in Keychain")
              : status?.email
                ? tr(
                    "上次登录的账号。凭据已不在 Keychain，要重新授权",
                    "The account last signed in. Credentials are no longer in Keychain, so you need to authorize again",
                  )
                : tr("这个环境还没有登录过", "This environment has never been signed in")
          }
        >
          <span className={`em-val${signedIn ? "" : " dim"}`}>
            {status?.email ?? (auth === "unknown" ? tr("还没确认", "Not checked yet") : tr("未登录", "Signed out"))}
          </span>
        </Row>
        {signedIn && status?.tier && (
          <Row title={tr("订阅", "Plan")}>
            <span className="em-val">{tierLabel(status.tier)}</span>
          </Row>
        )}
        <Row
          title={
            signedIn
              ? tr("退出登录", "Sign out")
              : status?.email
                ? tr("重新登录", "Sign in again")
                : tr("登录授权", "Sign in")
          }
          desc={
            signedIn
              ? tr("从 Keychain 清掉这个环境的凭据", "Removes this environment's credentials from Keychain")
              : status?.email
                ? tr(
                    `上次是 ${status.email}，凭据已不在 Keychain，授权一次就好`,
                    `Last signed in as ${status.email}. Credentials are gone; authorize once to restore`,
                  )
                : tr("打开浏览器授权，完成后自动识别", "Authorize in your browser. It's detected automatically")
          }
        >
          {!signedIn ? (
            <LoginButton
              account={account}
              busy={busy}
              waiting={Boolean(loginTermId)}
              label={status?.email ? tr("重新登录", "Sign in again") : tr("登录", "Sign in")}
              onLogin={onLogin}
            />
          ) : (
            <button className="btn" onClick={onLogout} disabled={busy}>
              {tr("退出登录", "Sign out")}
            </button>
          )}
        </Row>
        <Row title={tr("打开终端", "Open Terminal")} desc={tr("在这个环境里起一个 Claude Code", "Start Claude Code in this environment")}>
          <button className="btn" onClick={onOpenTerminal}>
            <IconTerminal />
            {tr("打开", "Open")}
          </button>
        </Row>
      </div>

      {account.heldAt && (
        <div className="det-warn">
          <IconWarning size={13} />
          {tr(
            "这个账号处于暂时风控。风控在 API 请求、OAuth 回调、Token 刷新三处都判定，换本地凭据绕不过去；这是账号级状态，不是本机没登录。",
            "This account is temporarily restricted. The risk check applies to API requests, OAuth callbacks and token refresh, so swapping local credentials won't get around it; it's an account-level state, not a local sign-out.",
          )}
        </div>
      )}

    </>
  );
}

function NetworkSection({
  account,
  peers,
  exits,
  onUseExit,
  onCreateExit,
  onRenameExit,
  onDeleteExit,
  onMeasureExit,
  onRepairExit,
  onSwapNode,
  onOpenShell,
  onPatch,
  onIp,
  onAlign,
}: {
  account: Account;
  /** 全部环境，用来做出口对比 */
  peers: Account[];
  /** 这台机器配过的出口 */
  exits: Exit[];
  /** 把这个环境切到某个出口；undefined = 直连 */
  onUseExit: (exitId: string | undefined) => void;
  onCreateExit: (exit: Omit<Exit, "id"> & { id?: string }) => void;
  onRenameExit: (id: string, label: string) => void;
  onDeleteExit: (id: string) => void;
  /** 实测到出口的真实 IP 后写回 */
  onMeasureExit: (id: string, ip: string | null) => void;
  /** 托管实例重启后端口变了，回写出口和用它的环境 */
  onRepairExit: (id: string, port: number, host: string) => void;
  /** 托管出口换了节点 */
  onSwapNode: (id: string, subId: string, node: string) => void;
  /** 开一个空白终端自己测网络 */
  onOpenShell: () => void;
  onPatch: (patch: Partial<Account>) => void;
  onIp: (ip: string) => void;
  onAlign: (t: { tz?: string; lang?: string }) => void;
}) {
  const p = account.proxy;
  const [guide, setGuide] = useState(false);
  /**
   * 点了「还没有出口的那种方式」时要弹新建。
   * 单独一个 state 而不是复用 ExitList 的 picking：两者打开的时机不同，
   * 一个是从「代理方式」卡进来（已经定了走哪条路），一个是从出口列表进来。
   */
  const [pickingMode, setPickingMode] = useState<ProxyMode | null>(null);
  /**
   * 体检默认收起。
   *
   * 它是"看"的东西，不是"操作"的东西 —— 展开时那张卡有分数块、三栏指标、
   * 数据来源，一大块。放在首屏会把"选出口"挤到折叠以下，每次都要滑。
   * 收成一行标题，想知道再点开。
   */
  const [showCheck, setShowCheck] = useState(false);

  /** 这个环境现在走哪种方式 —— 页面最上面要说的就是这件事 */
  const mode = proxyModeOf(account, exits);

  /**
   * 切换代理方式。
   *
   * 切到某条路时，如果那条路上已经有出口就直接切过去 —— 用户点「App 托管」
   * 的意思通常是“用我托管的那条线路”，而不是“给我再建一个”。
   * 没有才弹新建：这时候建是唯一能做的事。
   */
  const pickMode = (m: ProxyMode) => {
    if (m === "direct") {
      onUseExit(undefined);
      return;
    }
    const pool = exits.filter((e) => (m === "managed" ? Boolean(e.managed) : !e.managed));
    if (pool.length > 0) {
      onUseExit(pool[0].id);
      return;
    }
    setPickingMode(m);
  };

  /**
   * 有几组环境共用同一个出口。
   * 只算测过的：没测过的不知道，不能算成"共用"，否则每个新环境都会被误报。
   */
  const sameExitGroups = (() => {
    const seen = new Map<string, number>();
    for (const a of peers) {
      if (!a.lastExitIp) continue;
      seen.set(a.lastExitIp, (seen.get(a.lastExitIp) ?? 0) + 1);
    }
    return [...seen.values()].filter((n) => n > 1);
  })();
  return (
    <>
      {/* 第一件事：这个环境走哪条线，以及**换一个出口**。
          方式压成一行，出口列表紧随其后 —— 上面一行、下面就是可点的出口，
          不用再滚到底才能选。体检是参考，沉到后面。 */}
      <ProxyModeCard mode={mode} onPick={pickMode} exits={exits} />

      {/**
       * 出口列表 —— 这台机器有几个出口、各自什么 IP、谁在用、能不能换。
       *
       * 提到体检前面：它是这一页唯一要"操作"的东西，其余都是看。
       */}
      <ExitList
        exits={exits}
        accounts={peers}
        currentExitId={account.exitId}
        onUse={onUseExit}
        onCreate={onCreateExit}
        onRename={onRenameExit}
        onDelete={onDeleteExit}
        onMeasure={onMeasureExit}
        onRepaired={onRepairExit}
        onSwapNode={onSwapNode}
        onOpenShell={onOpenShell}
      />

      {/* 体检：默认收起。首屏只留"方式 + 出口列表"两件要动的事 */}
      <div className="em-sub">
        <button className="em-sub-t" onClick={() => setShowCheck((v) => !v)}>
          <span>{tr("出口体检", "Exit check")}</span>
          <small>
            {account.lastExitIp
              ? tr(`本机看到 ${account.lastExitIp}`, `This Mac sees ${account.lastExitIp}`)
              : tr("还没测过", "Not measured yet")}
          </small>
          <IconChevronDown size={13} className={`em-sub-c${showCheck ? " rot" : ""}`} />
        </button>
        <button className="det-k" onClick={() => setGuide(true)}>
          {tr("指导", "Guide")}
        </button>
      </div>
      {showCheck && (
        <>
      <NetReportCard
        accountId={account.id}
        proxyKey={proxyLabel(p)}
        lastIp={account.lastExitIp ?? null}
        tz={account.terminal?.tz ?? systemTz()}
        onIp={onIp}
        onAlign={onAlign}
      />

      {/* 多个环境时的出口对比：一眼看出谁和谁撞了。
          只有一个环境就不显示 —— 没什么可比的，白占地方。 */}
      {peers.length > 1 && (
        <div className="em-card ex-cmp">
          <div className="ex-cmp-h">
            <span>{tr("出口对比", "Exit comparison")}</span>
            <small>
              {sameExitGroups.length > 0
                ? tr(`${sameExitGroups.length} 组共用出口`, `${sameExitGroups.length} shared exit(s)`)
                : tr("各自独立", "All separate")}
            </small>
          </div>
          {peers.map((a) => {
            /**
             * 优先用出口实测到的 IP，其次才是环境自己记录的。
             *
             * 出口上的值是「通过这个端口真测出来的」，可信；
             * 环境上的 lastExitIp 可能是它还在别的线路上时留下的。
             * 对比的目的就是看「现在谁和谁撞」，所以要用前者。
             */
            const exit = exits.find((e) => e.id === a.exitId);
            const ip = exit?.lastIp ?? a.lastExitIp;
            const shared = ip
              ? peers.filter((x) => {
                  if (x.id === a.id) return false;
                  const xExit = exits.find((e) => e.id === x.exitId);
                  return (xExit?.lastIp ?? x.lastExitIp) === ip;
                })
              : [];
            return (
              <div className={`ex-row${a.id === account.id ? " on" : ""}`} key={a.id}>
                <span className="ex-dot" style={{ background: a.tint }} />
                <span className="ex-name">{a.label}</span>
                <span className="ex-ip mono">{ip ?? tr("未测", "—")}</span>
                <span className={`ex-tag${shared.length ? " bad" : ip ? " ok" : ""}`}>
                  {shared.length
                    ? tr(`同 ${shared.map((s) => s.label).join("、")}`, `Same as ${shared.map((s) => s.label).join(", ")}`)
                    : ip
                      ? tr("独立", "Unique")
                      : tr("未测", "Unmeasured")}
                </span>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      <div className="em-card">
        <Row
          title={tr("没配出口就不允许开会话", "No exit, no session")}
          desc={tr(
            "打开后，这个环境在所有入口（侧栏、右键、历史会话）都要求先有可用线路",
            "When on, every entry point (sidebar, context menu, past sessions) requires a working route first",
          )}
          tip={
            <Help title={tr("为什么要强制？", "Why force it?")}>
              <p>
                {tr(
                  "环境之间共用一个出口，在服务端看来就是同一台机器后面的多个身份。这台机器上没装网络命名空间，拦不住进程直连，所以唯一能做的是“没配就不放行”。",
                  "Environments sharing one exit look like several identities on the same machine. There are no network namespaces here to stop a direct connection, so the best available guarantee is refusing to start.",
                )}
              </p>
            </Help>
          }
        >
          <input
            type="checkbox"
            checked={Boolean(account.enforceProxy)}
            onChange={(e) => onPatch({ enforceProxy: e.target.checked })}
            aria-label={tr("没配出口就不允许开会话", "No exit, no session")}
          />
        </Row>
      </div>

              {/* 从「代理方式」卡进来的新建：已经定了走哪条路，弹窗直接落在那条路上 */}
              {pickingMode && (
                <ExitPicker
                  onClose={() => setPickingMode(null)}
                  initialWho={pickingMode === "managed" ? "managed" : "local"}
                  onCreate={(exit) => {
                    onCreateExit(exit);
                    setPickingMode(null);
                  }}
                />
              )}

              {/* 指导按当前方式给不同内容 —— 托管已经自己起实例开端口了，
                  再教用户去改 listeners 配置就是误导 */}
              {guide && <ExitGuide onClose={() => setGuide(false)} mode={mode} />}
    </>
  );
}

function TracesSection({
  traces,
  keychain,
  busy,
  onLoadTraces,
  onLoadKeychain,
  onClearTraces,
}: {
  traces: TraceItem[] | undefined;
  keychain: KeychainEntry[] | null;
  busy: boolean;
  onLoadTraces: () => void;
  onLoadKeychain: () => void;
  onClearTraces: (keys: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const existing = (traces ?? []).filter((t) => t.exists);
  const clearable = existing.filter((t) => t.key !== "credentials" && t.key !== "identity");

  return (
    <>
      <div className="em-bar">
        <span className="em-bar-t">
          {traces
            ? tr(`${existing.length} 项 · 勾选要清掉的`, `${existing.length} items · Select what to clean up`)
            : tr("统计中…", "Counting…")}
          <Help title={tr("清痕迹会清掉什么？", "What does cleaning traces remove?")}>
            <p>
              {tr(
                "对话记录、文件快照、缓存、日志这类东西，清掉后这个环境就像刚用过一次。",
                "Conversation history, file snapshots, caches and logs. After cleaning, the environment looks like it was only used once.",
              )}
            </p>
            <p>
              {tr(
                "登录凭据和设备身份锁着不让勾 —— 清了等于掉登录。要彻底清空一个号，去「删除环境」连目录一起删。",
                "Credentials and device identity are locked because removing them signs you out. To wipe an account completely, use “Delete environment” and delete its directory too.",
              )}
            </p>
          </Help>
        </span>
        <button className="det-k" onClick={onLoadTraces}>
          {tr("重新统计", "Recount")}
        </button>
      </div>
      {traces && existing.length === 0 ? (
        <div className="em-empty">{tr("这个环境还没有留下痕迹。", "This environment has left no traces yet.")}</div>
      ) : (
        <div className="em-card">
          {existing.map((t) => {
            const locked = t.key === "credentials" || t.key === "identity";
            return (
              <label key={t.key} className={`em-trace${locked ? " locked" : ""}`}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={picked.includes(t.key)}
                  onChange={(e) =>
                    setPicked((prev) => (e.target.checked ? [...prev, t.key] : prev.filter((k) => k !== t.key)))
                  }
                />
                <span className="em-trace-n">
                  {t.label}
                  {locked && <small>{tr("保留 · 删了会掉登录", "Kept · Removing it signs you out")}</small>}
                </span>
                <span className="mono">{fmtSize(t.size)}</span>
              </label>
            );
          })}
        </div>
      )}
      {clearable.length > 0 && (
        <div className="em-acts">
          <button className="det-k" onClick={() => setPicked(picked.length === clearable.length ? [] : clearable.map((t) => t.key))}>
            {picked.length === clearable.length ? tr("全不选", "Deselect all") : tr("全选可清项", "Select all")}
          </button>
          <button
            className="btn pri"
            disabled={picked.length === 0 || busy}
            onClick={() => {
              onClearTraces(picked);
              setPicked([]);
            }}
          >
            {busy
              ? tr("清理中…", "Cleaning up…")
              : picked.length
                ? tr(`清掉这 ${picked.length} 项`, `Clean up ${picked.length} items`)
                : tr("清理", "Clean up")}
          </button>
        </div>
      )}

      <div className="em-sub">
        <span>Keychain</span>
        <button className="det-k" onClick={onLoadKeychain}>
          {keychain ? tr("刷新", "Refresh") : tr("读取", "Load")}
        </button>
      </div>
      {keychain ? (
        keychain.length === 0 ? (
          <div className="em-empty">{tr("没有找到 Claude Code 的 Keychain 条目。", "No Claude Code Keychain entries found.")}</div>
        ) : (
          <div className="em-card">
            {keychain.map((k) => (
              <div key={k.service} className="em-kc">
                <IconLock size={13} />
                <span className="mono">{k.service}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="em-empty">{tr("列出本机所有 Claude Code 的 Keychain 条目。", "List all Claude Code Keychain entries on this Mac.")}</div>
      )}
    </>
  );
}

function DangerSection({
  account,
  canRemove,
  busy,
  onRemove,
}: {
  account: Account;
  canRemove: boolean;
  busy: boolean;
  onRemove: (purge: boolean) => void;
}) {
  const [purge, setPurge] = useState(false);
  const [typed, setTyped] = useState("");
  const isHome = account.configDir === ".claude";
  const needType = purge;
  const ok = canRemove && (!needType || typed.trim() === account.label);

  return (
    <>
      <div className="em-card">
        <Row
          title={tr("仅从列表移除", "Remove from list only")}
          desc={tr("磁盘目录保留，之后还能用「导入」加回来", "Keeps the directory on disk. You can add it back later with “Import”")}
        >
          <input type="radio" name="purge" checked={!purge} onChange={() => setPurge(false)} />
        </Row>
        <Row
          title={tr("连磁盘目录一起删", "Also delete the directory on disk")}
          desc={
            isHome
              ? tr("这是你原本的 ~/.claude，不能删目录", "This is your original ~/.claude. Its directory can't be deleted")
              : tr(
                  `~/${account.configDir} 会被永久删除，凭据和记录全没了`,
                  `~/${account.configDir} will be permanently deleted, including credentials and history`,
                )
          }
        >
          <input type="radio" name="purge" checked={purge} disabled={isHome} onChange={() => setPurge(true)} />
        </Row>
      </div>

      {needType && (
        <div className="em-confirm">
          <span>{tr(`输入环境名「${account.label}」确认永久删除`, `Type the environment name “${account.label}” to confirm permanent deletion`)}</span>
          <input className="em-in" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={account.label} />
        </div>
      )}

      {!canRemove && <div className="em-note">{tr("这是最后一个环境，至少要留一个。", "This is the last environment. At least one must remain.")}</div>}

      <div className="em-acts">
        <button className="btn danger" disabled={!ok || busy} onClick={() => onRemove(purge)}>
          <IconTrash size={13} />
          {busy ? tr("处理中…", "Working…") : purge ? tr("删除目录并移除", "Delete directory and remove") : tr("从列表移除", "Remove from list")}
        </button>
      </div>
    </>
  );
}

function shortCwd(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

function fmtSize(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
