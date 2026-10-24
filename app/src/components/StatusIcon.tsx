/**
 * 状态圆标 —— 实心底 + 白色粗线符号。
 *
 * 之前用浅色底 + 细线对号，小尺寸下发虚、像没加载完；实心圆在 16–28px 都清楚，
 * 一眼就能分出 通 / 注意 / 不通，不必读字。
 */
export type StatusTone = "ok" | "mid" | "bad" | "idle" | "info";

export default function StatusIcon({ tone, size = 20, n }: { tone: StatusTone; size?: number; n?: number }) {
  return (
    <span className={`sti ${tone}`} style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {tone === "ok" && <path d="M2.6 6.3 5 8.6l4.4-5" />}
        {tone === "mid" && (
          <>
            <path d="M6 2.6v4.1" />
            <path d="M6 9.2v.1" />
          </>
        )}
        {tone === "bad" && <path d="M3.3 3.3l5.4 5.4M8.7 3.3 3.3 8.7" />}
        {tone === "info" && (
          <>
            <path d="M6 5.4v3.8" />
            <path d="M6 2.8v.1" />
          </>
        )}
        {tone === "idle" && (
          <text x="6" y="8.6" textAnchor="middle" fontSize="7.5" fill="currentColor" stroke="none" fontWeight="600">
            {n ?? "·"}
          </text>
        )}
      </svg>
    </span>
  );
}
