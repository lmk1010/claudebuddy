import { useMemo, useState, type CSSProperties } from "react";
import ContextMenu from "./ContextMenu";
import { IconEdit } from "./Rename";
import type { Account, GitInfo, ShellWindow } from "../lib/model";
import { fmtDuration, proxyLabel } from "../lib/model";
import TerminalView from "./TerminalView";
import { NetScore } from "./NetReport";
import {
  IconClose,
  IconCode,
  IconCopy,
  IconFolder,
  IconGlobe,
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
  /** 右栏开关。之前这个按钮错绑到了 onToggleConsole，点了只会切终端/改动 */
  onTogglePanel: () => void;
  panelOpen: boolean;
  /** 关闭会话请求。交给上层弹二次确认，不直接关 */
  onRequestClose: (id: string) => void;
  /** 关掉除它以外的所有会话（同样走二次确认） */
  onRequestCloseOthers: (id: string) => void;
  onRename: (id: string, title: string) => void;
  /** 打开某个环境的「网络出口」 */
  onEditNetwork: (id: string) => void;
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
  onTogglePanel,
  panelOpen,
  onRequestClose,
  onRequestCloseOthers,
  onRename,
  onEditNetwork,
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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null);

  return (
    <>
      <div className="sh">
        <div className="sh-l">
          <span className="sh-t">{active?.title ?? "会话"}</span>
          {active && accountById.get(active.accountId) && (
            <span className="sh-env" title={`~/${accountById.get(active.accountId)!.configDir}`}>
              <span className="tw-tab-av" style={{ background: accountById.get(active.accountId)!.tint }}>
                {accountById.get(active.accountId)!.label.slice(0, 1)}
              </span>
              {accountById.get(active.accountId)!.label}
            </span>
          )}
          {/* 当前环境的出口和信任分：会话里最该一眼看到的就是「我现在从哪出去、干不干净」 */}
          {active && accountById.get(active.accountId) && (
            <button
              className="sh-net"
              onClick={() => onEditNetwork(active.accountId)}
              title="这个环境的网络出口 · 点开看体检"
            >
              <IconGlobe size={12} />
              <span className="mono">{proxyLabel(accountById.get(active.accountId)!.proxy)}</span>
              <NetScore accountId={active.accountId} proxyKey={proxyLabel(accountById.get(active.accountId)!.proxy)} />
            </button>
          )}
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
          <button
            className={`ib${panelOpen ? " on" : ""}`}
            title={panelOpen ? "收起右栏 ⌘B" : "展开右栏 ⌘B"}
            onClick={onTogglePanel}
          >
            <IconPanel />
          </button>
        </div>
      </div>

      <div className="tw">
        <div className="tw-bar">
          <div className="tw-tabs">
            {windows.map((w) => {
              const acc = accountById.get(w.accountId);
              return (
                <div
                  key={w.id}
                  role="tab"
                  aria-selected={active?.id === w.id}
                  tabIndex={0}
                  className={`tw-tab${active?.id === w.id ? " on" : ""}`}
                  onClick={() => onSelect(w.id)}
                  onDoubleClick={() => setRenaming(w.id)}
                  onAuxClick={(e) => {
                    // 中键关闭，浏览器页签的老习惯
                    if (e.button === 1) onRequestClose(w.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtx({ id: w.id, x: e.clientX, y: e.clientY });
                  }}
                  title={`${w.title} · ${acc?.label ?? ""}\n${w.cwd}\n双击重命名 · 右键更多`}
                >
                  <span className="tw-tab-av" style={{ background: acc?.tint }}>
                    {acc?.label.slice(0, 1)}
                  </span>
                  {renaming === w.id ? (
                    <input
                      className="tw-tab-in"
                      autoFocus
                      defaultValue={w.title}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim();
                        if (v && v !== w.title) onRename(w.id, v);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          e.currentTarget.value = w.title;
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <span className="tw-tab-t">{w.title}</span>
                  )}
                  {!w.runsClaude && <span className="tw-tab-k">zsh</span>}
                  {/* 页签自己的关闭入口：hover 或当前页签才露出来，免得一排叉号把标签挤碎 */}
                  <button
                    className="tw-tab-x"
                    title="关闭会话 ⌘W"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestClose(w.id);
                    }}
                  >
                    <IconClose size={10} />
                  </button>
                </div>
              );
            })}
            <button className="tw-add" title="新会话 ⌘T" onClick={onNew}>
              <IconPlus />
            </button>
          </div>
          {/* 设计稿 685：右侧只放分支 · 配置目录 · 出口 · 路径，都是等宽小字 */}
          <span className="tw-meta">
            {active?.branch ? `${active.branch} · ` : ""}
            {active ? accountById.get(active.accountId)?.configDir : ""}
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

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          title={windows.find((x) => x.id === ctx.id)?.title}
          onClose={() => setCtx(null)}
          items={[
            { label: "重命名", icon: <IconEdit />, hint: "双击", run: () => setRenaming(ctx.id) },
            {
              label: "复制目录路径",
              icon: <IconCopy size={14} />,
              run: () => {
                const w = windows.find((x) => x.id === ctx.id);
                if (w) void navigator.clipboard.writeText(w.cwd).catch(() => {});
              },
            },
            {
              label: "在访达中打开",
              icon: <IconFolder size={14} />,
              run: () => {
                const w = windows.find((x) => x.id === ctx.id);
                if (w) void window.claudeBuddy.reveal(w.cwd);
              },
            },
            "sep",
            { label: "关闭", icon: <IconClose size={14} />, hint: "⌘W", danger: true, run: () => onRequestClose(ctx.id) },
            {
              label: "关闭其他会话",
              danger: true,
              disabled: windows.length < 2,
              run: () => onRequestCloseOthers(ctx.id),
            },
          ]}
        />
      )}
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
