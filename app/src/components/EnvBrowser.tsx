import { useEffect, useState } from "react";
import type { Account } from "../lib/model";
import type { BrowserOption } from "../lib/bridge";
import { browserLabel, loadBrowsers } from "./LoginButton";
import { IconCheck, IconKey } from "./iconAliases";
import { tr } from "../lib/i18n";

/**
 * 浏览器授权信息。
 *
 * 为什么要单独一页：授权页是在外部浏览器里打开的，用哪个浏览器决定
 * 那次登录落到哪个身份上 —— 系统默认、Chrome 的某个用户资料、
 * 还是无痕窗口，完全是三件事。以前只能在登录按钮旁边的 ▾ 里选一次，
 * 想确认"这个环境到底用哪个浏览器授权"没地方看。
 *
 * 这里做的就一件事：把当前的选择摆出来、允许改，并且改了就存下来。
 * 存下来之后，不管从哪儿点登录或授权，默认都走这一个。
 */

const GROUP_LABEL: Record<string, string> = {
  get default() {
    return tr("系统默认", "System default");
  },
  get browser() {
    return tr("已安装的浏览器", "Installed browsers");
  },
  get private() {
    return tr("隔离更好的选择", "Better isolation");
  },
  get copy() {
    return tr("其他方式", "Other");
  },
};

export default function BrowserSection({
  account,
  onPatch,
  onLogin,
}: {
  account: Account;
  onPatch: (patch: Partial<Account>) => void;
  onLogin: (browser: string) => void;
}) {
  const [list, setList] = useState<BrowserOption[]>([]);
  useEffect(() => {
    void loadBrowsers().then(setList);
  }, []);

  const cur = account.loginBrowser ?? "system";
  const curLabel = browserLabel(list, cur);

  /** 按 group 分段，保持后端给的顺序 */
  const groups: { key: string; items: BrowserOption[] }[] = [];
  for (const b of list) {
    const last = groups[groups.length - 1];
    if (last && last.key === b.group) last.items.push(b);
    else groups.push({ key: b.group, items: [b] });
  }

  return (
    <>
      <div className="bs-now">
        <span className="bs-now-k">{tr("现在用", "Currently")}</span>
        <b>{curLabel}</b>
        <span className="rk-sp" />
        <button className="btn pri" onClick={() => onLogin(cur)}>
          <IconKey size={13} />
          {tr("用它授权", "Authorize with it")}
        </button>
      </div>

      <div className="bs-groups">
        {groups.map((g) => (
          <div key={g.key} className="bs-group">
            <div className="bs-gt">{GROUP_LABEL[g.key] ?? g.key}</div>
            {g.items.map((b) => {
              const on = b.id === cur;
              return (
                <button
                  key={b.id}
                  className={`bs-i${on ? " on" : ""}`}
                  onClick={() => onPatch({ loginBrowser: b.id })}
                  title={on ? tr("已经是这个", "Already selected") : tr("改用它，并记住", "Switch to it and remember")}
                >
                  <span className="bs-mark">{on ? <IconCheck size={12} /> : null}</span>
                  <span className="bs-t">
                    <b>{b.label}</b>
                    {b.sub ? <small>{b.sub}</small> : null}
                  </span>
                  <span className="bs-id mono">{b.id}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="bs-note">
        {tr(
          "选完就存下来，之后点登录或授权都默认用它。",
          "Your choice is saved; sign-in and authorization will use it from now on.",
        )}
        {account.proxy.protocol !== "none"
          ? tr(
              " 注意：授权页在外部浏览器里打开，走的是浏览器自己的网络，不经过这个环境的代理。",
              " Note: the page opens in that browser and uses its own network, not this environment's proxy.",
            )
          : ""}
      </p>
    </>
  );
}