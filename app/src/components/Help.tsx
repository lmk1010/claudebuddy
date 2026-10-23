import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 「这是什么？」小问号 —— 悬停或点击弹出一张说明卡。
 *
 * 新手卡住的地方往往不是按钮在哪，而是"这个按钮是干嘛的、我该不该点"。
 * 每个需要判断的控件旁边放一个，说清三件事：是什么、什么时候用、不用会怎样。
 * 卡片挂在 body 上，弹窗里的 overflow 裁不到它。
 */
export default function Help({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current || !card.current) return;
    const b = btn.current.getBoundingClientRect();
    const c = card.current.getBoundingClientRect();
    let left = b.left + b.width / 2 - c.width / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - c.width - 10));
    let top = b.bottom + 8;
    if (top + c.height > window.innerHeight - 10) top = b.top - c.height - 8;
    setPos({ left, top });
  }, [open]);

  const show = open || pinned;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`help${show ? " on" : ""}`}
        aria-label={`说明：${title}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => !v);
          setOpen(true);
        }}
      >
        ?
      </button>
      {show &&
        createPortal(
          <>
            {pinned && (
              <div
                className="help-back"
                onMouseDown={() => {
                  setPinned(false);
                  setOpen(false);
                }}
              />
            )}
            <div
              ref={card}
              className={`help-card${wide ? " wide" : ""}`}
              role="tooltip"
              style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
            >
              <b>{title}</b>
              <div className="help-body">{children}</div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/** 说明卡里的分步列表 */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="help-steps">
      {items.map((it, i) => (
        <li key={i}>
          <span>{i + 1}</span>
          <div>{it}</div>
        </li>
      ))}
    </ol>
  );
}
