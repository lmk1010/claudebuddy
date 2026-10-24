import { useEffect, useState } from "react";
import type { AppInfo, CheckItem } from "../lib/bridge";
import { IconCopy, IconFolder } from "./iconAliases";

const REPO = "https://github.com/lmk1010/claudebuddy";

/** macOS 的 Darwin 内核号 → 系统版本（Darwin 24 = macOS 15） */
function macName(darwin?: string) {
  const major = Number((darwin || "").split(".")[0]);
  if (!major) return "macOS";
  if (major >= 25) return `macOS ${major + 1}`;
  if (major >= 20) return `macOS ${major - 9}`;
  return `macOS 10.${major - 4}`;
}

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/**
 * 关于 —— 照系统「关于本机」的写法：居中、留白、只放必要信息。
 *
 * 图标直接放在纸面上，不再垫渐变卡片；链接用文字，不抢主操作；
 * 运行信息四行，一键复制给反馈用。功能介绍不在这里重复（教程里有）。
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
  const claudeVer =
    claude === undefined ? "检测中…" : claude?.status === "ok" ? claude.title.replace(/^已安装\s*/, "") : "未安装";

  const rows: { k: string; v: string; title?: string; reveal?: string }[] = [
    { k: "Claude Code", v: claudeVer, title: claude?.detail },
    { k: "系统", v: info ? [macName(info.osVersion), info.arch === "arm64" ? "Apple 芯片" : info.arch].filter(Boolean).join(" · ") : "—" },
    { k: "运行时", v: info?.versions ? `Electron ${info.versions.electron} · Node ${info.versions.node}` : "—" },
    { k: "应用数据", v: info?.userData ? home(info.userData) : "—", title: info?.userData, reveal: info?.userData },
  ];

  const copyAll = () => {
    const text = [`ClaudeBuddy ${info?.version ?? ""}`, ...rows.map((r) => `${r.k}: ${r.title ?? r.v}`)].join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const LINKS: [string, string][] = [
    ["GitHub", REPO],
    ["更新日志", `${REPO}/releases`],
    ["反馈问题", `${REPO}/issues/new`],
    ["许可协议", `${REPO}/blob/main/LICENSE`],
  ];

  return (
    <div className="ab">
      <div className="ab-id">
        <img src="./assets/app-icon.png" alt="" />
        <h1>ClaudeBuddy</h1>
        <p className="ab-ver">版本 {info?.version ?? "—"}</p>
        <p className="ab-line">给 Claude Code 一个安静的家 —— 多账号、多线路、互不打扰。</p>
        <nav className="ab-links">
          {LINKS.map(([label, url]) => (
            <button key={label} onClick={() => open(url)}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="ab-info">
        {rows.map((r) => (
          <div className="ab-row" key={r.k}>
            <span>{r.k}</span>
            <span className="ab-v mono" title={r.title}>
              {r.v}
              {r.reveal && (
                <button className="ab-ic" title="在访达中打开" onClick={() => void window.claudeBuddy.reveal(r.reveal!)}>
                  <IconFolder size={12} />
                </button>
              )}
            </span>
          </div>
        ))}
        <button className="ab-copy" onClick={copyAll}>
          <IconCopy size={12} />
          {copied ? "已复制" : "复制运行信息"}
        </button>
      </div>

      <p className="ab-foot">
        MIT License · © 2026 mingkang liu
        <br />
        非 Anthropic 官方产品。Claude 是 Anthropic, PBC 的商标。
      </p>
    </div>
  );
}
