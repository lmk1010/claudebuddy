import type {
  GitInfo,
  ProxyConfig,
  RhythmStats,
  RiskLevel,
  ShellWindow,
} from "../lib/model";
import {
  RISK_LABEL,
  RISK_PILL,
  fmtDuration,
  proxyLabel,
  riskOf,
} from "../lib/model";
import type { SessionUsage } from "../lib/bridge";
import { tr } from "../lib/i18n";
import {
  IconClose,
  IconCode,
  IconCopy,
  IconFile,
  IconGlobe,
  IconKey,
} from "./iconAliases";
import SafetyBadge, { SafetyDetails, type SafetyReport } from "./SafetyBadge";

interface Props {
  win: ShellWindow | null;
  accountLabel: string;
  accountEmail?: string | null;
  proxy?: ProxyConfig;
  stats: RhythmStats | null;
  /** 设置里的节奏阈值（次/分） */
  threshold: number;
  usage: SessionUsage | null;
  git: GitInfo | null;
  /** 这个环境的安全状态 */
  safety?: SafetyReport;
  safetyOpen?: boolean;
  onToggleSafety?: () => void;
  onCopy: (text: string) => void;
  onShowDiff: () => void;
  onClose: () => void;
}

/**
 * 右栏检查器 —— 设计稿 08 的 .insp。
 *
 * 五段，全是这个会话真正会发生事的地方：
 *   ① 节奏   24 根分钟柱 + 阈值虚线，偏快会在柱子上变色
 *   ② 上下文 真实 token 用量（读会话 jsonl），读不到就显示「—」
 *   ③ 改动   真实 git 状态
 *   ④ 环境   这个窗口从哪个目录、哪个出口、哪个身份出去
 *
 * 不堆白卡片：每段一条发丝线，一个等宽眉标。
 */
export default function Inspector({
  win,
  accountLabel,
  accountEmail,
  proxy,
  stats,
  threshold,
  usage,
  git,
  safety,
  safetyOpen,
  onToggleSafety,
  onCopy,
  onShowDiff,
  onClose,
}: Props) {
  const risk: RiskLevel = stats ? riskOf(stats, threshold) : "calm";
  const buckets = stats?.buckets ?? new Array(24).fill(0);
  const max = Math.max(threshold + 6, ...buckets, 1);

  return (
    <aside className="insp">
      <div className="in-h">
        <span>{tr("本次会话", "This session")}</span>
        <button className="ib" title={tr("收起检查器 ⌘B", "Hide inspector ⌘B")} onClick={onClose}>
          <IconClose />
        </button>
      </div>

      {/* 安全状态常驻顶部 —— 这是这个软件最该让人一眼看见的东西 */}
      {safety && (
        <div className="in-safety">
          <SafetyBadge report={safety} expanded={safetyOpen} onToggle={() => onToggleSafety?.()} />
          {safetyOpen && <SafetyDetails report={safety} />}
        </div>
      )}

      <section className="in-s">
        <div className="in-k">
          <span>{tr("节奏看护", "Pace guard")}</span>
          <span className={`pill ${RISK_PILL[risk]}`}>{RISK_LABEL[risk]}</span>
        </div>
        <div className="in-fig">
          <span className="fig">{stats?.perMinute ?? 0}</span>
          <span className="unit">{tr("次 / 分钟", "per minute")}</span>
        </div>

        <div className="spark">
          {buckets.map((v, i) => (
            <span
              key={i}
              className={v === 0 ? "zero" : v >= threshold ? "over" : undefined}
              style={{ height: v === 0 ? 2 : `${Math.max(4, Math.min(100, (v / max) * 100))}%` }}
            />
          ))}
          <div className="th" style={{ bottom: `${(threshold / max) * 100}%` }}>
            <b>{threshold}</b>
          </div>
        </div>

        <div className="in-cap">
          {tr("间隔中位数", "Median gap")} <b>{stats?.medianGap ? `${stats.medianGap.toFixed(1)}s` : "—"}</b> · {tr("本小时", "This hour")}{" "}
          <b>{stats?.lastHour ?? 0}</b>{tr(" 次", "")}
        </div>
      </section>

      <section className="in-s">
        <div className="in-k">
          <span>{tr("上下文", "Context")}</span>
          <b className="mono">{usage ? `${contextPct(usage.input)}%` : "—"}</b>
        </div>
        <div className="ctx">
          <i style={{ width: `${usage ? contextPct(usage.input) : 0}%` }} />
        </div>
        <div className="in-cap">
          {usage ? (
            <>
              {tr("本轮", "This turn")} <b>{fmtTokens(usage.input)}</b> / 1M tokens
              {usage.model ? ` · ${shortModel(usage.model)}` : ""}
            </>
          ) : (
            <>{tr("还没有读到用量记录（这个会话还没产生 API 调用）", "No usage data yet (this session hasn't made any API calls)")}</>
          )}
        </div>
      </section>

      <section className="in-s">
        <div className="in-k">
          <span>{tr("本次改动", "Changes")}</span>
          <span className="mono">{tr(`${git?.changes.length ?? 0} 个文件`, `${git?.changes.length ?? 0} files`)}</span>
        </div>

        {(git?.changes ?? []).slice(0, 4).map((c) => (
          <div className="chg" key={c.path}>
            <IconFile />
            <span className="p">{c.path}</span>
            <span className="ds">
              {Array.from({ length: 5 }).map((_, i) => (
                <i
                  key={i}
                  className={i < Math.min(5, Math.max(1, Math.round(Math.log2(c.add + c.del + 1)))) ? "" : "o"}
                />
              ))}
            </span>
            <span className="ad">{c.add > 0 ? `+${c.add}` : c.del > 0 ? `−${c.del}` : ""}</span>
          </div>
        ))}

        {!git || git.changes.length === 0 ? (
          <div className="in-cap" style={{ padding: "2px 0 6px" }}>
            {tr("工作区没有未提交的改动。", "No uncommitted changes in the workspace.")}
          </div>
        ) : null}

        <button className="in-btn" onClick={onShowDiff} disabled={!git?.branch}>
          <IconCode size={13} />
          {tr("查看全部改动", "View all changes")}
          <span className="kbd">⌘D</span>
        </button>
      </section>

      {/* 环境：这个会话到底从哪儿出去、以谁的身份 */}
      <section className="in-s">
        <div className="in-k">
          <span>{tr("运行环境", "Runtime")}</span>
          <span className="mono">{win?.runsClaude ? "claude" : "shell"}</span>
        </div>
        <div className="in-meta-inline">
          <div>
            <span>{tr("账号", "Account")}</span>
            <b>{accountLabel}</b>
          </div>
          <div>
            <span>{tr("出口", "Exit")}</span>
            <b className="mono">{proxy ? proxyLabel(proxy) : tr("直连", "Direct")}</b>
          </div>
          <div>
            <span>{tr("目录", "Folder")}</span>
            <b className="mono" title={win?.cwd} style={{ cursor: "pointer" }}
               onClick={() => win && onCopy(win.cwd)}>
              {win?.cwd ? shorten(win.cwd) : "—"}
              <IconCopy />
            </b>
          </div>
        </div>
      </section>

      <section className="in-s" style={{ borderBottom: "none" }}>
        <div className="in-k">
          <span>{tr("会话", "Session")}</span>
          <span className="mono">
            {stats
              ? fmtDuration(stats.sessionSeconds)
              : win
                ? fmtDuration((Date.now() - win.startedAt) / 1000)
                : "—"}
          </span>
        </div>
        <div className="in-meta-inline">
          <div>
            <span>{tr("项目", "Project")}</span>
            <b>{win?.title ?? "—"}</b>
          </div>
          <div>
            <span>{tr("分支", "Branch")}</span>
            <b className="mono">{win?.branch ?? "—"}</b>
          </div>
          <div>
            <span>{tr("启动于", "Started")}</span>
            <b className="mono">
              {win
                ? new Date(win.startedAt).toLocaleTimeString(tr("zh-CN", "en-US"), {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </b>
          </div>
        </div>
      </section>

      <section className="in-meta">
        <div>
          <span>
            <IconKey size={11} /> {tr("账号", "Account")}
          </span>
          <b className="mono">{accountEmail ?? accountLabel}</b>
        </div>
        <div>
          <span>
            <IconGlobe size={11} /> {tr("出口", "Exit")}
          </span>
          <b className="mono">{proxy ? proxyLabel(proxy) : tr("直连", "Direct")}</b>
        </div>
      </section>
    </aside>
  );
}

/** 头部需要一个"没有会话"的壳，单独给 */
export function InspectorEmpty() {
  return (
    <aside className="insp">
      <div className="in-h">
        <span>{tr("本次会话", "This session")}</span>
      </div>
      <div className="empty-note">
        <b>{tr("还没有活动会话", "No active session")}</b>
        {tr(
          "在主页选一个目录，或从左侧挑一个历史会话。这里会显示它的节奏、上下文、改动，以及它从哪个出口、以谁的身份在跑。",
          "Pick a folder on Home, or choose a past session from the left. Its pace, context, changes, exit and identity will show up here.",
        )}
      </div>
    </aside>
  );
}

/**
 * 上下文占用：真实 token 数来自会话 jsonl，窗口取 1M。
 * 426k 这种数字按 200k 折算会显示成 100%，那是假读数。
 */
const CONTEXT_WINDOW = 1_000_000;

function contextPct(tokens: number): number {
  return Math.min(100, Math.max(1, Math.round((tokens / CONTEXT_WINDOW) * 100)));
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/** claude-opus-4-6-20260101 → opus 4.6 */
function shortModel(m: string): string {
  const parts = m.replace(/^claude-/, "").split("-");
  const family = parts[0] ?? m;
  const ver = parts.filter((p) => /^\d+$/.test(p)).slice(0, 2).join(".");
  return ver ? `${family} ${ver}` : family;
}

function shorten(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}
