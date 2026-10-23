import { useEffect, useRef, useState } from "react";
import type { Account, AccountStatusSnapshot, ShellWindow, View } from "../lib/model";
import { AUTH_LABEL, shortTime } from "../lib/model";
import {
  IconChevronDown,
  IconClose,
  IconGear,
  IconKey,
  IconPanel,
  IconPlus,
  IconTerminal,
} from "./iconAliases";

interface Props {
  windows: ShellWindow[];
  accounts: Account[];
  activeId: string | null;
  activeAccount: Account | null;
  /** 实时登录态 —— 底部显示真实状态，不显示缓存 */
  accountStatus: Record<string, AccountStatusSnapshot>;
  view: View;
  username: string;
  onSelectWindow: (id: string) => void;
  onCloseWindow: (id: string) => void;
  onNew: (anchor: HTMLElement) => void;
  onNav: (view: View) => void;
  onAccount: (anchor: HTMLElement) => void;
  onToggleSidebar: () => void;
}

/**
 * 侧栏 —— 设计稿的 .ws。
 *
 * 结构固定：红绿灯让位 → 新建会话 → 三个导航（会话 / 账号 / 设置）
 * → 「最近」列表 → 底部账号。列表行 32px，行间不画线。
 */
export default function Sidebar({
  windows,
  accounts,
  activeId,
  activeAccount,
  accountStatus,
  view,
  username,
  onSelectWindow,
  onCloseWindow,
  onNew,
  onNav,
  onAccount,
  onToggleSidebar,
}: Props) {
  const [width, setWidth] = useState(264);
  const dragRef = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setWidth(Math.min(380, Math.max(220, d.w + (e.clientX - d.x))));
    };
    const up = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const sessions = [...windows].sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  const nav: { icon: typeof IconTerminal; label: string; view: View; count?: string }[] = [
    { icon: IconTerminal, label: "会话", view: "session", count: sessions.length ? String(sessions.length) : "" },
    { icon: IconKey, label: "账号", view: "accounts", count: accounts.length ? String(accounts.length) : "" },
    { icon: IconGear, label: "设置", view: "settings" },
  ];

  return (
    <aside className="ws" style={{ width }}>
      <div
        className="ws-resize"
        onMouseDown={(e) => {
          dragRef.current = { x: e.clientX, w: width };
          document.body.style.cursor = "col-resize";
        }}
      />

      {/* 设计稿 168：红绿灯让位条 —— 24 高、左右 6 内距、下 14 间隔 */}
      <div className="lights">
        <span className="sp">
          <button className="ib" title="收起侧栏 ⌘\" onClick={onToggleSidebar}>
            <IconPanel />
          </button>
        </span>
      </div>

      <button className="new" onClick={(e) => onNew(e.currentTarget)}>
        <IconPlus />
        新建会话
        <span className="kbd">⌘N</span>
      </button>

      {nav.map((n) => (
        <button
          key={n.view}
          className={`nv${view === n.view ? " on" : ""}`}
          onClick={() => onNav(n.view)}
        >
          <n.icon />
          {n.label}
          <span className="c">{n.count}</span>
        </button>
      ))}

      <div className="gl">
        <span>最近</span>
        <span>{sessions.length > 0 ? sessions.length : ""}</span>
      </div>

      <div className="ws-list">
        {sessions.length === 0 ? (
          <div className="rw rw-empty">还没有会话</div>
        ) : (
          sessions.map((w) => {
            const live = w.id === activeId && view === "session";
            return (
              <button
                key={w.id}
                className={`rw${live ? " on" : ""}`}
                onClick={() => onSelectWindow(w.id)}
              >
                <span className={`dt${live ? " live" : ""}`} />
                <span className="nm">{w.title}</span>
                <span
                  className="ws-x"
                  title="关闭会话"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseWindow(w.id);
                  }}
                >
                  <IconClose size={11} />
                </span>
                <span className="tm">{shortTime(w.lastActivityAt)}</span>
              </button>
            );
          })
        )}
      </div>

      <button className="me" onClick={(e) => onAccount(e.currentTarget)}>
        <span className="av" style={activeAccount ? { background: activeAccount.tint } : undefined}>
          {(activeAccount?.label || username || "M").slice(0, 1)}
        </span>
        <span className="who">
          <b>{activeAccount?.label ?? username ?? "本机用户"}</b>
          {/* 真实登录态 + 配置目录，一眼能看出现在是哪间屋子 */}
          <small>
            {activeAccount
              ? `~/${activeAccount.configDir} · ${AUTH_LABEL[accountStatus[activeAccount.id]?.auth ?? activeAccount.auth]}`
              : "—"}
          </small>
        </span>
        {/* 这里原本是齿轮，但它点开的是「切换账号」。
            图标跟行为对不上，人会以为这是设置入口 —— 换成上下双箭头表示切换。
            设置本身有侧栏导航项和右上角两处入口，不缺这一个。 */}
        <span className="g">
          <IconChevronDown size={13} />
        </span>
      </button>
    </aside>
  );
}
