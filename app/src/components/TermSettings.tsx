import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { BuddyState } from "../lib/model";
import { TERM_FONTS, TERM_THEMES, resolveTermTheme } from "../lib/termThemes";

type Patch = Partial<
  Pick<BuddyState, "terminalTheme" | "terminalFontFamily" | "terminalFontSize" | "terminalLineHeight" | "terminalPadding" | "cursorStyle">
>;

/**
 * 终端外观面板 —— 从会话顶栏的「Aa」打开，贴右侧浮出。
 *
 * 改动立刻作用到所有终端，不用点保存；主题直接看缩略图挑，不靠记名字。
 */
export default function TermSettings({
  state,
  anchor,
  onChange,
  onClose,
}: {
  state: BuddyState;
  anchor: DOMRect;
  onChange: (p: Patch) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 点面板外面、按 Esc 都关
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    setTimeout(() => window.addEventListener("mousedown", down), 0);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  const cur = state.terminalTheme ?? "auto";
  const size = state.terminalFontSize;
  const lh = state.terminalLineHeight ?? 1.6;
  const pad = state.terminalPadding ?? "normal";

  const themes = [{ id: "auto", name: "跟随应用" }, ...TERM_THEMES];

  return createPortal(
    <div
      ref={ref}
      className="tset"
      style={{ top: anchor.bottom + 8, right: Math.max(12, window.innerWidth - anchor.right) }}
      role="dialog"
      aria-label="终端外观"
    >
      <div className="tset-sec">
        <div className="tset-row">
          <span>字号</span>
          <span className="tset-step">
            <button onClick={() => onChange({ terminalFontSize: Math.max(10, size - 1) })} aria-label="减小">
              −
            </button>
            <b>{size}</b>
            <button onClick={() => onChange({ terminalFontSize: Math.min(22, size + 1) })} aria-label="增大">
              +
            </button>
          </span>
        </div>
        <div className="tset-row">
          <span>行高</span>
          <Seg
            value={lh}
            opts={[
              [1.3, "紧凑"],
              [1.6, "标准"],
              [1.9, "宽松"],
            ]}
            onPick={(v) => onChange({ terminalLineHeight: v })}
          />
        </div>
        <div className="tset-row">
          <span>边距</span>
          <Seg
            value={pad}
            opts={[
              ["compact", "窄"],
              ["normal", "标准"],
              ["wide", "宽"],
            ]}
            onPick={(v) => onChange({ terminalPadding: v as "compact" | "normal" | "wide" })}
          />
        </div>
        <div className="tset-row">
          <span>光标</span>
          <Seg
            value={state.cursorStyle}
            opts={[
              ["bar", "竖线"],
              ["block", "方块"],
              ["underline", "下划线"],
            ]}
            onPick={(v) => onChange({ cursorStyle: v as BuddyState["cursorStyle"] })}
          />
        </div>
      </div>

      <div className="tset-h">字体</div>
      <div className="tset-fonts">
        {TERM_FONTS.map((f) => (
          <button
            key={f}
            className={state.terminalFontFamily === f ? "on" : ""}
            style={{ fontFamily: `"${f}", ui-monospace, monospace` }}
            onClick={() => onChange({ terminalFontFamily: f })}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="tset-h">配色</div>
      <div className="tset-themes">
        {themes.map((t) => {
          const th = resolveTermTheme(t.id);
          return (
            <button key={t.id} className={`tset-th${cur === t.id ? " on" : ""}`} onClick={() => onChange({ terminalTheme: t.id })}>
              {/* 缩略图：用这套配色真实的底色、前景、绿 / 蓝 / 光标色排几行「代码」 */}
              <span className="tset-pv" style={{ background: th.background }}>
                <i style={{ background: th.foreground, width: "62%" }} />
                <i style={{ background: th.brightBlack, width: "84%", opacity: 0.7 }} />
                <span>
                  <i style={{ background: th.green, width: 18 }} />
                  <i style={{ background: th.blue, width: 26 }} />
                  <i style={{ background: th.yellow, width: 12 }} />
                  <i className="cur" style={{ background: th.cursor }} />
                </span>
              </span>
              <span className="tset-nm">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

function Seg<T extends string | number>({ value, opts, onPick }: { value: T; opts: [T, string][]; onPick: (v: T) => void }) {
  return (
    <span className="seg sm">
      {opts.map(([v, l]) => (
        <button key={String(v)} className={value === v ? "on" : ""} onClick={() => onPick(v)}>
          {l}
        </button>
      ))}
    </span>
  );
}
