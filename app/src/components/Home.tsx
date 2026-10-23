import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Account,
  AccountStatusSnapshot,
  PermissionMode,
  RecentProject,
  RiskLevel,
  ShellWindow,
} from "../lib/model";
import {
  AUTH_LABEL,
  AUTH_PILL,
  PERMISSION_LABEL,
  RHYTHM_THRESHOLDS,
  greeting,
  prettyName,
  proxyLabel,
  relTime,
} from "../lib/model";
import {
  IconArrowUp,
  IconChevronDown,
  IconFolder,
  IconGlobe,
  IconKey,
  IconLayers,
  IconPanel,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShield,
  IconTerminal,
} from "./iconAliases";

interface Props {
  username: string;
  account: Account | null;
  /** 实时登录态：主页要能看出当前账号能不能直接开工 */
  accountStatus: AccountStatusSnapshot | undefined;
  cwd: string | null;
  permission: PermissionMode;
  recent: RecentProject[];
  windows: ShellWindow[];
  onPickFolder: () => void;
  onPickAccount: (anchor: HTMLElement) => void;
  onPickPermission: (anchor: HTMLElement) => void;
  onSubmit: (text: string) => void;
  onQuickStart: (project: RecentProject) => void;
  onQuickBlank: () => void;
  onQuickClone: () => void;
  onOpenAll: () => void;
  onSearch: () => void;
  onTogglePanel: () => void;
  /** 右上角设置入口：跟侧栏的「设置」、账号菜单里的「设置…」是同一个目的地 */
  onSettings: () => void;
  /** 就地登录：当前环境没登录时，直接从主页发起 */
  onLoginHere: () => void;
  riskOfProject: (cwd: string) => RiskLevel;
}

/**
 * 主页 —— 设计稿 07 · home。
 *
 * 跟 Claude Desktop 首页一个结构：火花 + 衬线问候语 + 一个大输入框。
 * 区别只在输入框底部：这里选的是**目录、账号、权限模式**，
 * 回车就在那个目录里起一个 Claude Code。
 */
export default function Home({
  username,
  account,
  accountStatus,
  cwd,
  permission,
  recent,
  windows,
  onPickFolder,
  onPickAccount,
  onPickPermission,
  onSubmit,
  onQuickStart,
  onQuickBlank,
  onQuickClone,
  onOpenAll,
  onSearch,
  onTogglePanel,
  onSettings,
  onLoginHere,
  riskOfProject,
}: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /** 这个环境能不能直接开工 */
  const auth = accountStatus?.auth ?? account?.auth ?? "unknown";
  const signedIn = auth === "signedIn";
  const canStart = Boolean(cwd) && signedIn;

  /** 提交前的检查：把"为什么点不动"说清楚，而不是让按钮默默无效 */
  const blockedReason = !cwd
    ? "先选一个目录"
    : !signedIn
      ? `${account?.label ?? "这个环境"}还没登录`
      : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const recentLive = useMemo(() => {
    // 正在跑的会话优先；其余按最近活动排
    const running = new Set(windows.map((w) => w.cwd));
    return [...recent].sort((a, b) => {
      const ra = running.has(a.cwd) ? 1 : 0;
      const rb = running.has(b.cwd) ? 1 : 0;
      return rb - ra || b.lastActive - a.lastActive;
    });
  }, [recent, windows]);

  const submit = () => {
    if (!canStart) return;
    onSubmit(text.trim());
    setText("");
  };

  return (
    <>
      {/* 设计稿 649：右上两个动作，搜索 + 折叠右栏 */}
      <div className="wh">
        {/* 环境状态条：主界面第一眼要能回答"我在哪个环境、能不能直接开工" */}
        <button className="envbar" onClick={(e) => onPickAccount(e.currentTarget)} title="切换环境">
          <span className="envbar-dot" style={{ background: account?.tint ?? "var(--t3)" }} />
          <span className="envbar-name">{account?.label ?? "没有环境"}</span>
          <span className={`pill ${AUTH_PILL[auth]}`}>{AUTH_LABEL[auth]}</span>
          <span className="envbar-exit mono">{proxyLabel(account?.proxy ?? { protocol: "none", host: "", port: 0 })}</span>
          <IconChevronDown size={11} />
        </button>

        <span className="acts">
          <button className="ib" title="搜索 ⌘K" onClick={onSearch}>
            <IconSearch />
          </button>
          <button className="ib" title="折叠右栏 ⌘B" onClick={onTogglePanel}>
            <IconPanel />
          </button>
          <button className="ib" title="设置 ⌘," onClick={onSettings}>
            <IconSettings />
          </button>
        </span>
      </div>

      <div className="home">
        <div className="greet">
          <img src="./assets/claude-spark.png" alt="" />
          <h1>
            {greeting()}，{username || "本机用户"}
          </h1>
        </div>

        <div className="composer">
          <textarea
            ref={inputRef}
            className="ph selectable"
            value={text}
            placeholder="要在哪个目录里启动 Claude Code？也可以直接写第一句话…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            style={{
              width: "100%",
              resize: "none",
              color: "var(--t1)",
              fontSize: 15,
              lineHeight: 1.6,
              minHeight: 52,
              fontFamily: "var(--sans)",
            }}
          />
          <div className="row">
            <button className="chip" onClick={onPickFolder} title="选择项目目录">
              <IconFolder />
              <span className="mono">{cwd ? shortenHome(cwd) : "选择目录…"}</span>
              <IconChevronDown size={11} />
            </button>

            <button
              className="chip"
              onClick={(e) => onPickAccount(e.currentTarget)}
              title={`环境：${account?.label ?? "—"}（决定配置目录、出口 IP 与设备身份）`}
            >
              <IconKey />
              <span className="mono">{account?.configDir ?? "—"}</span>
              <span className={`pill ${AUTH_PILL[accountStatus?.auth ?? account?.auth ?? "unknown"]}`}>
                {AUTH_LABEL[accountStatus?.auth ?? account?.auth ?? "unknown"]}
              </span>
              <IconChevronDown size={11} className="chip-arrow" />
            </button>

            <button
              className="chip"
              onClick={(e) => onPickPermission(e.currentTarget)}
              title="选择权限模式"
            >
              <IconShield />
              {PERMISSION_LABEL[permission]}
              <IconChevronDown size={11} />
            </button>

            {/* 出口是"这个会话会从哪出去"，开工前就该看见 */}
            <span className="chip chip-static" title="这个账号固定的网络出口">
              <IconGlobe size={13} />
              <span className="mono">{account ? proxyLabel(account.proxy) : "直连"}</span>
            </span>

            <button
              className="send"
              onClick={submit}
              disabled={!canStart}
              title={canStart ? "启动 Claude Code" : (blockedReason ?? "")}
            >
              <IconArrowUp />
            </button>
          </div>

          {/* 点不动时把原因写出来，并给一个就地解决的入口 */}
          {blockedReason && (
            <div className="composer-hint">
              <span>{blockedReason}</span>
              {!signedIn && (
                <button className="composer-fix" onClick={onLoginHere}>
                  现在登录
                </button>
              )}
            </div>
          )}
        </div>

        <div className="sugg">
          {recentLive[0] ? (
            <button className="chip" onClick={() => onQuickStart(recentLive[0])}>
              <IconRefresh />
              继续 {recentLive[0].name}
            </button>
          ) : null}
          <button className="chip" onClick={onQuickBlank}>
            <IconTerminal />
            空白终端
          </button>
          <button className="chip" onClick={onQuickClone}>
            <IconLayers />
            从 Git 克隆
          </button>
        </div>

        <div className="recent">
          <div className="gl" style={{ padding: "0 2px 10px" }}>
            <span>最近</span>
            <button onClick={onOpenAll} style={{ color: "var(--t4)" }}>
              全部 →
            </button>
          </div>

          {recentLive.length === 0 ? (
            <div className="empty-row">
              还没有历史会话。选一个目录起第一个 Claude Code，它会自动出现在这里。
            </div>
          ) : (
            <div className="rc-grid">
              {recentLive.slice(0, 6).map((p) => {
                const running = windows.find((w) => w.cwd === p.cwd);
                const risk = riskOfProject(p.cwd);
                return (
                  <button className="rc" key={p.cwd} onClick={() => onQuickStart(p)}>
                    <div className="rc-t">
                      <b>{p.name}</b>
                      <span
                        className={`pill ${running ? "p-ok" : risk === "hot" || risk === "critical" ? "p-warn" : "p-idle"}`}
                      >
                        {running ? "运行中" : risk === "hot" || risk === "critical" ? "偏快" : "已结束"}
                      </span>
                    </div>
                    <code>{shortenHome(p.cwd)}</code>
                    <p>
                      {running
                        ? `会话进行中 · ${p.sessions} 个会话`
                        : `${p.sessions} 个会话`}
                    </p>
                    <small>
                      {relTime(p.lastActive)} · {p.configDir}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function shortenHome(p: string): string {
  const home = "/Users/";
  const i = p.indexOf(home);
  if (i === 0) {
    const rest = p.slice(home.length);
    const slash = rest.indexOf("/");
    if (slash > 0) return `~${rest.slice(slash)}`;
  }
  return p;
}

/** 供检查器复用：阈值里的"满格"值 */
export const SPARK_FULL = 18;
export { RHYTHM_THRESHOLDS };

/** 最近项目卡片里的名字计算（主进程也会给，但兜底一下） */
export function projectName(cwd: string): string {
  return prettyName(cwd);
}
