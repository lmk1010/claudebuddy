import { useSyncExternalStore } from "react";

/**
 * 插画组件 —— 浅色 / 暗色各一张**带透明的 PNG**。
 *
 * 关键点：插画的纸底是真的透明（从边界连通域抠出来的），
 * 不是"贴着某个底色"。所以它放在横幅、抽屉、主区任何位置
 * 都不会出现矩形接缝 —— 这是之前反复对不上的根因。
 *
 * 暗色版不是把浅色图压暗，而是重绘过：
 *   · 墨线 → 暖白
 *   · 纸白/亮墙 → 比背景亮一档的暖炭（faint face，靠描边勾形）
 *   · 陶土/树/门 → 保色相，亮度落在暗底可辨认区间
 */

type ArtName = "welcome" | "isolation" | "rhythm" | "empty";

/**
 * 用相对路径：打包后页面是 file:// 加载的，
 * 以 / 开头的绝对路径会被解析到磁盘根目录，图片直接 404。
 */
const ART: Record<ArtName, { light: string; dark: string; alt: string }> = {
  welcome: {
    light: "./assets/hero-welcome.png",
    dark: "./assets/hero-welcome-dark.png",
    alt: "一间亮着灯的小屋",
  },
  isolation: {
    light: "./assets/isolation.png",
    dark: "./assets/isolation-dark.png",
    alt: "三间各自独立的小屋",
  },
  rhythm: {
    light: "./assets/rhythm.png",
    dark: "./assets/rhythm-dark.png",
    alt: "一台节拍器",
  },
  empty: {
    light: "./assets/empty-sessions.png",
    dark: "./assets/empty-sessions-dark.png",
    alt: "一块空着的留言板",
  },
};

/* ── 订阅 documentElement 的 data-theme ── */

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      for (const l of listeners) l();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

function isDarkNow(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

export default function Art({
  name,
  className,
  alt,
}: {
  name: ArtName;
  className?: string;
  alt?: string;
}) {
  const dark = useSyncExternalStore(subscribe, isDarkNow, () => false);
  const a = ART[name];
  return (
    <img
      className={className}
      src={dark ? a.dark : a.light}
      alt={alt ?? a.alt}
      draggable={false}
    />
  );
}
