import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { tr } from "../lib/i18n";

/**
 * 弹窗外壳 —— 遮罩盖住整扇窗（包括侧栏），进出都有动画。
 *
 * 之前遮罩挂在主区里，侧栏还亮着能点，看起来像"弹窗只盖了一半"；
 * 关闭也是瞬间消失，跟打开时的放大淡入对不上。这里统一：
 *   · 遮罩 position: fixed，整窗压暗
 *   · 关闭先播退场（淡出 + 微缩），播完才真正卸载
 *   · 叠了多层时，Esc 只关最上面那一层
 */
const stack: number[] = [];
let seq = 0;

/** 退场动画时长，跟 CSS 里 .mask.out 的动画保持一致 */
const EXIT_MS = 150;

export function useExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const doneRef = useRef(false);
  const close = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setClosing(true);
    setTimeout(onClose, EXIT_MS);
  }, [onClose]);
  return { closing, close };
}

export default function Modal({
  onClose,
  className = "",
  label,
  onEnter,
  children,
}: {
  onClose: () => void;
  className?: string;
  label: string;
  /** 回车时触发（确认框用）；输入框里的回车不算 */
  onEnter?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const { closing, close } = useExit(onClose);
  const idRef = useRef(0);

  useEffect(() => {
    const id = ++seq;
    idRef.current = id;
    stack.push(id);
    return () => {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== idRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Enter" && onEnter && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onEnter();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, onEnter]);

  return (
    <div className={`mask${closing ? " out" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`dlg ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        {children(close)}
      </div>
    </div>
  );
}

/** 二次确认：只问一件事，回车确认、Esc 取消 */
export function ConfirmDialog({
  title,
  body,
  okLabel,
  danger = true,
  onOk,
  onClose,
}: {
  title: string;
  body: ReactNode;
  okLabel: string;
  danger?: boolean;
  onOk: () => void;
  onClose: () => void;
}) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
  }, []);
  return (
    <Modal onClose={onClose} className="confirm" label={title} onEnter={() => okRef.current?.click()}>
      {(close) => (
        <>
          <b>{title}</b>
          <p>{body}</p>
          <div className="confirm-acts">
            <button className="btn ghost" onClick={close}>
              {tr("取消", "Cancel")}
            </button>
            <button
              ref={okRef}
              className={`btn ${danger ? "danger" : "pri"}`}
              onClick={() => {
                onOk();
                close();
              }}
            >
              {okLabel}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
