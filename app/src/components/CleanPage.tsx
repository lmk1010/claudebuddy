import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CleanupAccount, CleanupResult, CleanupSurvey, DesktopProbe, LeakReport, RiskItem, RiskReport } from "../lib/bridge";
import { tierLabel } from "../lib/model";
import { ConfirmDialog } from "./Modal";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import Help from "./Help";
import { tr } from "../lib/i18n";
import { IconCheck, IconCopy, IconDots, IconFolder, IconKey, IconRefresh, IconSearch, IconTrash } from "./iconAliases";

/**
 * 清理本机 —— 单独一页，按表格排。
 *
 * 之前塞在设置里，一个目录占一大块（标题、说明、按钮各一行），六个目录就要滚两屏，
 * 几十个根本没法看。现在一行一个，能筛、能搜、能多选，批量清。
 *
 * 语义不变：目录移到 ~/.claude-buddy-trash（能捞回），Keychain 凭据删掉（不可恢复）。
 *
 * 默认 profile（~/.claude + 家目录的 ~/.claude.json）**也能整块清掉**。
 * 它是唯一能绕开隔离的入口：裸跑 claude 用的就是它，不走任何环境的代理、
 * 身份和终端画像；而且常常指向一个已经废掉的号。清掉之后裸 claude 会重新
 * 生成一套全新身份 —— 那不是更安全，只是把同一个问题换了个壳。
 * 所以确认框里要把这句话说透：真正干净的状态是只用本软件启动会话。
 */

type Filter = "all" | "clean" | "signed-out" | "ok";

/** 表格里的一行：配置目录或无人认领的凭据 */
type Item =
  | { key: string; type: "dir"; a: CleanupAccount }
  | { key: string; type: "orphan"; service: string; reason: string };

/** 函数而不是常量：文案要跟着当前语言走 */
function stateOf(s: CleanupAccount["state"]): { text: string; tone: "ok" | "mid" | "bad" } {
  switch (s) {
    case "ok":
      return { text: tr("正常", "OK"), tone: "ok" };
    // 掉登录不等于该删：目录里可能存着大量对话，重新登录就能接着用
    case "signed-out":
      return { text: tr("掉登录", "Signed out"), tone: "mid" };
    default:
      return { text: tr("空壳", "Empty"), tone: "bad" };
  }
}

function kindOf(k: CleanupAccount["kind"]): string {
  switch (k) {
    case "default":
      return tr("默认目录", "Default folder");
    case "claude-dir":
      return tr("配置目录", "Config folder");
    default:
      return tr("其他工具", "Other tool");
  }
}

function bytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function when(ts: number) {
  if (!ts) return tr("从未", "Never");
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return tr("今天", "Today");
  if (days === 1) return tr("昨天", "Yesterday");
  if (days < 30) return tr(`${days} 天前`, `${days}d ago`);
  return new Date(ts).toLocaleDateString(tr("zh-CN", "en-US"), { month: "numeric", day: "numeric" });
}

function shortPath(p: string) {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

/** onPurged：被移走的目录绝对路径，上层据此把对应的环境从列表里摘掉 */
export default function CleanPage({
  onPurged,
  inUse,
  onRelogin,
  onFix,
}: {
  onPurged: (movedPaths: string[]) => void;
  /** 清完凭据后的下一步：去重新登录（清理 → 授权 是同一件事的前后两步） */
  onRelogin: () => void;
  /** 本应用里还有会话开着的配置目录名（如 .claude-work）—— 清它等于把正在跑的会话的登录拔掉 */
  inUse: string[];
  /** 漏斗清单里的“去处理”：交给上层跳转（配出口 / 轮换设备码 / 清痕迹） */
  onFix?: (fix: { kind: "open-network" | "open-clean" | "rotate-identity"; accountId?: string }) => void;
}) {
  const busyDir = (p: string) => inUse.includes(p.replace(/^.*\//, ""));
  const [survey, setSurvey] = useState<CleanupSurvey | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Item[] | null>(null);
  const [last, setLast] = useState<CleanupResult | null>(null);
  /** Claude Desktop 的本地体检 —— 它不归环境管，这里只展示不提供删除 */
  const [desk, setDesk] = useState<DesktopProbe | null>(null);
  /** UDP / STUN 泄漏面 —— 同一道体检拿回来 */
  const [leak, setLeak] = useState<LeakReport | null>(null);
  /** 风控陷阱清单 */
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [riskOpen, setRiskOpen] = useState(false);
  const menu = useContextMenu();

  useEffect(() => {
    let alive = true;
    void window.claudeBuddy.desktopProbe().then(
      (r) => {
        if (alive) setDesk(r);
      },
      () => {
        /* 探测失败就不显示这一块 */
      },
    );
    void window.claudeBuddy.leakProbe().then(
      (r) => {
        if (alive) setLeak(r);
      },
      () => {
        /* 体检失败就不显示 */
      },
    );
    void window.claudeBuddy.riskAudit().then(
      (r) => {
        if (alive) setRisk(r);
      },
      () => {
        /* 清单拿不到就不显示 */
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const s = await window.claudeBuddy.cleanupSurvey();
      if (!s.ok) setErr(tr("主进程还没准备好，请用 npm run app 启动。", "The main process is not ready. Start the app with npm run app."));
      else setSurvey(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items: Item[] = useMemo(() => {
    if (!survey) return [];
    return [
      ...survey.accounts.map((a): Item => ({ key: a.id, type: "dir", a })),
      ...survey.orphans.map((o): Item => ({ key: `svc:${o.service}`, type: "orphan", service: o.service, reason: o.reason })),
    ];
  }, [survey]);

  const suggested = useMemo(
    () => new Set([...(survey?.suggested.accountIds ?? []), ...(survey?.suggested.services ?? []).map((s) => `svc:${s}`)]),
    [survey],
  );

  const count = (f: Filter) =>
    items.filter((it) =>
      f === "all"
        ? true
        : f === "clean"
          ? suggested.has(it.key)
          : it.type === "dir" && it.a.state === f,
    ).length;

  const kw = q.trim().toLowerCase();
  const shown = items.filter((it) => {
    if (filter === "clean" && !suggested.has(it.key)) return false;
    if ((filter === "signed-out" || filter === "ok") && (it.type !== "dir" || it.a.state !== filter)) return false;
    if (!kw) return true;
    const hay = it.type === "dir" ? `${it.a.email ?? ""} ${it.a.name} ${it.a.path}` : it.service;
    return hay.toLowerCase().includes(kw);
  });

  const totalSize = survey?.accounts.reduce((s, a) => s + a.sizeBytes, 0) ?? 0;
  const selItems = items.filter((it) => sel.has(it.key));
  const allShownSel = shown.length > 0 && shown.every((it) => sel.has(it.key));

  const toggle = (k: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const purge = async (list: Item[]) => {
    setConfirm(null);
    setBusy(true);
    try {
      const r = await window.claudeBuddy.cleanupPurge({
        accountIds: list.flatMap((it) => (it.type === "dir" ? [it.a.id] : [])),
        services: list.flatMap((it) => (it.type === "orphan" ? [it.service] : [])),
        allowMainKeychain: list.some((it) => (it.type === "dir" && it.a.kind === "default") || it.type === "orphan"),
        /**
         * 默认 profile 也允许清，但只在用户明确选了它时才放行。
         * 主进程那边还会再要一次这个标志 —— 界面的勾选不能单独决定，
         * 否则一次误点就能把主配置挪走。
         */
        allowDefault: list.some((it) => it.type === "dir" && it.a.kind === "default"),
      });
      setLast(r);
      setSel(new Set());
      const byId = new Map(survey?.accounts.map((a) => [a.id, a.path]) ?? []);
      onPurged(r.moved.map((m) => byId.get(m.id)).filter((p): p is string => Boolean(p)));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rowMenu = (it: Item): MenuItem[] =>
    it.type === "dir"
      ? [
          { label: tr("在访达中打开", "Show in Finder"), icon: <IconFolder size={14} />, run: () => void window.claudeBuddy.reveal(it.a.path) },
          { label: tr("复制路径", "Copy path"), icon: <IconCopy size={14} />, run: () => void navigator.clipboard.writeText(it.a.path).catch(() => {}) },
          "sep",
          { label: tr("清理…", "Clean up…"), icon: <IconTrash size={14} />, danger: true, run: () => setConfirm([it]) },
        ]
      : [
          { label: tr("复制条目名", "Copy entry name"), icon: <IconCopy size={14} />, run: () => void navigator.clipboard.writeText(it.service).catch(() => {}) },
          "sep",
          { label: tr("删除这条凭据…", "Delete this credential…"), icon: <IconTrash size={14} />, danger: true, run: () => setConfirm([it]) },
        ];

  // 筛选条的滑块
  const segRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = segRef.current?.querySelector<HTMLElement>(`[data-f="${filter}"]`);
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [filter, survey]);

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: tr("全部", "All") },
    { id: "clean", label: tr("建议清理", "Suggested") },
    { id: "signed-out", label: tr("掉登录", "Signed out") },
    { id: "ok", label: tr("正常", "OK") },
  ];

  return (
    <>
      <div className="wh" />

      <div className="sv cl">
        <div className="sv-h">
          <div>
            <h1>{tr("清理本机", "Clean up this Mac")}</h1>
            <p>
              {survey
                ? tr(
                    `${survey.accounts.length} 个配置目录 · 共 ${bytes(totalSize)}${survey.orphans.length ? ` · ${survey.orphans.length} 条无人认领的凭据` : ""}`,
                    `${survey.accounts.length} config folders · ${bytes(totalSize)} total${survey.orphans.length ? ` · ${survey.orphans.length} unclaimed credentials` : ""}`,
                  )
                : busy
                  ? tr("正在扫描这台电脑…", "Scanning this Mac…")
                  : tr("还没扫描", "Not scanned yet")}
            </p>
          </div>
          <div className="pg-acts">
            <button className="btn" onClick={() => void load()} disabled={busy}>
              <IconRefresh />
              {busy ? tr("扫描中…", "Scanning…") : tr("重新扫描", "Rescan")}
            </button>
            <button
              className="btn danger"
              disabled={busy || selItems.length === 0}
              onClick={() => setConfirm(selItems)}
            >
              <IconTrash />
              {selItems.length ? tr(`清理所选 ${selItems.length} 项`, `Clean ${selItems.length} selected`) : tr("清理所选", "Clean selected")}
            </button>
          </div>
        </div>

        {risk && risk.items.length > 0 && (
          <div className="rk">
            <button className={`rk-sum${riskOpen ? " open" : ""}`} onClick={() => setRiskOpen(!riskOpen)}>
              <b>{tr("风控体检", "Risk audit")}</b>
              <span className={`rk-pill ${risk.danger ? "bad" : risk.warn ? "mid" : "ok"}`}>
                {risk.danger
                  ? tr(`${risk.danger} 项会直接暴露`, `${risk.danger} exposures`)
                  : risk.warn
                    ? tr(`${risk.warn} 项要注意`, `${risk.warn} warnings`)
                    : tr("没有发现暴露", "No exposures found")}
              </span>
              {risk.unfixable > 0 && (
                <em>{tr(`其中 ${risk.unfixable} 项只能提醒你`, `${risk.unfixable} can only be reported`)}</em>
              )}
              <span className="rk-sp" />
              <span className="rk-chev">{riskOpen ? tr("收起", "Collapse") : tr("展开", "Expand")}</span>
            </button>

            {riskOpen && (
              <div className="rk-list">
                {risk.items.map((it: RiskItem) => (
                  <div key={it.key} className={`rk-i lv-${it.level}`}>
                    <div className="rk-t">
                      <b>{it.title}</b>
                      <span className={`rk-tag st-${it.status}`}>
                        {it.status === "risk"
                          ? tr("能改", "Fixable")
                          : it.status === "unfixable"
                            ? tr("只能看", "Read-only")
                            : it.status === "ok"
                              ? tr("已堵", "Closed")
                              : tr("信息", "Info")}
                      </span>
                      <em>{it.group}</em>
                    </div>
                    <p>{it.why}</p>
                    {it.detail && <p className="rk-d">{it.detail}</p>}
                    {it.fix && onFix && (
                      <button className="btn" onClick={() => it.fix && onFix(it.fix)}>
                        {tr("去处理 →", "Fix it →")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="sv-bar">
          <div className="envtabs sv-seg" ref={segRef}>
            {ind && <i className="envtabs-ind" style={{ transform: `translateX(${ind.left}px)`, width: ind.width }} />}
            {FILTERS.map((f) => (
              <button
                key={f.id}
                data-f={f.id}
                className={`envtab${filter === f.id ? " on" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <em>{survey ? count(f.id) || "" : ""}</em>
              </button>
            ))}
          </div>
          <Help title={tr("会清掉什么？", "What gets removed?")} wide>
            <p>{tr("扫的是这台电脑上所有 Claude Code 的配置目录（本应用建的环境、别的工具建的 prof_* 等），以及 Keychain 里没有目录认领的凭据。", "The scan covers every Claude Code config folder on this Mac (environments created by this app, prof_* folders from other tools, and so on), plus Keychain credentials that no folder claims.")}</p>
            <p>
              <b>{tr("目录", "Folders")}</b>
              {tr("会移到 ", " are moved to ")}
              <code>~/.claude-buddy-trash</code>
              {tr("，需要时能捞回来；", " and can be recovered if needed; ")}
              <b>{tr("Keychain 凭据", "Keychain credentials")}</b>
              {tr("删了就没了，要重新登录。", " are gone once deleted and you must sign in again.")}
            </p>
            <p>
              <b>{tr("默认 profile", "The default profile")}</b>
              {tr(
                "（~/.claude 加家目录的 ~/.claude.json）可以整块清掉。它是唯一能绕开隔离的入口 —— 裸跑 claude 用的就是它。清掉之后请在终端里改用本软件启动会话，不要直接跑 claude。",
                " (~/.claude plus ~/.claude.json in your home directory) can be removed as a whole. It is the only path that bypasses isolation — running claude directly uses it. After cleaning, launch sessions through this app instead of running claude directly.",
              )}
            </p>
            <p>
              {tr("「建议清理」= 空壳目录和无人认领的凭据，放心清。", "\"Suggested\" means empty folders and unclaimed credentials, which are safe to clean.")}
            </p>
          </Help>
          <span className="sv-sp" />
          <label className="cl-q">
            <IconSearch size={13} />
            <input value={q} placeholder={tr("筛选邮箱或目录", "Filter by email or folder")} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        {err && <div className="cl-err">{err}</div>}

        {last && (
          <div className="cl-done">
            <IconCheck size={14} />
            <span>
              {tr(`移走 ${last.moved.length} 个目录 · 删除 ${last.keychainDeleted.length} 条凭据`, `Moved ${last.moved.length} folders · deleted ${last.keychainDeleted.length} credentials`)}
              {last.failed.length
                ? tr(
                    ` · ${last.failed.length} 项没完成：${last.failed.map((f) => f.reason).join("；")}`,
                    ` · ${last.failed.length} not completed: ${last.failed.map((f) => f.reason).join("; ")}`,
                  )
                : ""}
            </span>
            {last.moved.length > 0 && (
              <button className="det-k" onClick={() => void window.claudeBuddy.reveal(last.trashRoot)}>
                {tr("打开回收目录", "Open trash folder")}
              </button>
            )}
            {last.keychainDeleted.length > 0 && (
              <button className="btn pri" onClick={onRelogin}>
                {tr("去重新登录 →", "Sign in again →")}
              </button>
            )}
            <button className="det-k" onClick={() => setLast(null)}>
              {tr("知道了", "Got it")}
            </button>
          </div>
        )}

        <div className="cl-table" key={filter}>
          <div className="cl-tr cl-th">
            <span className="cl-ck">
              <input
                type="checkbox"
                checked={allShownSel}
                disabled={shown.length === 0}
                onChange={() =>
                  setSel((s) => {
                    const n = new Set(s);
                    if (allShownSel) shown.forEach((it) => n.delete(it.key));
                    else shown.forEach((it) => n.add(it.key));
                    return n;
                  })
                }
                aria-label={tr("全选", "Select all")}
              />
            </span>
            <span className="cl-name">{tr("账号 / 目录", "Account / folder")}</span>
            <span className="cl-st">{tr("状态", "Status")}</span>
            <span className="cl-num">{tr("大小", "Size")}</span>
            <span className="cl-num">{tr("对话", "Chats")}</span>
            <span className="cl-num">{tr("最后活动", "Last active")}</span>
            <span className="cl-act" />
          </div>

          {shown.length === 0 ? (
            <div className="cl-empty">
              {busy ? tr("正在扫描…", "Scanning…") : filter === "clean" ? tr("没有需要清理的东西，这台电脑挺干净。", "Nothing to clean up. This Mac looks tidy.") : tr("没有匹配的条目。", "No matching items.")}
            </div>
          ) : (
            shown.map((it) => {
              const on = sel.has(it.key);
              return (
                <div
                  key={it.key}
                  className={`cl-tr${on ? " on" : ""}`}
                  onClick={() => toggle(it.key)}
                  onContextMenu={(e) => menu.open(e, rowMenu(it), it.type === "dir" ? (it.a.email ?? it.a.name) : it.service)}
                >
                  <span className="cl-ck">
                    <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                  </span>
                  {it.type === "dir" ? (
                    <>
                      <span className="cl-name">
                        <span className={`cl-ic${it.a.state === "ok" ? " ok" : ""}`}>
                          <IconFolder size={13} />
                        </span>
                        <span className="cl-nm">
                          <b>
                            {it.a.email ?? it.a.name}
                            {busyDir(it.a.path) && <span className="cl-live">{tr("有会话在跑", "Session running")}</span>}
                          </b>
                          <small className="mono" title={it.a.path}>
                            {shortPath(it.a.path)}
                            {" · "}
                            {kindOf(it.a.kind)}
                            {it.a.tier ? ` · ${tierLabel(it.a.tier)}` : ""}
                          </small>
                          {/**
                           * 默认 profile 的配置在目录外面。
                           * 不显示的话，用户看到「4.9 GB」会以为只有这些，
                           * 实际清的时候还会动家目录那份带账号记录的配置。
                           */}
                          {it.a.configPath && (
                            <small className="cl-extra">
                              {tr("另含 ", "plus ")}
                              <span className="mono">{shortPath(it.a.configPath)}</span>
                              {it.a.configSize ? ` · ${bytes(it.a.configSize)}` : ""}
                            </small>
                          )}
                        </span>
                      </span>
                      <span className="cl-st">
                        <span className={`nr-tag ${stateOf(it.a.state).tone}`}>{stateOf(it.a.state).text}</span>
                      </span>
                      <span className="cl-num mono">{bytes(it.a.sizeBytes)}</span>
                      <span className="cl-num mono">{it.a.sessions || "—"}</span>
                      <span className="cl-num">{when(it.a.lastActive)}</span>
                    </>
                  ) : (
                    <>
                      <span className="cl-name">
                        <span className="cl-ic">
                          <IconKey size={13} />
                        </span>
                        <span className="cl-nm">
                          <b className="mono">{it.service}</b>
                          <small>{it.reason}</small>
                        </span>
                      </span>
                      <span className="cl-st">
                        <span className="nr-tag mid">{tr("无人认领", "Unclaimed")}</span>
                      </span>
                      <span className="cl-num">—</span>
                      <span className="cl-num">—</span>
                      <span className="cl-num">—</span>
                    </>
                  )}
                  <span className="cl-act">
                    <button
                      className="mh-x cl-more"
                      title={tr("更多", "More")}
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        menu.open(
                          { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => {} },
                          rowMenu(it),
                          it.type === "dir" ? (it.a.email ?? it.a.name) : it.service,
                        );
                      }}
                    >
                      <IconDots size={13} />
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {desk?.installed && desk.exists && (
        <div className="cl-desktop">
          <div className="cl-desktop-h">
            <b>{tr("Claude Desktop", "Claude Desktop")}</b>
            <span className={`cl-pill ${desk.running ? "bad" : "mid"}`}>
              {desk.running ? tr("正在运行", "Running") : tr("没在运行", "Not running")}
            </span>
            {desk.hasSafeStorage && <span className="cl-pill mid">{tr("有登录痕迹", "Sign-in traces")}</span>}
            <span className="cl-sp" />
            <span className="mono">
              {bytes(desk.sizeBytes ?? 0)} · {desk.lastActiveAt ? when(desk.lastActiveAt) : tr("从未", "Never")}
            </span>
            <button className="det-k" onClick={() => void window.claudeBuddy.reveal(desk.supportDir ?? "")}>
              {tr("在访达中打开", "Show in Finder")}
            </button>
          </div>
          <p>
            {tr(
              "桌面端不在任何环境的管辖范围内：它的 Cookies、IndexedDB、Safe Storage 都是整机一份，无论开多少个环境，它在服务端就是同一台机器上的另一个身份。所以这里只告诉你它在不了、什么时候动过，不替你做主 —— 删它会把你 Desktop 那边踢下线，要不要这样做取决于你。",
              "Desktop sits outside every environment: its cookies, IndexedDB and Safe Storage are shared machine-wide, so whatever the number of environments, it is still another identity on this machine. So this panel only reports what is there and when it last changed; it does not act for you, because removing it would sign you out of Desktop.",
            )}
          </p>
          <p className="dim">
            {tr(
              "要用这个软件做隔离测试，建议先在 Desktop 里退出登录，测完再登回去。",
              "If you are testing isolation with this app, sign out in Desktop first and sign back in afterwards.",
            )}
          </p>
          {leak && (
            <p className={leak.stunDetected ? "cl-leak bad" : "dim"}>
              {leak.stunDetected
                ? tr(
                    "⚠ 检测到 STUN：有程序正在用 UDP 问公网 IP，代理盖不住它，真实出口已暴露。",
                    "⚠ STUN detected: something is asking for the public IP over UDP, which proxies do not cover. The real exit is exposed.",
                  )
                : tr(
                    "UDP / STUN：未发现异常（STUN 会用 UDP 问出真实公网 IP，代理盖不住它）。",
                    "UDP / STUN: nothing abnormal (STUN asks for the public IP over UDP, which proxies do not cover).",
                  )}
            </p>
          )}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={tr(`清理 ${confirm.length} 项？`, `Clean up ${confirm.length} items?`)}
          danger
          okLabel={tr("清理", "Clean up")}
          body={<ConfirmBody list={confirm} busy={confirm.filter((it) => it.type === "dir" && busyDir(it.a.path)).length} />}
          onOk={() => void purge(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
      {menu.node}
    </>
  );
}

/**
 * 确认框里把每一项会发生什么写清楚。
 *
 * 默认目录单独一段，语气比其他项重：它清掉的是"裸跑 claude 用的那套身份"，
 * 清完不是"少了一个号"，而是"这台机器上只剩软件里那几个隔离环境"。
 * 这句话必须说透，否则用户会以为只是删了个目录。
 */
function ConfirmBody({ list, busy }: { list: Item[]; busy: number }) {
  const dirs = list.filter((it): it is Extract<Item, { type: "dir" }> => it.type === "dir");
  const def = dirs.find((it) => it.a.kind === "default");
  const moved = dirs.filter((it) => it.a.kind !== "default");
  const orphans = list.filter((it) => it.type === "orphan");
  const live = dirs.filter((it) => it.a.state === "ok" && it.a.kind !== "default");
  return (
    <div className="cl-confirm">
      {moved.length > 0 && <p>{tr(`· ${moved.length} 个目录移到 ~/.claude-buddy-trash（能捞回），它们的 Keychain 凭据一并删除。`, `· ${moved.length} folders will be moved to ~/.claude-buddy-trash (recoverable), and their Keychain credentials deleted.`)}</p>}
      {def && (
        <>
          <p>
            {tr(
              `· 默认 profile 会整块移走：~/.claude 目录，以及家目录的 ~/.claude.json（里面躺着 ${def.a.email ?? "当前账号"} 的账号记录、设备码、会话历史）。`,
              `· The default profile is moved as a whole: the ~/.claude folder plus ~/.claude.json in your home directory (which holds ${def.a.email ?? "the current account"}'s account record, device ID and session history).`,
            )}
          </p>
          <p className="warn">
            {tr(
              "清完之后，直接在终端里跑 claude 会重新生成一套全新身份 —— 那不是更安全，只是把同一个问题换了个壳。真正干净的状态是：只用本软件启动会话，每个环境各走各的身份和出口。",
              "After cleaning, running claude directly in a terminal will generate a brand-new identity — that is not safer, it just re-creates the same problem under a new shell. The clean state is: only launch sessions through this app, each environment with its own identity and exit.",
            )}
          </p>
        </>
      )}
      {orphans.length > 0 && <p>{tr(`· 删除 ${orphans.length} 条无人认领的 Keychain 凭据。`, `· ${orphans.length} unclaimed Keychain credentials will be deleted.`)}</p>}
      {live.length > 0 && (
        <p className="warn">
          {tr(
            `其中 ${live.length} 个是正常登录着的账号（${live.map((it) => it.a.email ?? it.a.name).join("、")}），清掉后要重新登录。`,
            `${live.length} of these are accounts currently signed in (${live.map((it) => it.a.email ?? it.a.name).join(", ")}). You will need to sign in again after cleaning.`,
          )}
        </p>
      )}
      {busy > 0 && <p className="warn">{tr(`其中 ${busy} 个目录还有会话开着，清掉后那些会话会立刻掉登录，建议先关掉。`, `${busy} of these folders still have open sessions, which will be signed out immediately. Close them first.`)}</p>}
      <p className="dim">{tr("Keychain 凭据删了不可恢复。", "Deleted Keychain credentials cannot be recovered.")}</p>
    </div>
  );
}
