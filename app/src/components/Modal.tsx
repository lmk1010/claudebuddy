import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tr } from "../lib/i18n";

/**
 * 弹窗外壳 —— 遮罩盖住整扇窗（包括侧栏），进出都有动画。
 *
 * 之前遮罩挂在主区里，侧栏还亮着能点，看起来像"弹窗只盖了一半"；
 * 关闭也是瞬间消失，跟打开时的放大淡入对不上。这里统一：
 *   · 遮罩 position: fixed，整窗压暗
 *   · 关闭先播退场（淡出 + 微缩），播完才真正卸载
 *   · 叠了多层时，Esc 只关最上面那一层
 *
 * 渲染到 body 下、层级按叠放顺序递增：
 * 在弹窗里再开弹窗（环境抽屉 → 连接监控）时，如果两者都写死 z-index: 60，
 * 第二层那层半透明遮罩是压不住第一层的 —— 用户会同时看见两个关闭按钮，
 * 还会误点到底下那个。
 */
const stack: number[] = [];
let seq = 0;

/** 第一层弹窗的层级；每多一层加 2（遮罩与对话框各占一级） */
const BASE_Z = 60;

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
  /**
   * 层级在首次渲染时就定下来：此刻 stack 里还没有自己，
   * 所以第一层拿 60、第二层 62。之后 stack 变了也不需要重排 ——
   * 弹窗一旦打开，它相对其他层的先后就不该再跳。
   */
  const [z] = useState(() => BASE_Z + stack.length * 2);

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

  return createPortal(
    <div
      className={`mask${closing ? " out" : ""}`}
      style={{ zIndex: z }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className={`dlg ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        {children(close)}
      </div>
    </div>,
    document.body,
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
