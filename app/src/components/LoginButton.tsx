import { useEffect, useState } from "react";
import type { Account } from "../lib/model";
import type { BrowserOption } from "../lib/bridge";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { IconChevronDown, IconKey } from "./iconAliases";
import { tr } from "../lib/i18n";

/** 浏览器列表整个应用只探测一次 */
let cached: Promise<BrowserOption[]> | null = null;
export function loadBrowsers(): Promise<BrowserOption[]> {
  if (!cached) cached = window.claudeBuddy.browsersList().catch(() => []);
  return cached;
}

export function browserLabel(list: BrowserOption[], id: string | undefined): string {
  return list.find((b) => b.id === (id ?? "system"))?.label ?? tr("系统默认浏览器", "System default browser");
}

/**
 * 登录按钮 + 选浏览器。
 *
 * 主按钮直接用这个环境上次选的浏览器登录，不再每次弹窗问；
 * 右边 ▾ 换浏览器 / 用户资料 / 无痕，选了就立刻用它登录，并记住。
 */
export default function LoginButton({
  account,
  busy,
  waiting,
  primary = true,
  label = tr("登录", "Sign in"),
  onLogin,
}: {
  account: Account;
  busy?: boolean;
  /** 已在等待授权 */
  waiting?: boolean;
  primary?: boolean;
  label?: string;
  onLogin: (browser: string) => void;
}) {
  const [list, setList] = useState<BrowserOption[]>([]);
  const menu = useContextMenu();
  useEffect(() => {
    void loadBrowsers().then(setList);
  }, []);

  const cur = account.loginBrowser ?? "system";
  const curLabel = browserLabel(list, cur);

  const openMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const items: MenuItem[] = [];
    let lastGroup = "";
    for (const b of list) {
      if (lastGroup && b.group !== lastGroup) items.push("sep");
      lastGroup = b.group;
      items.push({
        label: b.label,
        hint: b.id === cur ? "✓" : b.sub || undefined,
        run: () => onLogin(b.id),
      });
    }
    // 配了独立代理的环境：外部浏览器走的是它自己的网络，说一声
    if (account.proxy.protocol !== "none") {
      items.push("sep", { label: tr("网页走浏览器自己的网络，不走这个环境的代理", "The page uses the browser's own network, not this environment's proxy"), disabled: true, run: () => {} });
    }
    // 菜单右缘对齐 ▾ 按钮（按钮多在行尾，从左缘展开会顶出屏幕）
    menu.open({ clientX: r.right - 280, clientY: r.bottom + 6, preventDefault: () => {}, stopPropagation: () => {} }, items, tr("用哪个浏览器授权", "Browser for authorization"));
  };

  return (
    <span className="lgb">
      <button
        className={`btn${primary ? " pri" : ""} lgb-main`}
        onClick={() => onLogin(cur)}
        disabled={busy || waiting}
        title={tr(`用「${curLabel}」打开授权页`, `Open the authorization page in ${curLabel}`)}
      >
        <IconKey />
        {busy ? tr("启动中…", "Starting…") : waiting ? tr("等待授权…", "Waiting for approval…") : label}
      </button>
      <button
        className={`btn${primary ? " pri" : ""} lgb-more`}
        onClick={(e) => openMenu(e.currentTarget)}
        disabled={busy || waiting}
        title={tr(`现在用：${curLabel} · 点这里换浏览器`, `Using ${curLabel} · click to switch browser`)}
        aria-label={tr("选择浏览器", "Choose browser")}
      >
        <IconChevronDown size={12} />
      </button>
      {menu.node}
    </span>
  );
}
