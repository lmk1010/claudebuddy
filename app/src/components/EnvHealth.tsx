import { useEffect } from "react";
import type { Account, AccountStatusSnapshot, AuthState } from "../lib/model";
import { healthOf } from "../lib/model";
import type { DesktopProbe, LeakReport, TraceItem } from "../lib/bridge";
import { tr } from "../lib/i18n";
import { IconCheck, IconWarning } from "./iconAliases";

/**
 * 环境抽屉里的「健康评分」。
 *
 * 一行一条检查项，绿勾代表这一项没问题。只有真出问题的才标出来并给按钮 ——
 * 不写大段解释，不把正常的事说成风险。
 *
 * 几条容易搞错的判断：
 *   · 设备码从 status 里读。account.identity 是配置文件里那份旧快照，
 *     第一次启动前是空的，从它读会把已经有设备码的环境报成没有。
 *   · 出口 IP 有记录就直接显示。上次测过的值一直留着，不用再让人测一遍。
 *   · 痕迹是这个号自己产生的，本来就正常 —— 它不算风险，只给一个清理入口。
 */

type State = "ok" | "warn" | "bad" | "info";

const DOT: Record<State, string> = { ok: "ok", warn: "mid", bad: "bad", info: "info" };

/**
 * 一行检查项：状态点 · 名称 · 值 · 可选动作
 *
 * 值列是**单行**的：主值和副值用 · 内联，超出用省略号截断。
 * 之前主值在上、副值在下，有副值的行就变成两行高，
 * 一屏里行高参差不齐 —— 列表看着乱，扫读也失去节奏。
 */
function Row({
  state,
  label,
  value,
  note,
  action,
}: {
  state: State;
  label: string;
  value: string;
  /** 副值：同一行内跟在主值后面，不再单独占一行 */
  note?: string;
  action?: { label: string; run: () => void; disabled?: boolean };
}) {
  return (
    <div className={`hs-row st-${state}`}>
      <span className={`hs-dot ${DOT[state]}`}>
        {state === "ok" ? <IconCheck size={11} /> : state === "info" ? null : <IconWarning size={11} />}
      </span>
      <span className="hs-k" title={label}>
        {label}
      </span>
      <span className="hs-v" title={note ? `${value} · ${note}` : value}>
        <b className="mono">{value}</b>
        {note && <em>{note}</em>}
      </span>
      {action ? (
        <button className="btn hs-act" onClick={action.run} disabled={action.disabled}>
          {action.label}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function kb(n: number) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} GB` : `${Math.round(n / 1024)} KB`;
}

export default function HealthSection({
  account,
  status,
  exitIp,
  auth,
  peers,
  desktop,
  leak,
  traces,
  busy,
  onGo,
  onLogin,
  onRotate,
  onCheckExit,
  onLoadTraces,
  onClearTraces,
}: {
  account: Account;
  status: AccountStatusSnapshot | undefined;
  exitIp: string | null;
  auth: AuthState;
  peers: Account[];
  desktop: DesktopProbe | null;
  leak: LeakReport | null;
  traces: TraceItem[] | undefined;
  busy: boolean;
  onGo: (sec: "health" | "general" | "network" | "browser" | "fingerprint" | "sessions" | "clean") => void;
  onLogin: (browser?: string) => void;
  onRotate: () => void;
  onCheckExit: () => void;
  onLoadTraces: () => void;
  onClearTraces: (keys: string[]) => void;
}) {
  useEffect(() => {
    onLoadTraces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const others = peers.filter((a) => a.id !== account.id);
  const ip = exitIp ?? account.lastExitIp ?? null;
  const stunDetected = Boolean(leak?.stunDetected);
  const desktopRunning = Boolean(desktop?.running);

  const h = healthOf(account, status, exitIp, peers, { stunDetected, desktopRunning });

  // 设备码：只认 status 里那份
  const uid = status?.identity?.userID ?? account.identity?.userID ?? null;
  const sharedUid = uid ? others.filter((a) => a.identity?.userID === uid) : [];

  const proxied = Boolean(account.proxy && account.proxy.protocol !== "none" && account.proxy.host);
  const sharedIp = ip ? others.filter((a) => a.lastExitIp === ip) : [];

  const traceItems = (traces ?? []).filter((t) => t.exists && t.size > 0);
  const localTraces = traceItems.filter((t) => !t.machineWide);
  const machineTraces = traceItems.filter((t) => t.machineWide);
  const localSize = localTraces.reduce((s, t) => s + t.size, 0);

  /** 凭据行的三种状态（只说本地凭据，风控单独一行） */
  const loginRow = (() => {
    if (auth === "expired")
      return {
        state: "bad" as State,
        value: status?.email ?? tr("凭据失效", "Expired"),
        note: tr("重新授权一次就好", "Authorize once to restore"),
        action: { label: tr("重新登录", "Sign in again"), run: () => onLogin() },
      };
    if (auth === "signedIn")
      return { state: "ok" as State, value: status?.email ?? tr("已登录", "Signed in"), note: undefined, action: undefined };
    if (auth === "signedOut")
      return {
        state: "warn" as State,
        value: tr("未登录", "Signed out"),
        note: tr("没登录开不了会话", "Sessions cannot start"),
        action: { label: tr("登录", "Sign in"), run: () => onLogin() },
      };
    return {
      state: "info" as State,
      value: tr("未确认", "Not checked"),
      note: undefined,
      action: { label: tr("去刷新", "Refresh"), run: () => onGo("general") },
    };
  })();

  /** 出口行 */
  const exitRow = (() => {
    if (sharedIp.length > 0)
      return {
        state: "bad" as State,
        value: ip!,
        note: tr(`和「${sharedIp.map((a) => a.label).join("、")}」同一个出口`, `Same exit as ${sharedIp.map((a) => a.label).join(", ")}`),
        action: { label: tr("换", "Change"), run: () => onGo("network") },
      };
    if (!proxied)
      return {
        state: "warn" as State,
        value: tr("直连", "Direct"),
        note: ip ? tr(`出口 ${ip}，和本机一样`, `Exit ${ip}, same as this Mac`) : tr("还没测过", "Not measured"),
        action: { label: tr("配出口", "Set exit"), run: () => onGo("network") },
      };
    if (!ip)
      return {
        state: "warn" as State,
        value: `${account.proxy.protocol.toUpperCase()} ${account.proxy.host}:${account.proxy.port}`,
        note: tr("还没测过出口", "Exit not measured"),
        action: { label: tr("测", "Measure"), run: onCheckExit, disabled: busy },
      };
    return {
      state: "ok" as State,
      value: ip,
      note: `${account.proxy.protocol.toUpperCase()} ${account.proxy.host}:${account.proxy.port}`,
      action: { label: tr("重测", "Re-measure"), run: onCheckExit, disabled: busy },
    };
  })();

  /** 设备码行 */
  const deviceRow = (() => {
    if (sharedUid.length > 0)
      return {
        state: "bad" as State,
        value: `${uid!.slice(0, 8)}…`,
        note: tr(`和「${sharedUid.map((a) => a.label).join("、")}」相同`, `Same as ${sharedUid.map((a) => a.label).join(", ")}`),
        action: { label: tr("换", "Rotate"), run: onRotate, disabled: busy },
      };
    if (!uid)
      return {
        state: "warn" as State,
        value: tr("没有", "None"),
        note: tr("首次启动后由 CLI 生成", "Generated by the CLI on first launch"),
        action: { label: tr("生成", "Generate"), run: onRotate, disabled: busy },
      };
    return { state: "ok" as State, value: `${uid.slice(0, 8)}…`, note: tr("本机独有", "Unique to this Mac"), action: undefined };
  })();

  return (
    <>
      <div className={`hs-score lv-${h.level}`}>
        <span className="hs-num">{h.score}</span>
        <span className="hs-meta">
          <b>
            {h.level === "blocked" ? tr("被风控", "Restricted") : h.level === "risk" ? tr("有风险", "At risk") : tr("就绪", "Ready")}
          </b>
          <small>{h.reasons[0] ?? tr("没有发现问题", "Nothing wrong")}</small>
        </span>
      </div>

      <div className="hs-rows">
        {/* 风控跟凭据是两条轴，各占一行 —— 上一版绑在一起，凭据一掉风控就看不见了 */}
        {account.heldAt && (
          <Row
            state="bad"
            label={tr("风控", "Risk control")}
            value={tr("暂时风控", "Restricted")}
            note={tr("账号级，换本机凭据绕不过", "Account-level; local credentials cannot bypass")}
          />
        )}
        <Row state={loginRow.state} label={tr("登录", "Sign-in")} value={loginRow.value} note={loginRow.note} action={loginRow.action} />
        <Row state={exitRow.state} label={tr("出口", "Exit")} value={exitRow.value} note={exitRow.note} action={exitRow.action} />
        <Row state={deviceRow.state} label={tr("设备码", "Device ID")} value={deviceRow.value} note={deviceRow.note} action={deviceRow.action} />

        {/* ── 已生效的防护 ──
            这几项不靠检测，是软件在起进程时写死的：
            只要会话是从这里开的，就一定生效。列出来是为了让人
            能指着屏幕说"我们做了什么"，而不是只有开发者知道。 */}
        <Row
          state="ok"
          label={tr("配置隔离", "Config")}
          value={`~/${account.configDir}`}
          note={tr("目录、凭据各一份", "Own dir and credentials")}
        />
        <Row
          state="ok"
          label={tr("终端画像", "Terminal")}
          value={account.terminal?.term || "xterm-256color"}
          note={`${account.terminal?.lang || "en_US.UTF-8"} · ${account.terminal?.tz || "Asia/Shanghai"}`}
        />
        <Row
          state="ok"
          label={tr("遥测上报", "Telemetry")}
          value={tr("已关闭", "Off")}
          note={tr("Sentry 与产品遥测", "Sentry and product telemetry")}
        />
        <Row
          state="ok"
          label={tr("云凭据", "Cloud creds")}
          value={tr("已清除", "Cleared")}
          note={tr("AWS / GCP / Vertex", "AWS, GCP, Vertex")}
        />

        {/* 痕迹是这个号自己产生的，本来就正常 —— 只给入口，不当风险 */}
        <Row
          state="ok"
          label={tr("本环境痕迹", "Traces")}
          value={localTraces.length ? tr(`${localTraces.length} 项 · ${kb(localSize)}`, `${localTraces.length} · ${kb(localSize)}`) : tr("无", "None")}
          note={localTraces.length ? tr("本环境独有", "Own only") : undefined}
          action={
            localTraces.length
              ? { label: busy ? "…" : tr("清", "Clear"), run: () => onClearTraces(localTraces.map((t) => t.key)), disabled: busy }
              : undefined
          }
        />
        {machineTraces.length > 0 && (
          <Row
            state="info"
            label={tr("整机日志", "Machine logs")}
            value={kb(machineTraces.reduce((sum, t) => sum + t.size, 0))}
            note={tr("所有环境共用", "Shared by all")}
            action={{ label: busy ? "…" : tr("清", "Clear"), run: () => onClearTraces(machineTraces.map((t) => t.key)), disabled: busy }}
          />
        )}

        <Row
          state={stunDetected ? "bad" : "ok"}
          label={tr("UDP / STUN", "UDP / STUN")}
          value={stunDetected ? tr("检测到外发", "Detected") : tr("没有外发", "None")}
          note={stunDetected ? tr("代理盖不住 UDP", "Proxies miss UDP") : tr("本应用已堵死", "Sealed in this app")}
        />
        <Row
          state={desktopRunning ? "warn" : "ok"}
          label={tr("桌面端", "Desktop")}
          value={desktopRunning ? tr("运行中", "Running") : tr("没在运行", "Not running")}
          note={desktopRunning ? tr("与所有环境共用整机身份", "Shares this Mac's identity") : undefined}
        />
      </div>
    </>
  );
}