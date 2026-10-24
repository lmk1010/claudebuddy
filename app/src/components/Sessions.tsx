import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Account, ShellWindow } from "../lib/model";
import type { SessionSummary } from "../lib/bridge";
import { fmtDuration, relTime, shortTime } from "../lib/model";
import {
  IconClock,
  IconClose,
  IconCopy,
  IconDots,
  IconFolder,
  IconGear,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTerminal,
} from "./iconAliases";
import Help from "./Help";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { IconEdit, RenameInput } from "./Rename";
import { tr } from "../lib/i18n";

interface Props {
  accounts: Account[];
  windows: ShellWindow[];
  activeWindowId: string | null;
  /** 每个环境的历史会话：undefined = 还没读 */
  history: Record<string, SessionSummary[] | undefined>;
  onLoadHistory: (accountId: string) => void;
  onOpen: (id: string) => void;
  onRequestClose: (id: string) => void;
  /** 在某个环境、某个目录里接着开 */
  onResume: (accountId: string, cwd: string) => void;
  onNew: () => void;
  onSearch: () => void;
  onRename: (id: string, title: string) => void;
  /** 一次关掉一批（走二次确认） */
  onCloseMany: (ids: string[], what: string) => void;
  onCopy: (text: string) => void;
  onReveal: (path: string) => void;
  onEditAccount: (id: string) => void;
}

type Tab = "live" | "history";

/**
 * 会话页 —— 管所有会话的地方，开新会话去首页。
 *
 * 两个维度分类：
 *   · 状态：进行中（有终端在跑）/ 历史（环境目录里留下的记录，可以接着开）
 *   · 环境：顶部筛选，「全部」时按环境分组，每组用环境自己的标识色
 * 会话和环境是一对多 —— 平铺一张大表就看不出哪条是哪个号开的。
 */
export default function Sessions(p: Props) {
  const [tab, setTab] = useState<Tab>("live");
  const [env, setEnv] = useState<string>("all");
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const menu = useContextMenu();

  const liveMenu = (w: ShellWindow): MenuItem[] => {
    const same = p.windows.filter((x) => x.accountId === w.accountId);
    const acc = p.accounts.find((a) => a.id === w.accountId);
    return [
      { label: tr("打开", "Open"), icon: <IconTerminal size={14} />, hint: "↵", run: () => p.onOpen(w.id) },
      { label: tr("重命名", "Rename"), icon: <IconEdit />, run: () => setRenaming(w.id) },
      "sep",
      { label: tr("复制目录路径", "Copy folder path"), icon: <IconCopy size={14} />, run: () => p.onCopy(w.cwd) },
      { label: tr("在访达中打开", "Reveal in Finder"), icon: <IconFolder size={14} />, run: () => p.onReveal(w.cwd) },
      { label: tr(`编辑环境「${acc?.label ?? ""}」…`, `Edit environment "${acc?.label ?? ""}"…`), icon: <IconGear size={14} />, run: () => p.onEditAccount(w.accountId) },
      "sep",
      { label: tr("关闭会话", "Close session"), icon: <IconClose size={14} />, danger: true, run: () => p.onRequestClose(w.id) },
      {
        label: tr(`关闭「${acc?.label ?? ""}」的全部会话`, `Close all sessions in "${acc?.label ?? ""}"`),
        danger: true,
        disabled: same.length < 2,
        run: () => p.onCloseMany(same.map((x) => x.id), tr(`「${acc?.label ?? ""}」的 ${same.length} 个会话`, `${same.length} sessions in "${acc?.label ?? ""}"`)),
      },
    ];
  };
  const histMenu = (a: Account, s: SessionSummary): MenuItem[] => [
    { label: tr("在原目录接着开", "Resume in original folder"), icon: <IconTerminal size={14} />, hint: "↵", run: () => p.onResume(a.id, s.cwd) },
    "sep",
    { label: tr("复制目录路径", "Copy folder path"), icon: <IconCopy size={14} />, run: () => p.onCopy(s.cwd) },
    { label: tr("在访达中打开", "Reveal in Finder"), icon: <IconFolder size={14} />, run: () => p.onReveal(s.cwd) },
  ];

  // 切到历史时，把要看的环境都读一遍（读过的不重读）
  useEffect(() => {
    if (tab !== "history") return;
    for (const a of p.accounts) {
      if ((env === "all" || env === a.id) && p.history[a.id] === undefined) p.onLoadHistory(a.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, env, p.accounts]);

  const liveBy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const w of p.windows) m[w.accountId] = (m[w.accountId] ?? 0) + 1;
    return m;
  }, [p.windows]);

  const kw = q.trim().toLowerCase();
  const groups = p.accounts
    .filter((a) => env === "all" || env === a.id)
    .map((a) => {
      const live = p.windows
        .filter((w) => w.accountId === a.id)
        .filter((w) => !kw || `${w.title} ${w.cwd}`.toLowerCase().includes(kw))
        .sort((x, y) => y.lastActivityAt - x.lastActivityAt);
      const hist = (p.history[a.id] ?? [])
        .filter((s) => !kw || `${s.title} ${s.cwd}`.toLowerCase().includes(kw))
        .sort((x, y) => y.lastActive - x.lastActive);
      return { a, live, hist, loading: p.history[a.id] === undefined };
    })
    .filter((g) => (tab === "live" ? g.live.length > 0 : g.hist.length > 0 || g.loading));

  const liveTotal = p.windows.length;
  const histTotal = p.accounts.reduce((n, a) => n + (p.history[a.id]?.length ?? 0), 0);

  // 「进行中 / 历史」的选中底色滑动
  const segRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = segRef.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab, liveTotal, histTotal]);

  return (
    <>
      <div className="wh">
        <span className="acts">
          <button className="ib" title={tr("搜索 ⌘K", "Search ⌘K")} onClick={p.onSearch}>
            <IconSearch />
          </button>
        </span>
      </div>

      <div className="sv">
        <div className="sv-h">
          <div>
            <h1>{tr("会话", "Sessions")}</h1>
            <p>
              {tr(`${liveTotal} 个进行中 · ${p.accounts.length} 个环境`, `${liveTotal} active · ${p.accounts.length} environments`)}
            </p>
          </div>
          <button className="btn pri" onClick={p.onNew}>
            <IconPlus />
            {tr("新建会话", "New session")}
          </button>
        </div>

        <div className="sv-bar">
          <div className="envtabs sv-seg" ref={segRef}>
            {ind && <i className="envtabs-ind" style={{ transform: `translateX(${ind.left}px)`, width: ind.width }} />}
            <button data-tab="live" className={`envtab${tab === "live" ? " on" : ""}`} onClick={() => setTab("live")}>
              <IconTerminal size={13} />
              {tr("进行中", "Active")}
              <em>{liveTotal || ""}</em>
            </button>
            <button data-tab="history" className={`envtab${tab === "history" ? " on" : ""}`} onClick={() => setTab("history")}>
              <IconClock size={13} />
              {tr("历史", "History")}
              <em>{histTotal || ""}</em>
            </button>
          </div>
          <Help title={tr("进行中和历史有什么区别？", "What is the difference between Active and History?")}>
            <p>
              <b>{tr("进行中", "Active")}</b>{tr("：现在开着终端的会话，点一下切过去。关掉会结束终端进程（会先问你）。", ": sessions with a terminal open right now. Click one to switch to it. Closing one ends its terminal process (you will be asked first).")}
            </p>
            <p>
              <b>{tr("历史", "History")}</b>{tr("：环境目录里留下的旧对话。点一下会在原来的目录里重新开一个会话接着干。", ": past conversations stored in the environment folder. Click one to start a new session in its original folder and pick up where you left off.")}
            </p>
          </Help>

          <div className="sv-filter">
            <button className={`sv-chip${env === "all" ? " on" : ""}`} onClick={() => setEnv("all")}>
              {tr("全部环境", "All environments")}
            </button>
            {p.accounts.map((a) => (
              <button
                key={a.id}
                className={`sv-chip${env === a.id ? " on" : ""}`}
                onClick={() => setEnv(a.id)}
                style={{ "--c": a.tint } as CSSProperties}
              >
                <span className="av xs" style={{ background: a.tint }}>
                  {a.label.slice(0, 1)}
                </span>
                {a.label}
                {tab === "live" && liveBy[a.id] ? <em>{liveBy[a.id]}</em> : null}
              </button>
            ))}
          </div>

          <input className="sv-q" value={q} placeholder={tr("筛选名字或目录", "Filter by name or folder")} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="sv-body" key={`${tab}-${env}`}>
          {groups.length === 0 ? (
            <div className="sv-empty">
              {kw
                ? tr("没有匹配的会话。", "No matching sessions.")
                : tab === "live"
                  ? tr("没有正在跑的会话。去首页选个环境，写一句回车就能开一个。", "No active sessions. Pick an environment on Home, type a message and press Enter to start one.")
                  : tr("这些环境里还没有历史会话。", "No history in these environments yet.")}
              {tab === "live" && !kw && (
                <button className="btn" onClick={p.onNew}>
                  <IconPlus />
                  {tr("新建会话", "New session")}
                </button>
              )}
            </div>
          ) : (
            groups.map(({ a, live, hist, loading }) => (
              <section className="sv-grp" key={a.id} style={{ "--c": a.tint } as CSSProperties}>
                <div className="sv-grp-h">
                  <span className="av xs" style={{ background: a.tint }}>
                    {a.label.slice(0, 1)}
                  </span>
                  <b>{a.label}</b>
                  <span className="mono">~/{a.configDir}</span>
                  <span className="sv-grp-n">
                    {tab === "live" ? tr(`${live.length} 个进行中`, `${live.length} active`) : loading ? tr("读取中…", "Loading…") : tr(`${hist.length} 条记录`, `${hist.length} records`)}
                  </span>
                  {tab === "history" && (
                    <button className="det-k" title={tr("重新读取", "Reload")} onClick={() => p.onLoadHistory(a.id)}>
                      <IconRefresh size={12} />
                    </button>
                  )}
                </div>

                <div className="sv-list">
                  {tab === "live"
                    ? live.map((w) => (
                        <div
                          key={w.id}
                          className={`sv-row${w.id === p.activeWindowId ? " on" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => renaming !== w.id && p.onOpen(w.id)}
                          onDoubleClick={() => setRenaming(w.id)}
                          onContextMenu={(e) => menu.open(e, liveMenu(w), w.title)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && renaming !== w.id) p.onOpen(w.id);
                          }}
                          title={`${w.cwd}\n${tr("双击重命名 · 右键更多", "Double-click to rename · right-click for more")}`}
                        >
                          {/* 跟 Claude 的对话列表一样只有文字：标题一行，目录和类型一行，不画图标 */}
                          <span className="sv-nm">
                            {renaming === w.id ? (
                              <RenameInput
                                value={w.title}
                                onDone={(v) => {
                                  if (v) p.onRename(w.id, v);
                                  setRenaming(null);
                                }}
                              />
                            ) : (
                              <b>{w.title}</b>
                            )}
                            <small>
                              <span className="mono">{shortenHome(w.cwd)}</span>
                              <span className="sv-kind">{w.runsClaude ? "Claude Code" : tr("终端", "Terminal")}</span>
                            </small>
                          </span>
                          <span className="sv-tm">
                            <span>{tr("已运行", "Running")} {fmtDuration((Date.now() - w.startedAt) / 1000)}</span>
                            <small>{tr(`${shortTime(w.lastActivityAt)} 活动`, `Active ${shortTime(w.lastActivityAt)}`)}</small>
                          </span>
                          <button
                            className="mh-x sv-more-btn"
                            title={tr("更多", "More")}
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              menu.open({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => e.stopPropagation() }, liveMenu(w), w.title);
                            }}
                          >
                            <IconDots size={13} />
                          </button>
                          <button
                            className="mh-x"
                            title={tr("关闭会话", "Close session")}
                            onClick={(e) => {
                              e.stopPropagation();
                              p.onRequestClose(w.id);
                            }}
                          >
                            <IconClose size={12} />
                          </button>
                        </div>
                      ))
                    : hist.slice(0, 40).map((s) => (
                        <div
                          key={s.id}
                          className="sv-row"
                          role="button"
                          tabIndex={0}
                          onClick={() => p.onResume(a.id, s.cwd)}
                          onContextMenu={(e) => menu.open(e, histMenu(a, s), s.title)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") p.onResume(a.id, s.cwd);
                          }}
                          title={`${s.cwd}\n${tr("点一下在原目录里接着开", "Click to resume in the original folder")}`}
                        >
                          <span className="sv-nm">
                            <b>{s.title}</b>
                            <small className="mono">{shortenHome(s.cwd)}</small>
                          </span>
                          <span className="sv-tm">
                            <span>{relTime(s.lastActive)}</span>
                            <small>{fmtSize(s.sizeBytes)}</small>
                          </span>
                          <span className="sv-go">{tr("接着开", "Resume")}</span>
                        </div>
                      ))}
                </div>
                {tab === "history" && hist.length > 40 && <div className="sv-more">{tr(`还有 ${hist.length - 40} 条更早的记录`, `${hist.length - 40} older records not shown`)}</div>}
              </section>
            ))
          )}
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

function fmtSize(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
