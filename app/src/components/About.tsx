import { useEffect, useState } from "react";
import type { AppInfo, CheckItem } from "../lib/bridge";
import { IconCopy, IconFolder } from "./iconAliases";
import { tr } from "../lib/i18n";

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
    claude === undefined
      ? tr("检测中…", "Checking…")
      : claude?.status === "ok"
        ? claude.title.replace(/^(已安装|Installed)\s*/i, "")
        : tr("未安装", "Not installed");

  const rows: { k: string; v: string; title?: string; reveal?: string }[] = [
    { k: "Claude Code", v: claudeVer, title: claude?.detail },
    { k: tr("系统", "System"), v: info ? [macName(info.osVersion), info.arch === "arm64" ? tr("Apple 芯片", "Apple silicon") : info.arch].filter(Boolean).join(" · ") : "—" },
    { k: tr("运行时", "Runtime"), v: info?.versions ? `Electron ${info.versions.electron} · Node ${info.versions.node}` : "—" },
    { k: tr("应用数据", "App data"), v: info?.userData ? home(info.userData) : "—", title: info?.userData, reveal: info?.userData },
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
    [tr("更新日志", "Changelog"), `${REPO}/releases`],
    [tr("反馈问题", "Report an issue"), `${REPO}/issues/new`],
    [tr("许可协议", "License"), `${REPO}/blob/main/LICENSE`],
  ];

  return (
    <div className="ab">
      <div className="ab-id">
        <img src="./assets/app-icon.png" alt="" />
        <h1>ClaudeBuddy</h1>
        <p className="ab-ver">{tr("版本", "Version")} {info?.version ?? "—"}</p>
        <p className="ab-line">{tr("给 Claude Code 一个安静的家 —— 多账号、多线路、互不打扰。", "A quiet home for Claude Code: multiple accounts, multiple routes, no interference.")}</p>
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
                <button className="ab-ic" title={tr("在访达中打开", "Show in Finder")} onClick={() => void window.claudeBuddy.reveal(r.reveal!)}>
                  <IconFolder size={12} />
                </button>
              )}
            </span>
          </div>
        ))}
        <button className="ab-copy" onClick={copyAll}>
          <IconCopy size={12} />
          {copied ? tr("已复制", "Copied") : tr("复制运行信息", "Copy runtime info")}
        </button>
      </div>

      <p className="ab-foot">
        MIT License · © 2026 mingkang liu
        <br />
        {tr("非 Anthropic 官方产品。Claude 是 Anthropic, PBC 的商标。", "Not an official Anthropic product. Claude is a trademark of Anthropic, PBC.")}
      </p>
    </div>
  );
}
