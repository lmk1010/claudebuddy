import { useEffect, useState, type ReactNode } from "react";

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

const CHAPTERS: Chapter[] = [
  {
    id: "clean",
    tab: "清理环境",
    title: "先把旧痕迹清干净",
    sub: "换号、或者想从零开始时做一次",
    steps: [
      ["打开清理本机", "设置 → 本机 → 清理本机"],
      ["选「建议清理」", "表头勾选全选"],
      ["点「清理所选」", "确认框里会写清每一项的后果"],
    ],
    note: "目录能从回收目录捞回；Keychain 凭据删了不能恢复",
    art: <ArtClean />,
    go: { label: "打开清理本机", to: "clean" },
  },
  {
    id: "login",
    tab: "重新授权",
    title: "登录你的 Claude 账号",
    sub: "浏览器里点一下授权，回来自动识别",
    steps: [
      ["打开环境", "左下角账号行 → 编辑"],
      ["点「登录」", "浏览器弹出，点授权"],
      ["回到应用", "看到「已登录」就好了"],
    ],
    note: "不用复制粘贴任何东西",
    art: <ArtLogin />,
    go: { label: "去登录", to: "editLogin" },
  },
  {
    id: "try",
    tab: "开始使用",
    title: "写一句话，回车",
    sub: "会话开在选中的环境和目录里",
    steps: [
      ["选环境", "首页顶部点一下"],
      ["写第一句话", "也可以留空，直接回车"],
      ["看出口徽章", "绿色「纯净」= 线路没问题"],
    ],
    art: <ArtTry />,
    go: { label: "去首页", to: "home" },
  },
];

export default function Guide({ onGo }: { onGo: (to: GuideTarget) => void }) {
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
        <button className="gd-arrow" onClick={() => to(i - 1)} disabled={i === 0} aria-label="上一步">
          ←
        </button>
        <div className="gd-dots">
          {CHAPTERS.map((c, k) => (
            <button key={c.id} className={k === i ? "on" : ""} onClick={() => to(k)} aria-label={c.tab} />
          ))}
        </div>
        <button className="gd-arrow" onClick={() => to(i + 1)} disabled={i === CHAPTERS.length - 1} aria-label="下一步">
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
      {["首页", "会话", "环境", "设置"].map((x) => (
        <span key={x} className={`ga-nv${x === on ? " on" : ""}`}>
          {x}
        </span>
      ))}
    </>
  );
}

function ArtClean() {
  const rows: [string, string, string, boolean][] = [
    [".claude-old", "空壳", "bad", true],
    ["prof_6111", "空壳", "bad", true],
    ["me@mail.com", "正常", "ok", false],
  ];
  return (
    <Win side={<SideNav on="设置" />}>
      <div className="ga-h">
        <b>清理本机</b>
        <span className="ga-btn danger ga-pulse">清理所选 2 项</span>
      </div>
      <div className="ga-seg">
        <span>全部</span>
        <span className="on">建议清理</span>
        <span>正常</span>
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
      <Win side={<SideNav on="环境" />}>
        <div className="ga-h">
          <b>默认</b>
          <span className="ga-tag">未登录</span>
        </div>
        <div className="ga-card">
          <span className="ga-ln" />
          <span className="ga-btn pri ga-pulse">登录</span>
        </div>
        <div className="ga-card dim">
          <span className="ga-ln short" />
        </div>
      </Win>
      <div className="ga-browser">
        <div className="ga-url">claude.ai/oauth</div>
        <img className="ga-spark" src="./assets/claude-spark.png" alt="" />
        <span className="ga-btn pri sm">授权</span>
      </div>
    </div>
  );
}

function ArtTry() {
  return (
    <Win side={<SideNav on="首页" />}>
      <div className="ga-hello">
        <img className="ga-spark sm" src="./assets/claude-spark.png" alt="" />
        <b>下午好</b>
      </div>
      <div className="ga-envs">
        <span className="on">
          <i style={{ background: "#3d3b36" }} />
          默认
        </span>
        <span>
          <i style={{ background: "#c4704f" }} />
          工作
        </span>
      </div>
      <div className="ga-comp">
        <span className="ga-typing">帮我看看这个项目</span>
        <div className="ga-comp-r">
          <span className="ga-chip">📁 ~/app</span>
          <span className="ga-chip ok">🇺🇸 100 纯净</span>
          <span className="ga-send ga-pulse">↑</span>
        </div>
      </div>
    </Win>
  );
}
