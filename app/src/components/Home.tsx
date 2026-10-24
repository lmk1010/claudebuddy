import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Account, AccountStatusSnapshot, PermissionMode, RecentProject } from "../lib/model";
import { AUTH_LABEL, AUTH_PILL, PERMISSION_LABEL, greeting, proxyLabel } from "../lib/model";
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
import { NetScore } from "./NetReport";

interface Props {
  username: string;
  accounts: Account[];
  activeAccount: Account | null;
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
  const auth = acc ? (p.status[acc.id]?.auth ?? acc.auth) : "unknown";
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
    items.push({ label: "选择其他文件夹…", icon: <IconPlus size={14} />, run: p.onPickFolder });
    menu.open({ clientX: r.left, clientY: r.bottom + 6, preventDefault: () => {}, stopPropagation: () => {} }, items, "在哪个目录里启动");
  };

  const blocked = !signedIn ?`「${acc?.label ?? "这个环境"}」还没登录` : null;
  const submit = () => {
    if (blocked) return;
    p.onStart(text.trim());
    setText("");
  };

  return (
    <>
      <div className="wh">
        <span className="acts">
          <button className="ib" title="搜索 ⌘K" onClick={p.onSearch}>
            <IconSearch />
          </button>
          <button className="ib" title="设置 ⌘," onClick={p.onSettings}>
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
              {greeting()}，{p.username || "本机用户"}
            </h1>
          </div>

          <div className="mh-envs">
            <div className="envtabs" ref={tabsRef} role="tablist" aria-label="环境">
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
                    title={`~/${a.configDir} · ${AUTH_LABEL[st]}（双击编辑）`}
                  >
                    <span className="av xs" style={{ background: a.tint }}>
                      {a.label.slice(0, 1)}
                    </span>
                    <span className="envtab-n">{a.label}</span>
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
            <button className="ib" title="新建环境" onClick={p.onCreateAccount}>
              <IconPlus />
            </button>
            <Help title="环境是什么？" wide>
              <p>一个环境 = 一个独立的 Claude Code 配置目录。一个 Claude 账号放一个环境，登录凭据、对话记录、设备身份全分开。</p>
              <Steps
                items={[
                  "上面选中哪个环境，新会话就开在哪个环境里",
                  "名字后面挂着小钥匙的 = 还没登录（选中它再点「现在登录」）",
                  "双击环境名能编辑：改名、登录、设代理、清痕迹",
                  "点 + 新建一个环境，给另一个账号用",
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
                编辑环境
              </button>
            </div>

            <div className="composer">
              <textarea
                ref={inputRef}
                className="ph selectable"
                value={text}
                rows={2}
                placeholder={`在「${acc?.label ?? "—"}」里启动 Claude Code，可以直接写第一句话…`}
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
                  title="在哪个目录里启动"
                >
                  <IconFolder />
                  <span className="mono">{p.cwd ? shortenHome(p.cwd) : "选择目录…"}</span>
                  <IconChevronDown size={11} />
                </button>
                <button className="chip" onClick={(e) => p.onPickPermission(e.currentTarget)} title="权限模式">
                  <IconShield />
                  {PERMISSION_LABEL[p.permission]}
                  <IconChevronDown size={11} />
                </button>
                {/* 出口：显示线路 + 信任分，点开去这个环境的「网络出口」 */}
                <button
                  className="chip"
                  onClick={() => acc && p.onEditNetwork(acc.id)}
                  title="这个环境的网络出口 · 点开查看体检、换线路"
                >
                  <IconGlobe size={13} />
                  <span className="mono">{acc ? proxyLabel(acc.proxy) : "直连"}</span>
                  {acc && <NetScore accountId={acc.id} proxyKey={proxyLabel(acc.proxy)} />}
                </button>
                <button className="send" onClick={submit} disabled={Boolean(blocked)} title={blocked ?? "新建会话 ↵"}>
                  <IconArrowUp />
                </button>
              </div>
              {blocked && (
                <div className="composer-hint">
                  <span>{blocked}，登录后才能开会话</span>
                  <button className="composer-fix" onClick={() => acc && p.onLogin(acc.id)}>
                    <IconKey size={12} />
                    现在登录
                  </button>
                </div>
              )}
            </div>

            <div className="sugg">
              {p.recent[0] && (
                <button className="chip" onClick={() => p.onQuickStart(p.recent[0])}>
                  <IconRefresh />
                  继续 {p.recent[0].name}
                </button>
              )}
              <button className="chip" onClick={p.onQuickBlank}>
                <IconTerminal />
                空白终端
              </button>
              <button className="chip" onClick={p.onQuickClone}>
                <IconLayers />
                从 Git 克隆
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
