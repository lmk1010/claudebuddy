import { useEffect, useState, type ReactNode } from "react";
import { tr } from "../lib/i18n";

/**
 * 使用教程 —— 只讲用户真正会做的三件事：清理 → 重新授权 → 开始用。
 *
 * 每章左边一张「缩小的真实界面」，要点的地方有一圈脉冲；右边三步，每步一句话。
 * 不解释原理、不罗列选项 —— 那些在各页面的「?」里。
 */

export type GuideTarget = "home" | "sessions" | "accounts" | "editNet" | "editLogin" | "clean" | "net" | "keys" | "general";

type Chapter = {
  id: string;
  tab: string;
  title: string;
  sub: string;
  steps: [string, string][];
  note?: string;
  art: ReactNode;
  go: { label: string; to: GuideTarget };
};

/** 函数而不是常量：文案要跟着当前语言走，不能在模块加载时定死 */
function getChapters(): Chapter[] {
  return [
    {
      id: "clean",
      tab: tr("清理环境", "Clean up"),
      title: tr("先把旧痕迹清干净", "Clear out old traces first"),
      sub: tr("换号、或者想从零开始时做一次", "Do this once when switching accounts or starting fresh"),
      steps: [
        [tr("打开清理本机", "Open Clean up this Mac"), tr("设置 → 本机 → 清理本机", "Settings → This Mac → Clean up this Mac")],
        [tr("选「建议清理」", "Choose \"Suggested\""), tr("表头勾选全选", "Tick the header checkbox to select all")],
        [tr("点「清理所选」", "Click \"Clean selected\""), tr("确认框里会写清每一项的后果", "The confirmation dialog spells out what each item does")],
      ],
      note: tr("目录能从回收目录捞回；Keychain 凭据删了不能恢复", "Folders can be recovered from the trash folder; deleted Keychain credentials cannot be restored"),
      art: <ArtClean />,
      go: { label: tr("打开清理本机", "Open Clean up this Mac"), to: "clean" },
    },
    {
      id: "login",
      tab: tr("重新授权", "Sign in again"),
      title: tr("登录你的 Claude 账号", "Sign in to your Claude account"),
      sub: tr("浏览器里点一下授权，回来自动识别", "Authorize in the browser, and the app picks it up automatically"),
      steps: [
        [tr("打开环境", "Open the environment"), tr("左下角账号行 → 编辑", "Account row at the bottom left → Edit")],
        [tr("点「登录」", "Click \"Sign in\""), tr("浏览器弹出，点授权", "The browser opens; click Authorize")],
        [tr("回到应用", "Return to the app"), tr("看到「已登录」就好了", "When it shows \"Signed in\", you're done")],
      ],
      note: tr("不用复制粘贴任何东西", "No copy and paste needed"),
      art: <ArtLogin />,
      go: { label: tr("去登录", "Go sign in"), to: "editLogin" },
    },
    {
      id: "try",
      tab: tr("开始使用", "Get started"),
      title: tr("写一句话，回车", "Type a line, press Enter"),
      sub: tr("会话开在选中的环境和目录里", "The session opens in the selected environment and folder"),
      steps: [
        [tr("选环境", "Pick an environment"), tr("首页顶部点一下", "Click it at the top of the home page")],
        [tr("写第一句话", "Write your first message"), tr("也可以留空，直接回车", "Or leave it empty and press Enter")],
        [tr("看出口徽章", "Check the exit badge"), tr("绿色「纯净」= 线路没问题", "Green \"Clean\" means the route is fine")],
      ],
      art: <ArtTry />,
      go: { label: tr("去首页", "Go to home"), to: "home" },
    },
  ];
}

export default function Guide({ onGo }: { onGo: (to: GuideTarget) => void }) {
  const CHAPTERS = getChapters();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<"next" | "prev">("next");
  const ch = CHAPTERS[i];

  const to = (n: number) => {
    if (n < 0 || n >= CHAPTERS.length || n === i) return;
    setDir(n > i ? "next" : "prev");
    setI(n);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") to(i + 1);
      if (e.key === "ArrowLeft") to(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="gd">
      <div className="gd-tabs" role="tablist">
        {CHAPTERS.map((c, k) => (
          <button key={c.id} role="tab" aria-selected={k === i} className={`gd-tab${k === i ? " on" : ""}`} onClick={() => to(k)}>
            <span className="gd-tab-n">{k + 1}</span>
            {c.tab}
          </button>
        ))}
      </div>

      <article className="gd-card" key={ch.id} data-dir={dir}>
        <div className="gd-art">{ch.art}</div>
        <div className="gd-txt">
          <h2>{ch.title}</h2>
          <p className="gd-sub">{ch.sub}</p>
          <ol className="gd-steps">
            {ch.steps.map(([t, d], k) => (
              <li key={t}>
                <span>{k + 1}</span>
                <div>
                  <b>{t}</b>
                  <small>{d}</small>
                </div>
              </li>
            ))}
          </ol>
          {ch.note && <p className="gd-note">{ch.note}</p>}
          <button className="btn pri gd-go" onClick={() => onGo(ch.go.to)}>
            {ch.go.label}
          </button>
        </div>
      </article>

      <div className="gd-nav">
        <button className="gd-arrow" onClick={() => to(i - 1)} disabled={i === 0} aria-label={tr("上一步", "Previous")}>
          ←
        </button>
        <div className="gd-dots">
          {CHAPTERS.map((c, k) => (
            <button key={c.id} className={k === i ? "on" : ""} onClick={() => to(k)} aria-label={c.tab} />
          ))}
        </div>
        <button className="gd-arrow" onClick={() => to(i + 1)} disabled={i === CHAPTERS.length - 1} aria-label={tr("下一步", "Next")}>
          →
        </button>
      </div>
    </div>
  );
}

/* ── 配图：用真实界面的同款元素画一张缩小版，要点的地方套一圈脉冲 ── */

function Win({ children, side }: { children: ReactNode; side?: ReactNode }) {
  return (
    <div className="ga-win">
      <div className="ga-bar">
        <i />
        <i />
        <i />
      </div>
      <div className="ga-body">
        {side && <div className="ga-side">{side}</div>}
        <div className="ga-main">{children}</div>
      </div>
    </div>
  );
}

function SideNav({ on }: { on: string }) {
  return (
    <>
      {(
        [
          ["home", tr("首页", "Home")],
          ["sessions", tr("会话", "Sessions")],
          ["env", tr("环境", "Environments")],
          ["settings", tr("设置", "Settings")],
        ] as const
      ).map(([id, x]) => (
        <span key={id} className={`ga-nv${id === on ? " on" : ""}`}>
          {x}
        </span>
      ))}
    </>
  );
}

function ArtClean() {
  const rows: [string, string, string, boolean][] = [
    [".claude-old", tr("空壳", "Empty"), "bad", true],
    ["prof_6111", tr("空壳", "Empty"), "bad", true],
    ["me@mail.com", tr("正常", "OK"), "ok", false],
  ];
  return (
    <Win side={<SideNav on="settings" />}>
      <div className="ga-h">
        <b>{tr("清理本机", "Clean up this Mac")}</b>
        <span className="ga-btn danger ga-pulse">{tr("清理所选 2 项", "Clean 2 selected")}</span>
      </div>
      <div className="ga-seg">
        <span>{tr("全部", "All")}</span>
        <span className="on">{tr("建议清理", "Suggested")}</span>
        <span>{tr("正常", "OK")}</span>
      </div>
      <div className="ga-table">
        {rows.map(([n, t, tone, on]) => (
          <div key={n} className={`ga-tr${on ? " on" : ""}`}>
            <i className={`ga-ck${on ? " on" : ""}`} />
            <span className="ga-n">{n}</span>
            <span className={`ga-tag ${tone}`}>{t}</span>
          </div>
        ))}
      </div>
    </Win>
  );
}

function ArtLogin() {
  return (
    <div className="ga-stack">
      <Win side={<SideNav on="env" />}>
        <div className="ga-h">
          <b>{tr("默认", "Default")}</b>
          <span className="ga-tag">{tr("未登录", "Signed out")}</span>
        </div>
        <div className="ga-card">
          <span className="ga-ln" />
          <span className="ga-btn pri ga-pulse">{tr("登录", "Sign in")}</span>
        </div>
        <div className="ga-card dim">
          <span className="ga-ln short" />
        </div>
      </Win>
      <div className="ga-browser">
        <div className="ga-url">claude.ai/oauth</div>
        <img className="ga-spark" src="./assets/claude-spark.png" alt="" />
        <span className="ga-btn pri sm">{tr("授权", "Authorize")}</span>
      </div>
    </div>
  );
}

function ArtTry() {
  return (
    <Win side={<SideNav on="home" />}>
      <div className="ga-hello">
        <img className="ga-spark sm" src="./assets/app-icon.png" alt="" />
        <b>{tr("下午好", "Good afternoon")}</b>
      </div>
      <div className="ga-envs">
        <span className="on">
          <i style={{ background: "#3d3b36" }} />
          {tr("默认", "Default")}
        </span>
        <span>
          <i style={{ background: "#c4704f" }} />
          {tr("工作", "Work")}
        </span>
      </div>
      <div className="ga-comp">
        <span className="ga-typing">{tr("帮我看看这个项目", "Take a look at this project")}</span>
        <div className="ga-comp-r">
          <span className="ga-chip">📁 ~/app</span>
          <span className="ga-chip ok">🇺🇸 {tr("100 纯净", "100 Clean")}</span>
          <span className="ga-send ga-pulse">↑</span>
        </div>
      </div>
    </Win>
  );
}
