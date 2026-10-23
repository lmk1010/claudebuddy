import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, ShellWindow, View } from "../lib/model";
import {
  IconFile,
  IconGear,
  IconKey,
  IconLayers,
  IconPanel,
  IconPlus,
  IconSearch,
  IconTerminal,
} from "./iconAliases";

interface Item {
  id: string;
  icon: typeof IconTerminal;
  title: string;
  hint?: string;
  keys?: string[];
  run: () => void;
}

interface Props {
  windows: ShellWindow[];
  /** 账号也进搜索结果 —— 切账号是这里最常用的动作之一 */
  accounts: Account[];
  onClose: () => void;
  onOpenWindow: (id: string) => void;
  onNew: () => void;
  onNav: (v: View) => void;
  onTogglePanel: () => void;
  onToggleSidebar: () => void;
  onClone: () => void;
  onSwitchAccount: (id: string) => void;
  onOpenDiff: () => void;
}

/**
 * 命令面板 —— 设计稿 09 · ⌘K。
 *
 * 遮罩只压一层 18% 的墨，不模糊 —— 你要看得见自己在哪个会话里。
 * 命中字加粗，不变色。
 */
export default function CommandPalette({
  windows,
  accounts,
  onClose,
  onOpenWindow,
  onNew,
  onNav,
  onTogglePanel,
  onToggleSidebar,
  onClone,
  onSwitchAccount,
  onOpenDiff,
}: Props) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const w of windows) {
      out.push({
        id: `w-${w.id}`,
        icon: IconTerminal,
        title: `${w.title} · ${w.cwd}`,
        hint: "会话",
        run: () => onOpenWindow(w.id),
      });
    }
    out.push(
      { id: "new", icon: IconPlus, title: "新建会话", keys: ["⌘", "N"], run: onNew },
      { id: "clone", icon: IconLayers, title: "从 Git 克隆", run: onClone },
      { id: "panel", icon: IconPanel, title: "折叠右栏", keys: ["⌘", "B"], run: onTogglePanel },
      { id: "side", icon: IconPanel, title: "折叠侧栏", keys: ["⌘", "\\"], run: onToggleSidebar },
      { id: "diff", icon: IconFile, title: "查看本次改动", keys: ["⌘", "D"], run: onOpenDiff },
      { id: "home", icon: IconTerminal, title: "回到主页", run: () => onNav("home") },
      { id: "acc", icon: IconKey, title: "管理环境", run: () => onNav("accounts") },
      { id: "set", icon: IconGear, title: "打开设置", keys: ["⌘", ","], run: () => onNav("settings") },
    );
    // 账号直接可搜：切环境是最常用的动作
    for (const a of accounts) {
      out.push({
        id: `a-${a.id}`,
        icon: IconKey,
        title: `切到 ${a.label}（~/${a.configDir}）`,
        hint: "环境",
        run: () => onSwitchAccount(a.id),
      });
    }
    return out;
  }, [windows, accounts, onOpenWindow, onNew, onNav, onTogglePanel, onToggleSidebar, onClone, onSwitchAccount, onOpenDiff]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return items;
    return items.filter((i) => i.title.toLowerCase().includes(k));
  }, [items, q]);

  useEffect(() => {
    setCursor(0);
  }, [q]);

  const commit = (i: Item | undefined) => {
    if (!i) return;
    onClose();
    i.run();
  };

  return (
    <>
      <div className="ov" onClick={onClose} />
      <div className="pal" role="dialog" aria-label="命令面板">
        <div className="pal-in">
          <IconSearch size={17} />
          <input
            ref={inputRef}
            value={q}
            placeholder="搜索会话、操作…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(filtered.length - 1, c + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commit(filtered[cursor]);
              }
            }}
          />
          <span className="kbd">esc</span>
        </div>

        <div className="pal-g">
          <div className="gl">
            <span>结果</span>
            <span>{filtered.length}</span>
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px", fontSize: 12.5, color: "var(--t4)" }}>
              没有匹配项
            </div>
          ) : (
            filtered.map((i, idx) => (
              <button
                key={i.id}
                className={`pi${idx === cursor ? " on" : ""}`}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => commit(i)}
              >
                <i.icon />
                <span>{highlight(i.title, q)}</span>
                {i.hint ? <small>{i.hint}</small> : null}
                {i.keys ? (
                  <span className="k">
                    {i.keys.map((k) => (
                      <span className="kbd" key={k}>
                        {k}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="pal-f">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span>选择
          </span>
          <span>
            <span className="kbd">↵</span>打开
          </span>
        </div>
      </div>
    </>
  );
}

/** 命中字加粗，颜色保持墨色 */
function highlight(text: string, q: string) {
  const k = q.trim();
  if (!k) return text;
  const idx = text.toLowerCase().indexOf(k.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <em>{text.slice(idx, idx + k.length)}</em>
      {text.slice(idx + k.length)}
    </>
  );
}
