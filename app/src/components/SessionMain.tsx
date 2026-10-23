import { useMemo, type CSSProperties } from "react";
import type { Account, GitInfo, ShellWindow } from "../lib/model";
import { fmtDuration, proxyLabel } from "../lib/model";
import TerminalView from "./TerminalView";
import {
  IconCode,
  IconPanel,
  IconPlus,
  IconTerminal,
} from "./iconAliases";

interface Props {
  windows: ShellWindow[];
  accounts: Account[];
  active: ShellWindow | null;
  git: GitInfo | null;
  uiScale: number;
  fontSize: number;
  fontFamily: string;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  copyOnSelect: boolean;
  ptyOk: boolean;
  onSelect: (id: string) => void;
  onToggleConsole: () => void;
  showDiff: boolean;
  onToggleDiff: () => void;
  /** ⌘T：在当前账号下再开一个窗口 */
  onNew: () => void;
}

/**
 * 会话主区 —— 设计稿 08 · session。
 *
 * 标题行用衬线项目名；中栏整块就是终端面（不再单独悬浮一张卡）。
 * 标签条只用一条发丝线和下划线选中态，没有第二道边框、没有投影。
 */
export default function SessionMain({
  windows,
  accounts,
  active,
  git,
  fontSize,
  fontFamily,
  cursorStyle,
  cursorBlink,
  copyOnSelect,
  ptyOk,
  onSelect,
  onToggleConsole,
  showDiff,
  onToggleDiff,
  onNew,
}: Props) {
  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const running = active ? Date.now() - active.startedAt : 0;

  return (
    <>
      <div className="sh">
        <div className="sh-l">
          <span className="sh-t">{active?.title ?? "会话"}</span>
          {active?.branch ? <span className="sh-br">branch {active.branch}</span> : null}
          <span className="sh-dot" />
          <span className="sh-st">
            {active ? `运行中 · ${fmtDuration(running / 1000)}` : "没有活动会话"}
          </span>
        </div>

        <div className="sh-r">
          <div className="seg sm">
            <button className={showDiff ? "" : "on"} onClick={onToggleConsole}>
              <IconTerminal />
              终端
            </button>
            <button className={showDiff ? "on" : ""} onClick={onToggleDiff} disabled={!git?.branch}>
              <IconCode />
              改动 <em>{git?.changes.length ?? 0}</em>
            </button>
          </div>
          <button className="ib" data-on={false} title="检查器 ⌘B" onClick={onToggleConsole}>
            <IconPanel />
          </button>
        </div>
      </div>

      <div className="tw">
        <div className="tw-bar">
          {windows.map((w) => (
            <button
              key={w.id}
              className={`tw-tab${active?.id === w.id ? " on" : ""}`}
              onClick={() => onSelect(w.id)}
              title={w.cwd}
            >
              <i />
              {w.runsClaude ? "claude" : "zsh"}
            </button>
          ))}
          <button className="tw-add" title="新会话 ⌘T" onClick={onNew}>
            <IconPlus />
          </button>
          {/* 设计稿 685：右侧只放分支 · 配置目录 · 出口 · 路径，都是等宽小字 */}
          <span className="tw-meta">
            {active?.branch ? `${active.branch} · ` : ""}
            {active ? accountById.get(active.accountId)?.configDir : ""}
            {active
              ? ` · ${proxyLabel(accountById.get(active.accountId)?.proxy ?? { protocol: "none", host: "", port: 0 })}`
              : ""}
            {active ? ` · ${shorten(active.cwd)}` : ""}
          </span>
        </div>

        <div className="tw-term">
          {showDiff ? (
            <DiffPane git={git} />
          ) : !ptyOk ? (
            <div className="term-hint">
              <span>浏览器预览模式没有 PTY</span>
              <span>用 npm run app 启动 Electron 才能在 {active?.cwd ?? "目录"} 里起终端</span>
            </div>
          ) : (
            <>
              {windows.map((w) => {
                const acc = accountById.get(w.accountId);
                if (!acc) return null;
                return (
                  <TerminalView
                    key={w.id}
                    win={w}
                    accountId={w.accountId}
                    active={w.id === active?.id}
                    fontSize={fontSize}
                    fontFamily={fontFamily}
                    cursorStyle={cursorStyle}
                    cursorBlink={cursorBlink}
                    copyOnSelect={copyOnSelect}
                  />
                );
              })}
              {windows.length === 0 && (
                <div className="term-hint">
                  <span>还没有会话</span>
                  <span>按 ⌘N 在选定目录里启动 Claude Code</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** 改动视图：真实读到的 git diff 摘要，不伪造内容 */
function shorten(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

function DiffPane({ git }: { git: GitInfo | null }) {
  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "auto",
    padding: "20px 28px",
    fontFamily: "var(--mono)",
    fontSize: 12.5,
    lineHeight: 1.7,
    color: "var(--tfg)",
  };
  if (!git?.branch) {
    return (
      <div style={style}>
        <span style={{ color: "var(--tm)" }}>这个目录不是一个 git 仓库。</span>
      </div>
    );
  }
  return (
    <div style={style}>
      <div style={{ marginBottom: 14, color: "var(--tm)" }}>
        branch {git.branch} · {git.changes.length} 个文件 ·{" "}
        <span style={{ color: "var(--tg)" }}>+{git.totalAdd}</span>{" "}
        <span style={{ color: "var(--red, #c64545)" }}>−{git.totalDel}</span>
      </div>
      {git.changes.length === 0 ? (
        <span style={{ color: "var(--tm)" }}>工作区干净。</span>
      ) : (
        git.changes.map((c) => (
          <div key={c.path} style={{ display: "flex", gap: 12 }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.path}
            </span>
            <span style={{ color: "var(--tg)", width: 44, textAlign: "right" }}>+{c.add}</span>
            <span style={{ color: "var(--tc)", width: 44, textAlign: "right" }}>−{c.del}</span>
          </div>
        ))
      )}
    </div>
  );
}
