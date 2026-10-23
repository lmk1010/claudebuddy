/** 就地改名的输入框：回车/失焦保存，Esc 放弃。会话行、侧栏、页签共用 */
export function RenameInput({
  value,
  onDone,
  className = "rn-in",
}: {
  value: string;
  onDone: (next: string | null) => void;
  className?: string;
}) {
  return (
    <input
      className={className}
      autoFocus
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        onDone(v && v !== value ? v : null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** 铅笔图标（图标库里没有，补一个同线宽的） */
export function IconEdit({ size = 14 }: { size?: number }) {
  return (
    <svg className="i" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
      <path d="M9 4l3 3" />
    </svg>
  );
}
