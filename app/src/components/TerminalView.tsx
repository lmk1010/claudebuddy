import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ShellWindow } from "../lib/model";
import { resolveTermTheme } from "../lib/termThemes";

/**
 * 一个窗口的终端视图。
 *
 * 每个窗口**独立一个 xterm 实例 + 独立一个 PTY**，不是标签页共用。
 * 窗口 A 的进程死了不影响窗口 B，各自的滚动缓冲、环境变量、工作目录都是分开的。
 *
 * 为了不让切窗口丢状态，所有实例都常驻 DOM，非激活的用 visibility 隐藏。
 *
 * 配色来自设计稿的 .tw：浅色 #FFFEFB / 暗色 #24221F，语法色按底色重调，
 * 保证纸面上也有 4.5:1。
 */

interface Props {
  win: ShellWindow;
  /** 账号只传 id —— 目录与环境由主进程组装，渲染层拿不到路径 */
  accountId: string;
  active: boolean;
  fontSize: number;
  fontFamily: string;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  copyOnSelect: boolean;
  /** 配色 id（auto = 跟随应用） */
  themeId?: string;
  lineHeight?: number;
  padding?: string;
}

export default function TerminalView({
  win,
  accountId,
  active,
  fontSize,
  fontFamily,
  cursorStyle,
  cursorBlink,
  copyOnSelect,
  themeId = "auto",
  lineHeight = 1.6,
  padding,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // 挂载：建 xterm、接数据流、起 PTY。只跑一次。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: monoStack(fontFamily),
      fontSize,
      lineHeight,
      letterSpacing: 0,
      cursorBlink,
      cursorStyle,
      allowProposedApi: true,
      scrollback: 10000,
      macOptionIsMeta: true,
      theme: resolveTermTheme(themeId),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);

    termRef.current = term;
    fitRef.current = fit;

    // StrictMode 会挂载→卸载→再挂载：dispose 之后 rAF / ResizeObserver
    // 的回调还可能跑进来，那时 xterm 内部的 renderService 已经没了。
    let disposed = false;
    const safeFit = () => {
      if (disposed || termRef.current !== term) return;
      if (!term.element || term.element.offsetWidth === 0) return;
      try {
        fit.fit();
      } catch {
        /* 容器隐藏或字体还没量出来时会抛，忽略 */
      }
    };

    // 首帧之后才 fit，否则容器尺寸还没定下来
    requestAnimationFrame(safeFit);

    const sub = term.onData((data) => window.claudeBuddy.writeTerm(win.id, data));

    const offData = window.claudeBuddy.onTermData((p) => {
      if (p.id === win.id) term.write(p.data);
    });
    const offExit = window.claudeBuddy.onTermExit((p) => {
      if (p.id !== win.id) return;
      term.write(`\r\n\x1b[38;5;244m[进程已退出，代码 ${p.exitCode}]\x1b[0m\r\n`);
    });

    const dims = { cols: term.cols, rows: term.rows };
    window.claudeBuddy
      .spawnTerm({
        id: win.id,
        account: accountId,
        cwd: win.cwd,
        cols: dims.cols,
        rows: dims.rows,
        command: win.runsClaude ? "claude" : undefined,
      })
      .then((r) => {
        if (!r.ok) {
          term.write(
            `\x1b[38;5;173m启动失败：${r.error ?? "未知错误"}\x1b[0m\r\n`,
          );
        }
      });

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      safeFit();
      if (termRef.current === term) {
        window.claudeBuddy.resizeTerm(win.id, term.cols, term.rows);
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      sub.dispose();
      offData();
      offExit();
      window.claudeBuddy.killTerm(win.id);
      term.dispose();
      // 清掉 xterm 在宿主里留下的节点，否则再挂载时旧元素会和新的渲染服务打架
      host.replaceChildren();
      termRef.current = null;
    };
    // 只按窗口 id 建一次；account/cwd 变了自己关窗重开
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.id]);

  // 外观设置变化：改选项，不重建终端
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.fontSize = fontSize;
    t.options.fontFamily = monoStack(fontFamily);
    t.options.cursorStyle = cursorStyle;
    t.options.cursorBlink = cursorBlink;
    t.options.lineHeight = lineHeight;
    t.options.theme = resolveTermTheme(themeId);
    requestAnimationFrame(() => {
      if (termRef.current !== t) return;
      try {
        fitRef.current?.fit();
        window.claudeBuddy.resizeTerm(win.id, t.cols, t.rows);
      } catch {
        /* 忽略 */
      }
    });
    // padding 变了容器尺寸跟着变，也要重新 fit
  }, [fontSize, fontFamily, cursorStyle, cursorBlink, lineHeight, themeId, padding, win.id]);

  // 选中即复制（iTerm2 习惯）
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    const sub = t.onSelectionChange(() => {
      if (!copyOnSelect) return;
      const sel = t.getSelection();
      if (sel) void navigator.clipboard.writeText(sel).catch(() => {});
    });
    return () => sub.dispose();
  }, [copyOnSelect]);

  // 切到激活：fit + 重新取主题（可能换过明暗）
  useEffect(() => {
    const t = termRef.current;
    if (!t || !active) return;
    t.options.theme = resolveTermTheme(themeId);
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        window.claudeBuddy.resizeTerm(win.id, t.cols, t.rows);
        t.focus();
      } catch {
        /* 忽略 */
      }
    });
  }, [active, win.id]);

  return (
    <div
      className="term-pane"
      data-hidden={active ? "false" : "true"}
      aria-hidden={!active}
      style={{ padding, background: resolveTermTheme(themeId).background }}
    >
      <div ref={hostRef} style={{ height: "100%" }} />
    </div>
  );
}

/** 用户选的字体排第一，后面跟中文与系统回退 */
function monoStack(family: string): string {
  return `"${family}", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, "PingFang SC", monospace`;
}
