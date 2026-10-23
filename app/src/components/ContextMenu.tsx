import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      hint?: string;
      disabled?: boolean;
      danger?: boolean;
      run: () => void;
    }
  | "sep";

/**
 * 右键 / 更多菜单 —— 贴着鼠标开，靠窗口边时往回收。
 * 页签、会话行、环境行、侧栏会话共用这一个，样式和按键行为一致。
 */
export default function ContextMenu({
  x,
  y,
  items,
  title,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  title?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <>
      <div
        className="pop-backdrop"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="pop cmenu"
        ref={ref}
        role="menu"
        style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: "hidden" }}
      >
        {title && <div className="pop-hint">{title}</div>}
        {items.map((it, i) =>
          it === "sep" ? (
            <div key={`sep-${i}`} className="pop-sep" />
          ) : (
            <button
              key={`${it.label}-${i}`}
              className={`pi${it.danger ? " danger" : ""}`}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                onClose();
                it.run();
              }}
            >
              {it.icon}
              <span className="pi-main">{it.label}</span>
              {it.hint && <small>{it.hint}</small>}
            </button>
          ),
        )}
      </div>
    </>,
    document.body,
  );
}

/** 用法：const [menu, open, close] = useContextMenu(); onContextMenu={(e) => open(e, items)} */
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; title?: string } | null>(null);
  const open = (e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: MenuItem[], title?: string) => {
    e.preventDefault();
    e.stopPropagation?.();
    setMenu({ x: e.clientX, y: e.clientY, items, title });
  };
  const node = menu ? (
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} title={menu.title} onClose={() => setMenu(null)} />
  ) : null;
  return { open, node };
}
