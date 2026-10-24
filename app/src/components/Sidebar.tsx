import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Account, AccountStatusSnapshot, ShellWindow, View } from "../lib/model";
import { AUTH_LABEL, shortTime } from "../lib/model";
import {
  IconAlert,
  IconChevronDown,
  IconClose,
  IconCopy,
  IconFolder,
  IconGlobe,
  IconKey,
  IconPanel,
  IconPlus,
  IconSparkle,
  IconTerminal,
} from "./iconAliases";
import { useContextMenu } from "./ContextMenu";
import { IconEdit, RenameInput } from "./Rename";
import { SETTINGS_GROUPS, type SettingsCat } from "./Settings";
import { tr } from "../lib/i18n";

interface Props {
  /** 是否展开。收起时不卸载，只把宽度收到 0 —— 这样能过渡 */
  open: boolean;
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
  onNew: () => void;
  onNav: (view: View) => void;
  onAccount: (anchor: HTMLElement) => void;
  /** 底部环境菜单是否开着 —— 开着时这一行保持按下态 */
  accountMenuOpen: boolean;
  onToggleSidebar: () => void;
  onRename: (id: string, title: string) => void;
  onCopy: (text: string) => void;
  onReveal: (path: string) => void;
  /** 设置模式：整条侧栏换成设置分类（跟 Claude Desktop 一样），顶上一个「返回」 */
  settingsCat: SettingsCat;
  onSettingsCat: (c: SettingsCat) => void;
  onExitSettings: () => void;
}

/**
 * 侧栏 —— 设计稿的 .ws。
 *
 * 结构固定：红绿灯让位 → 新建会话 → 三个导航（会话 / 环境 / 设置）
 * → 「最近」列表 → 底部账号。列表行 32px，行间不画线。
 */
export default function Sidebar({
  open,
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
  accountMenuOpen,
  onToggleSidebar,
  onRename,
  onCopy,
  onReveal,
  settingsCat,
  onSettingsCat,
  onExitSettings,
}: Props) {
  const [width, setWidth] = useState(264);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menu = useContextMenu();
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

  const accById = new Map(accounts.map((a) => [a.id, a]));

  const nav: { icon: typeof IconTerminal; label: string; view: View; count?: string }[] = [
    { icon: IconSparkle, label: tr("首页", "Home"), view: "home" },
    { icon: IconTerminal, label: tr("会话", "Sessions"), view: "sessions", count: sessions.length ? String(sessions.length) : "" },
    { icon: IconKey, label: tr("环境", "Environments"), view: "accounts", count: accounts.length ? String(accounts.length) : "" },
    // 设置不占主导航（左下角账号菜单、⌘, 都能进）；这里放更常用的「网络」
    { icon: IconGlobe, label: tr("网络", "Network"), view: "network" },
    { icon: IconAlert, label: tr("健康检查", "Health check"), view: "health" },
  ];

  return (
    <aside
      className={`ws${open ? "" : " shut"}`}
      style={{ "--w": `${width}px` } as CSSProperties}
    >
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
          <button className="ib" title={tr("收起侧栏 ⌘\\", "Hide sidebar ⌘\\")} onClick={onToggleSidebar}>
            <IconPanel />
          </button>
        </span>
      </div>

      {view === "settings" ? (
        <div className="ws-set" key="set">
          <button className="ws-back" onClick={onExitSettings} title={tr("返回应用（Esc / ⌘,）", "Back to app (Esc / ⌘,)")}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
            {tr("返回应用", "Back to app")}
            <span className="kbd">esc</span>
          </button>
          <div className="ws-set-t">{tr("设置", "Settings")}</div>
          {SETTINGS_GROUPS.map((g) => (
            <div className="ws-set-g" key={g.title}>
              <div className="gl">
                <span>{g.title}</span>
              </div>
              {g.items.map((c) => (
                <button key={c.id} className={`nv${settingsCat === c.id ? " on" : ""}`} onClick={() => onSettingsCat(c.id)}>
                  <c.icon />
                  {c.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <>
      {/* 直接建在当前环境里 —— 环境在主界面顶部、或底部那一行切 */}
      <button
        className="new"
        onClick={onNew}
        title={activeAccount ? tr(`在「${activeAccount.label}」里新建会话`, `New session in “${activeAccount.label}”`) : tr("新建会话", "New session")}
      >
        <IconPlus />
        {tr("新建会话", "New session")}
        <span className="kbd">⌘N</span>
      </button>

      {nav.map((n) => (
        <button
          key={n.view}
          /* 「会话」要在总览和终端里都保持高亮 —— 终端属于会话，
             进了终端却让会话那一项熄灭，会让人以为自己跑到了别处。 */
          className={`nv${view === n.view || (n.view === "sessions" && view === "session") ? " on" : ""}`}
          onClick={() => onNav(n.view)}
        >
          <n.icon />
          {n.label}
          <span className="c">{n.count}</span>
        </button>
      ))}

      <div className="gl">
        <span>{tr("最近", "Recent")}</span>
        <span>{sessions.length > 0 ? sessions.length : ""}</span>
      </div>

      <div className="ws-list">
        {sessions.length === 0 ? (
          <div className="rw rw-empty">{tr("还没有会话", "No sessions yet")}</div>
        ) : (
          sessions.map((w) => {
            const live = w.id === activeId && view === "session";
            const acc = accById.get(w.accountId);
            return (
              <div
                key={w.id}
                role="button"
                tabIndex={0}
                className={`rw${live ? " on" : ""}`}
                onClick={() => renaming !== w.id && onSelectWindow(w.id)}
                onDoubleClick={() => setRenaming(w.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renaming !== w.id) onSelectWindow(w.id);
                }}
                onContextMenu={(e) =>
                  menu.open(
                    e,
                    [
                      { label: tr("打开", "Open"), icon: <IconTerminal size={14} />, run: () => onSelectWindow(w.id) },
                      { label: tr("重命名", "Rename"), icon: <IconEdit />, hint: tr("双击", "Double-click"), run: () => setRenaming(w.id) },
                      "sep",
                      { label: tr("复制目录路径", "Copy path"), icon: <IconCopy size={14} />, run: () => onCopy(w.cwd) },
                      { label: tr("在访达中打开", "Reveal in Finder"), icon: <IconFolder size={14} />, run: () => onReveal(w.cwd) },
                      "sep",
                      { label: tr("关闭会话", "Close session"), icon: <IconClose size={14} />, danger: true, run: () => onCloseWindow(w.id) },
                    ],
                    `${w.title} · ${acc?.label ?? ""}`,
                  )
                }
                title={tr(`${w.title} · ${acc?.label ?? ""}\n${w.cwd}\n双击重命名 · 右键更多`, `${w.title} · ${acc?.label ?? ""}\n${w.cwd}\nDouble-click to rename · right-click for more`)}
              >
                {/* 环境标记：每个环境一种颜色、一个首字，几个号的会话混在一起也一眼分得开 */}
                <span className={`rw-env${live ? " live" : ""}`} style={{ background: acc?.tint }}>
                  {acc?.label.slice(0, 1)}
                </span>
                {renaming === w.id ? (
                  <RenameInput
                    value={w.title}
                    onDone={(v) => {
                      if (v) onRename(w.id, v);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="nm">{w.title}</span>
                )}
                <span
                  className="ws-x"
                  title={tr("关闭会话", "Close session")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseWindow(w.id);
                  }}
                >
                  <IconClose size={11} />
                </span>
                <span className="tm">{shortTime(w.lastActivityAt)}</span>
              </div>
            );
          })
        )}
      </div>
      {menu.node}

      <button
        className={`me${accountMenuOpen ? " open" : ""}`}
        onClick={(e) => onAccount(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={accountMenuOpen}
        title={tr("切换环境", "Switch environment")}
      >
        <span className="av" style={activeAccount ? { background: activeAccount.tint } : undefined}>
          {(activeAccount?.label || username || "M").slice(0, 1)}
        </span>
        <span className="who">
          <b>{activeAccount?.label ?? username ?? tr("本机用户", "This Mac")}</b>
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
        </>
      )}
    </aside>
  );
}
