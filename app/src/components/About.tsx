import { useEffect, useState } from "react";
import type { AppInfo, CheckItem } from "../lib/bridge";
import { IconCopy, IconFolder, IconGlobe, IconKey, IconTrash } from "./iconAliases";

const REPO = "https://github.com/lmk1010/claudebuddy";

/** GitHub 的猫爪标 —— 图标库里没有，内联一个 */
function GitHubMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** macOS 的 Darwin 内核号 → 系统版本（Darwin 24 = macOS 15） */
function macName(darwin?: string) {
  const major = Number((darwin || "").split(".")[0]);
  if (!major) return "macOS";
  if (major >= 25) return `macOS ${major + 1}`;
  if (major >= 20) return `macOS ${major - 9}`;
  return `macOS 10.${major - 4}`;
}

const FEATURES = [
  { icon: <IconKey size={15} />, title: "多账号互不串", body: "每个环境一份独立配置目录，登录、对话、设备 ID 全分开" },
  { icon: <IconGlobe size={15} />, title: "一个环境一条线", body: "各自的代理出口，进会话前先看 Claude 眼里的 IP 干不干净" },
  { icon: <IconTrash size={15} />, title: "随时清干净", body: "把这台电脑上所有 Claude Code 的登录痕迹找出来，一键清掉" },
];

/**
 * 关于 —— 应用是谁、哪个版本、跑在什么上面、去哪看源码和反馈。
 *
 * 运行信息一行一条、可复制，用户报问题时直接贴给开发者；不放空泛的介绍文案。
 */
export default function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [claude, setClaude] = useState<CheckItem | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.claudeBuddy.info().then(setInfo);
    void window.claudeBuddy
      .checkupRun()
      .then((r) => setClaude(r.items.find((i) => i.key === "claude") ?? null))
      .catch(() => setClaude(null));
  }, []);

  const open = (url: string) => void window.claudeBuddy.openExternal(url);
  const claudeVer = claude?.status === "ok" ? claude.title.replace(/^已安装\s*/, "") : claude === undefined ? "检测中…" : "没装";

  const rows: [string, string][] = [
    ["ClaudeBuddy", info ? `v${info.version}` : "—"],
    ["Claude Code", claudeVer],
    ["系统", info ? [macName(info.osVersion), info.arch === "arm64" ? "Apple 芯片" : info.arch].filter(Boolean).join(" · ") : "—"],
    ["Electron", info?.versions ? `${info.versions.electron} · Chromium ${info.versions.chrome.split(".")[0]} · Node ${info.versions.node}` : "—"],
  ];

  const copyAll = () => {
    const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") + (claude?.detail ? `\nClaude 路径: ${claude.detail}` : "");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="ab">
      <div className="ab-hero">
        <img src="./assets/app-icon.png" alt="" />
        <div className="ab-hero-t">
          <h1>ClaudeBuddy</h1>
          <p>给 Claude Code 一个安静的家</p>
          <div className="ab-tags">
            <span className="ab-tag">{info ? `v${info.version}` : "v—"}</span>
            <span className="ab-tag">开源 · MIT</span>
            <span className="ab-tag">macOS</span>
          </div>
        </div>
      </div>

      <div className="ab-acts">
        <button className="btn pri" onClick={() => open(REPO)}>
          <GitHubMark />
          GitHub 仓库
        </button>
        <button className="btn" onClick={() => open(`${REPO}/releases`)}>
          版本与更新
        </button>
        <button className="btn" onClick={() => open(`${REPO}/issues/new`)}>
          反馈问题
        </button>
        <button className="btn ghost" onClick={() => open(`${REPO}#readme`)}>
          使用说明
        </button>
      </div>

      <div className="ab-feats">
        {FEATURES.map((f) => (
          <div className="ab-feat" key={f.title}>
            <span className="ab-feat-ic">{f.icon}</span>
            <b>{f.title}</b>
            <p>{f.body}</p>
          </div>
        ))}
      </div>

      <div className="em-sub">
        <span>运行信息</span>
        <button className="det-k" onClick={copyAll}>
          <IconCopy size={12} />
          {copied ? "已复制" : "复制，反馈问题时贴上"}
        </button>
      </div>
      <div className="em-card">
        {rows.map(([k, v]) => (
          <div className="ab-row" key={k}>
            <span>{k}</span>
            <span className="mono">{v}</span>
          </div>
        ))}
        {claude?.detail && claude.status === "ok" && (
          <div className="ab-row">
            <span>Claude 路径</span>
            <span className="mono" title={claude.detail}>
              {claude.detail.replace(/^\/Users\/[^/]+/, "~")}
            </span>
          </div>
        )}
        {info?.userData && (
          <div className="ab-row">
            <span>应用数据</span>
            <span className="ab-row-v">
              <span className="mono" title={info.userData}>
                {info.userData.replace(/^\/Users\/[^/]+/, "~")}
              </span>
              <button className="det-k" onClick={() => void window.claudeBuddy.reveal(info.userData!)} title="在访达中打开">
                <IconFolder size={12} />
              </button>
            </span>
          </div>
        )}
      </div>

      <p className="ab-foot">
        MIT License © 2026 mingkang liu · 非 Anthropic 官方产品，与 Anthropic 无隶属关系。Claude 是 Anthropic 的商标。
      </p>
    </div>
  );
}
