import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Account, AccountStatusSnapshot, Exit, PermissionMode, RecentProject } from "../lib/model";
import { AUTH_LABEL, AUTH_PILL, PERMISSION_LABEL, greeting, proxyLabel, proxyModeOf } from "../lib/model";
import {
  IconArrowUp,
  IconChevronDown,
  IconFolder,
  IconGear,
  IconGlobe,
  IconKey,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShield,
  IconTerminal,
} from "./iconAliases";
import Help, { Steps } from "./Help";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { NetScore, useNetReport } from "./NetReport";
import { tr } from "../lib/i18n";

interface Props {
  username: string;
  accounts: Account[];
  activeAccount: Account | null;
  /** 所有出口 —— 环境 tab 上要按它显示这个环境走哪条路 */
  exits: Exit[];
  status: Record<string, AccountStatusSnapshot>;
  /** 每个环境正在跑几个会话，环境切换条上显示 */
  runningBy: Record<string, number>;
  cwd: string | null;
  permission: PermissionMode;
  recent: RecentProject[];
  onSelectAccount: (id: string) => void;
  onEditAccount: (id: string) => void;
  onCreateAccount: () => void;
  onLogin: (id: string) => void;
  onPickFolder: () => void;
  onSetCwd: (cwd: string) => void;
  /** 打开这个环境的「网络出口」 */
  onEditNetwork: (id: string) => void;
  onPickPermission: (anchor: HTMLElement) => void;
  /** 在当前环境里开一个会话；text 非空就作为第一句送进去 */
  onStart: (text: string) => void;
  onQuickBlank: () => void;
  onQuickClone: () => void;
  onQuickStart: (p: RecentProject) => void;
  onSearch: () => void;
  onSettings: () => void;
}

/**
 * 首页 —— 开一个新会话的起点，只做这一件事。
 *
 * 问候、选环境、输入框，三样东西在窗口里垂直居中。
 * 正在跑的会话、历史会话都去「会话」页看，不堆在这里 —— 一屏既要开新的、
 * 又要管旧的，结果是两件事都不好做。
 *
 * 环境切换条就是"默认环境"：选中谁，新会话就建在谁那里。
 */
export default function Home(p: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const acc = p.activeAccount;
  /**
   * 出口 IP 和分数必须来自**同一份报告**。
   *
   * 分开取（IP 从 state、分数从报告）会出现"显示 A 的 IP、配 B 的分数"——
   * 两个数据源各自刷新，中间必然有不一致的时刻。同一个 hook 拿同一份就行，
   * 它内部已有缓存与合并，多调一次不会多发请求。
   */
  const report = useNetReport(acc?.id, acc ? proxyLabel(acc.proxy) : "");
  /** 公网出口 IP。拿不到才退回本机地址 —— 127.0.0.1:7950 对用户没意义 */
  const exitIp = report?.ip ?? acc?.lastExitIp ?? null;
  // 没测过就是未知。不拿配置文件里那个旧值当事实，否则已登录也会被当成没登录
  const auth = acc ? (p.status[acc.id]?.auth ?? "unknown") : "unknown";
  const signedIn = auth === "signedIn";

  useEffect(() => {
    inputRef.current?.focus();
  }, [acc?.id]);

  const tabsRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-acc="${acc?.id}"]`);
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [acc?.id, p.accounts]);

  const menu = useContextMenu();
  const openDirMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    // 最近用过的目录（去重，当前的排第一），最多 6 个
    const seen = new Set<string>();
    const dirs = [p.cwd, ...p.recent.map((x) => x.cwd)].filter((d): d is string => {
      if (!d || seen.has(d)) return false;
      seen.add(d);
      return true;
    });
    const items: MenuItem[] = dirs.slice(0, 6).map((d) => ({
      label: shortenHome(d),
      icon: <IconFolder size={14} />,
      hint: d === p.cwd ? "✓" : undefined,
      run: () => p.onSetCwd(d),
    }));
    if (items.length) items.push("sep");
    items.push({ label: tr("选择其他文件夹…", "Choose another folder…"), icon: <IconPlus size={14} />, run: p.onPickFolder });
    menu.open({ clientX: r.left, clientY: r.bottom + 6, preventDefault: () => {}, stopPropagation: () => {} }, items, tr("在哪个目录里启动", "Folder to start in"));
  };

  /**
   * 三种拦下理由分开算：没登录、暂时风控、要求走代理却没出口。
   * 以前只分两种，第三种会被当成“没登录”而引导去重新登录，做了也没用。
   */
  const proxyReady = Boolean(acc && acc.proxy && acc.proxy.protocol !== "none" && acc.proxy.host);
  const proxyBlocked = Boolean(acc?.enforceProxy) && !proxyReady;

  const blocked = auth === "unknown"
    ? tr(`正在确认「${acc?.label ?? "这个环境"}」的登录态…`, `Checking sign-in state for "${acc?.label ?? "this environment"}"…`)
    : !signedIn
      ? tr(`「${acc?.label ?? "这个环境"}」还没登录`, `"${acc?.label ?? "This environment"}" is not signed in`)
    : proxyBlocked
      ? tr(
          `「${acc?.label ?? "这个环境"}」要求必须走代理，但还没有配出口`,
          `"${acc?.label ?? "This environment"}" requires a proxy, but none is set`,
        )
      : null;
  const submit = () => {
    if (blocked) return;
    p.onStart(text.trim());
    setText("");
  };

  return (
    <>
      <div className="wh">
        <span className="acts">
          <button className="ib" title={tr("搜索 ⌘K", "Search ⌘K")} onClick={p.onSearch}>
            <IconSearch />
          </button>
          <button className="ib" title={tr("设置 ⌘,", "Settings ⌘,")} onClick={p.onSettings}>
            <IconGear />
          </button>
        </span>
      </div>

      <div className="hm">
        <div className="hm-c">
          <div className="greet">
            {/* 用自己的 App 图标（带 >_），跟 Claude 官方的火花区分开 */}
            <img className="greet-icon" src="./assets/app-icon.png" alt="" />
            <h1>
              {greeting()}{tr("，", ", ")}{p.username || tr("本机用户", "there")}
            </h1>
          </div>

          <div className="mh-envs">
            <div className="envtabs" ref={tabsRef} role="tablist" aria-label={tr("环境", "Environment")}>
              {ind && <i className="envtabs-ind" style={{ transform: `translateX(${ind.left}px)`, width: ind.width }} />}
              {p.accounts.map((a) => {
                const st = p.status[a.id]?.auth ?? a.auth;
                const on = a.id === acc?.id;
                return (
                  <button
                    key={a.id}
                    data-acc={a.id}
                    role="tab"
                    aria-selected={on}
                    className={`envtab${on ? " on" : ""}`}
                    onClick={() => p.onSelectAccount(a.id)}
                    onDoubleClick={() => p.onEditAccount(a.id)}
                    title={`~/${a.configDir} · ${AUTH_LABEL[st]}${tr("（双击编辑）", " (double-click to edit)")}`}
                  >
                    <span className="av xs" style={{ background: a.tint }}>
                      {a.label.slice(0, 1)}
                    </span>
                    <span className="envtab-n">{a.label}</span>
                    {/* 这个环境走哪条路出去 —— 一个小色点，和「代理方式」卡同一个配色。
                        直连也画（灰）—— 不画的话用户分不清"灰点"和"没点" */}
                    {(() => {
                      const pm = proxyModeOf(a, p.exits);
                      const label = pm === "managed" ? tr("App 托管", "Managed by app") : pm === "own" ? tr("你自己的代理", "Your own proxy") : tr("直连", "Direct");
                      return <span className={`envtab-pm pm-${pm}`} title={tr(`代理方式：${label}`, `Proxy mode: ${label}`)} />;
                    })()}
                    {/* 登录好的不打标；没登录的挂一把小钥匙，一眼看出「这个要先登录」 */}
                    {st !== "signedIn" && (
                      <span className={`envtab-st${st === "suspended" ? " bad" : ""}`} title={AUTH_LABEL[st]}>
                        <IconKey size={11} />
                      </span>
                    )}
                    {p.runningBy[a.id] ? <em>{p.runningBy[a.id]}</em> : null}
                  </button>
                );
              })}
            </div>
            <button className="ib" title={tr("新建环境", "New environment")} onClick={p.onCreateAccount}>
              <IconPlus />
            </button>
            <Help title={tr("环境是什么？", "What is an environment?")} wide>
              <p>{tr("一个环境 = 一个独立的 Claude Code 配置目录。一个 Claude 账号放一个环境，登录凭据、对话记录、设备身份全分开。", "An environment is an independent Claude Code config folder. Put one Claude account in each environment, so credentials, conversation history and device identity stay separate.")}</p>
              <Steps
                items={[
                  tr("上面选中哪个环境，新会话就开在哪个环境里", "New sessions start in whichever environment is selected above"),
                  tr("名字后面挂着小钥匙的 = 还没登录（选中它再点「现在登录」）", "A small key after the name means not signed in (select it, then click \"Sign in now\")"),
                  tr("双击环境名能编辑：改名、登录、设代理、清痕迹", "Double-click an environment name to edit it: rename, sign in, set a proxy, clear traces"),
                  tr("点 + 新建一个环境，给另一个账号用", "Click + to create another environment for a different account"),
                ]}
              />
            </Help>
          </div>

          <div className="mh-env" key={acc?.id ?? "none"}>
            <div className="mh-meta">
              <span className={`pill ${AUTH_PILL[auth]}`}>{AUTH_LABEL[auth]}</span>
              <span className="mono">~/{acc?.configDir}</span>
              {/* 没登录时不显示邮箱 —— 「未登录」旁边挂一个邮箱会让人以为状态读错了 */}
              {acc && signedIn && p.status[acc.id]?.email && <span>{p.status[acc.id]!.email}</span>}
              <button className="mh-edit" onClick={() => acc && p.onEditAccount(acc.id)}>
                {tr("编辑环境", "Edit environment")}
              </button>
            </div>

            <div className="composer">
              <textarea
                ref={inputRef}
                className="ph selectable"
                value={text}
                rows={2}
                placeholder={tr(`在「${acc?.label ?? "—"}」里启动 Claude Code，可以直接写第一句话…`, `Start Claude Code in "${acc?.label ?? "—"}". You can type a first message…`)}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="row">
                {/* 目录：下拉里先给最近用过的，再给「选择其他文件夹」—— 之前点一下直接弹系统对话框，
                    取消了就像没点过 */}
                <button
                  className="chip"
                  onClick={(e) => openDirMenu(e.currentTarget)}
                  title={tr("在哪个目录里启动", "Folder to start in")}
                >
                  <IconFolder />
                  <span className="mono">{p.cwd ? shortenHome(p.cwd) : tr("选择目录…", "Choose folder…")}</span>
                  <IconChevronDown size={11} />
                </button>
                <button
                  className={`chip${p.permission === "bypassPermissions" ? " chip-danger" : ""}`}
                  onClick={(e) => p.onPickPermission(e.currentTarget)}
                  title={tr("权限模式", "Permission mode")}
                >
                  <IconShield />
                  {PERMISSION_LABEL[p.permission]}
                  <IconChevronDown size={11} />
                </button>
                {/* 出口：显示**公网出口 IP** + 信任分，点开去这个环境的「网络出口」
                    之前这里显示的是 proxyLabel(proxy)，也就是 http://127.0.0.1:7950 ——
                    那是本机端口，对用户没有意义。他要看的是 Claude 服务器看到的那个 IP。 */}
                <button
                  className="chip"
                  onClick={() => acc && p.onEditNetwork(acc.id)}
                  title={
                    acc
                      ? tr(
                          `Claude 看到的出口 IP${exitIp ? `：${exitIp}` : "（还没测到）"} · 本机线路 ${proxyLabel(acc.proxy)} · 点开查看体检、换线路`,
                          `Exit IP Claude sees${exitIp ? `: ${exitIp}` : " (not measured yet)"} · local route ${proxyLabel(acc.proxy)} · click for health check and route switching`,
                        )
                      : tr("直连：不经过代理", "Direct: no proxy")
                  }
                >
                  <IconGlobe size={13} />
                  <span className="mono">{acc ? (exitIp ?? tr("测出口…", "Measuring…")) : tr("直连", "Direct")}</span>
                  {acc && <NetScore accountId={acc.id} proxyKey={proxyLabel(acc.proxy)} />}
                </button>
                <button className="send" onClick={submit} disabled={Boolean(blocked)} title={blocked ?? tr("新建会话 ↵", "New session ↵")}>
                  <IconArrowUp />
                </button>
              </div>
              {blocked && acc?.heldAt ? (
                // 暂时风控不是没登录：再登录一遍没用，给出真正能做的事
                <div className="composer-hint danger">
                  <span>
                    {tr(
                      `「${acc?.label ?? ""}」的账号正在暂时风控，现在开不了会话。上面切到别的环境用，或去查看原因`,
                      `"${acc?.label ?? ""}" is temporarily restricted, so sessions can't start. Switch to another environment above, or check the details`,
                    )}
                  </span>
                  <button className="composer-fix" onClick={() => void window.claudeBuddy.openExternal("https://claude.ai/restricted")}>
                    {tr("查看 / 申诉 ↗", "Details / appeal ↗")}
                  </button>
                </div>
              ) : proxyBlocked ? (
                <div className="composer-hint danger">
                  <span>{blocked}{tr("，会话没有启动", ". The session was not started")}</span>
                  <button className="composer-fix" onClick={() => acc && p.onEditNetwork(acc.id)}>
                    {tr("去配出口", "Set the exit")}
                  </button>
                </div>
              ) : blocked ? (
                <div className="composer-hint">
                  <span>{blocked}{tr("，登录后才能开会话", ". Sign in to start a session")}</span>
                  <button className="composer-fix" onClick={() => acc && p.onLogin(acc.id)}>
                    <IconKey size={12} />
                    {tr("现在登录", "Sign in now")}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="sugg">
              {p.recent[0] && (
                <button className="chip" onClick={() => p.onQuickStart(p.recent[0])}>
                  <IconRefresh />
                  {tr("继续", "Continue")} {p.recent[0].name}
                </button>
              )}
              <button className="chip" onClick={p.onQuickBlank}>
                <IconTerminal />
                {tr("空白终端", "Blank terminal")}
              </button>
              <button className="chip" onClick={p.onQuickClone}>
                <IconLayers />
                {tr("从 Git 克隆", "Clone from Git")}
              </button>
            </div>
          </div>
        </div>
      </div>
      {menu.node}
    </>
  );
}

function shortenHome(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}
