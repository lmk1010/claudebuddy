import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ShellWindow } from "../lib/model";
import { resolveTermTheme } from "../lib/termThemes";
import { takePendingPrompt } from "../lib/pendingPrompt";
import { tr } from "../lib/i18n";

/**
 * 一个窗口的终端视图。
 *
 * 每个窗口**独立一个 xterm 实例 + 独立一个 PTY**，不是标签页共用。
 * 窗口 A 的进程死了不影响窗口 B，各自的滚动缓冲、环境变量、工作目录都是分开的。
 *
 * 为了不让切窗口丢状态，所有实例都常驻 DOM，非激活的用 visibility 隐藏。
 *
 * 而且切到别的页面时（环境/网络/首页），本组件会被卸载 —— 那时**不杀进程**，
 * 只断开视图；进程的生命周期跟着标签页走，回来时用 term:attach 接回去，
 * 并把切走期间缓冲的输出补上。
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
  lineHeight = 1.2,
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
    /** 实时数据放行了没有 —— 见 offData 里那段说明 */
    let live = false;
    const pending: string[] = [];
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

    const offData = (() => {
      /**
       * 实时输出先攒着，等 attach 决策做完再放行。
       *
       * 不然会和回放的旧输出交错：订阅比 attach 早，而 attach 走 IPC 是异步的 ——
       * 期间的实时数据会先写进 xterm，紧接着回放缓冲又把同一段重写一遍，
       * 结果顺序乱、内容重。
       */
      return window.claudeBuddy.onTermData((p) => {
        if (p.id !== win.id) return;
        if (!live) {
          pending.push(p.data);
          return;
        }
        term.write(p.data);
      });
    })();
    const offExit = window.claudeBuddy.onTermExit((p) => {
      if (p.id !== win.id) return;
      term.write(`\r\n\x1b[38;5;244m[${tr(`进程已退出，代码 ${p.exitCode}`, `Process exited, code ${p.exitCode}`)}]\x1b[0m\r\n`);
    });

    /**
     * 先量好再启动。之前一建好就用 xterm 默认的 80×24 起 PTY，随后才 fit 到真实宽度 ——
     * Claude Code 的界面在启动中途被改尺寸，会把 logo 和标题画成两份、互相压在一起。
     * 所以：等字体加载完 → fit → 拿到真实的 cols/rows 再起进程。
     */
    const start = async () => {
      try {
        await document.fonts?.ready;
      } catch {
        /* 没有 fonts API 就直接量 */
      }
      // 容器可能还没排版完：最多等几帧，直到有宽度
      for (let i = 0; i < 10 && (!host.offsetWidth || !term.element?.offsetWidth); i++) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      safeFit();
      if (disposed) return;

      /**
       * 先问主进程：这个 id 的进程还活着吗？
       *
       * 终端进程的生命周期绑在标签页上，不绑在这个组件上 —— 用户切到环境/
       * 网络/首页时本组件会卸载，但进程不该跟着死。活着就把它切走期间缓冲的
       * 输出补回来，不重开；只有真的没了才 spawn。
       */
      let reused = false;
      try {
        const a = await window.claudeBuddy.attachTerm(win.id);
        if (disposed) return;
        if (a?.alive) {
          if (a.buffer) term.write(a.buffer);
          reused = true;
        }
      } catch {
        /* 问不到就当没活着，照旧 spawn */
      }

      const r = reused
        ? { ok: true, reused: true, error: undefined as string | undefined }
        : await window.claudeBuddy.spawnTerm({
            id: win.id,
            account: accountId,
            cwd: win.cwd,
            cols: term.cols,
            rows: term.rows,
            command: win.runsClaude ? "claude" : undefined,
            rawCommand: win.runsClaude ? undefined : win.rawCommand,
            permission: win.permission,
            prompt: win.runsClaude ? takePendingPrompt(win.id) : undefined,
          });

      // 决策做完了，放行实时数据（等待期间攒下的先补上）
      live = true;
      for (const d of pending) term.write(d);
      pending.length = 0;
      return r;
    };
    void start()
      .then((r) => {
        if (r && !r.ok) {
          term.write(
            `\x1b[38;5;173m${tr("启动失败", "Failed to start")}: ${r.error ?? tr("未知错误", "Unknown error")}\x1b[0m\r\n`,
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
      // 不杀进程：只断开这个视图。进程跟着标签页活，关标签页时才由上层 killTerm
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
