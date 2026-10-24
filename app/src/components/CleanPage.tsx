import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CleanupAccount, CleanupResult, CleanupSurvey } from "../lib/bridge";
import { tierLabel } from "../lib/model";
import { ConfirmDialog } from "./Modal";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import Help from "./Help";
import { IconCheck, IconCopy, IconDots, IconFolder, IconKey, IconRefresh, IconSearch, IconTrash } from "./iconAliases";

/**
 * 清理本机 —— 单独一页，按表格排。
 *
 * 之前塞在设置里，一个目录占一大块（标题、说明、按钮各一行），六个目录就要滚两屏，
 * 几十个根本没法看。现在一行一个，能筛、能搜、能多选，批量清。
 *
 * 语义不变：目录移到 ~/.claude-buddy-trash（能捞回），Keychain 凭据删掉（不可恢复）。
 * 默认目录（~/.claude）不会被挪走，只能清它的登录凭据 —— 确认框里会单独点名。
 */

type Filter = "all" | "clean" | "signed-out" | "ok";

/** 表格里的一行：配置目录或无人认领的凭据 */
type Item =
  | { key: string; type: "dir"; a: CleanupAccount }
  | { key: string; type: "orphan"; service: string; reason: string };

const STATE: Record<CleanupAccount["state"], { text: string; tone: "ok" | "mid" | "bad" }> = {
  ok: { text: "正常", tone: "ok" },
  // 掉登录不等于该删：目录里可能存着大量对话，重新登录就能接着用
  "signed-out": { text: "掉登录", tone: "mid" },
  empty: { text: "空壳", tone: "bad" },
};

const KIND: Record<CleanupAccount["kind"], string> = {
  default: "默认目录",
  "claude-dir": "配置目录",
  "codex-profile": "其他工具",
};

function bytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function when(ts: number) {
  if (!ts) return "从未";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
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
}: {
  onPurged: (movedPaths: string[]) => void;
  /** 清完凭据后的下一步：去重新登录（清理 → 授权 是同一件事的前后两步） */
  onRelogin: () => void;
  /** 本应用里还有会话开着的配置目录名（如 .claude-work）—— 清它等于把正在跑的会话的登录拔掉 */
  inUse: string[];
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
  const menu = useContextMenu();

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const s = await window.claudeBuddy.cleanupSurvey();
      if (!s.ok) setErr("主进程还没准备好，请用 npm run app 启动。");
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
          { label: "在访达中打开", icon: <IconFolder size={14} />, run: () => void window.claudeBuddy.reveal(it.a.path) },
          { label: "复制路径", icon: <IconCopy size={14} />, run: () => void navigator.clipboard.writeText(it.a.path).catch(() => {}) },
          "sep",
          { label: it.a.kind === "default" ? "清掉登录凭据…" : "清理…", icon: <IconTrash size={14} />, danger: true, run: () => setConfirm([it]) },
        ]
      : [
          { label: "复制条目名", icon: <IconCopy size={14} />, run: () => void navigator.clipboard.writeText(it.service).catch(() => {}) },
          "sep",
          { label: "删除这条凭据…", icon: <IconTrash size={14} />, danger: true, run: () => setConfirm([it]) },
        ];

  // 筛选条的滑块
  const segRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = segRef.current?.querySelector<HTMLElement>(`[data-f="${filter}"]`);
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [filter, survey]);

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "clean", label: "建议清理" },
    { id: "signed-out", label: "掉登录" },
    { id: "ok", label: "正常" },
  ];

  return (
    <>
      <div className="wh" />

      <div className="sv cl">
        <div className="sv-h">
          <div>
            <h1>清理本机</h1>
            <p>
              {survey
                ? `${survey.accounts.length} 个配置目录 · 共 ${bytes(totalSize)}${survey.orphans.length ? ` · ${survey.orphans.length} 条无人认领的凭据` : ""}`
                : busy
                  ? "正在扫描这台电脑…"
                  : "还没扫描"}
            </p>
          </div>
          <div className="pg-acts">
            <button className="btn" onClick={() => void load()} disabled={busy}>
              <IconRefresh />
              {busy ? "扫描中…" : "重新扫描"}
            </button>
            <button
              className="btn danger"
              disabled={busy || selItems.length === 0}
              onClick={() => setConfirm(selItems)}
            >
              <IconTrash />
              {selItems.length ? `清理所选 ${selItems.length} 项` : "清理所选"}
            </button>
          </div>
        </div>

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
          <Help title="会清掉什么？" wide>
            <p>扫的是这台电脑上所有 Claude Code 的配置目录（本应用建的环境、别的工具建的 prof_* 等），以及 Keychain 里没有目录认领的凭据。</p>
            <p>
              <b>目录</b>会移到 <code>~/.claude-buddy-trash</code>，需要时能捞回来；<b>Keychain 凭据</b>删了就没了，要重新登录。
            </p>
            <p>
              <b>默认目录</b>（~/.claude）不会被挪走，只清它的登录凭据。「建议清理」= 空壳目录和无人认领的凭据，放心清。
            </p>
          </Help>
          <span className="sv-sp" />
          <label className="cl-q">
            <IconSearch size={13} />
            <input value={q} placeholder="筛选邮箱或目录" onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        {err && <div className="cl-err">{err}</div>}

        {last && (
          <div className="cl-done">
            <IconCheck size={14} />
            <span>
              移走 {last.moved.length} 个目录 · 删除 {last.keychainDeleted.length} 条凭据
              {last.failed.length ? ` · ${last.failed.length} 项没完成：${last.failed.map((f) => f.reason).join("；")}` : ""}
            </span>
            {last.moved.length > 0 && (
              <button className="det-k" onClick={() => void window.claudeBuddy.reveal(last.trashRoot)}>
                打开回收目录
              </button>
            )}
            {last.keychainDeleted.length > 0 && (
              <button className="btn pri" onClick={onRelogin}>
                去重新登录 →
              </button>
            )}
            <button className="det-k" onClick={() => setLast(null)}>
              知道了
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
                aria-label="全选"
              />
            </span>
            <span className="cl-name">账号 / 目录</span>
            <span className="cl-st">状态</span>
            <span className="cl-num">大小</span>
            <span className="cl-num">对话</span>
            <span className="cl-num">最后活动</span>
            <span className="cl-act" />
          </div>

          {shown.length === 0 ? (
            <div className="cl-empty">
              {busy ? "正在扫描…" : filter === "clean" ? "没有需要清理的东西，这台电脑挺干净。" : "没有匹配的条目。"}
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
                            {busyDir(it.a.path) && <span className="cl-live">有会话在跑</span>}
                          </b>
                          <small className="mono" title={it.a.path}>
                            {shortPath(it.a.path)}
                            {" · "}
                            {KIND[it.a.kind]}
                            {it.a.tier ? ` · ${tierLabel(it.a.tier)}` : ""}
                          </small>
                        </span>
                      </span>
                      <span className="cl-st">
                        <span className={`nr-tag ${STATE[it.a.state].tone}`}>{STATE[it.a.state].text}</span>
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
                        <span className="nr-tag mid">无人认领</span>
                      </span>
                      <span className="cl-num">—</span>
                      <span className="cl-num">—</span>
                      <span className="cl-num">—</span>
                    </>
                  )}
                  <span className="cl-act">
                    <button
                      className="mh-x cl-more"
                      title="更多"
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

      {confirm && (
        <ConfirmDialog
          title={`清理 ${confirm.length} 项？`}
          danger
          okLabel="清理"
          body={<ConfirmBody list={confirm} busy={confirm.filter((it) => it.type === "dir" && busyDir(it.a.path)).length} />}
          onOk={() => void purge(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
      {menu.node}
    </>
  );
}

/** 确认框里把每一项会发生什么写清楚，尤其是「默认目录只清凭据」和「凭据不可恢复」 */
function ConfirmBody({ list, busy }: { list: Item[]; busy: number }) {
  const dirs = list.filter((it): it is Extract<Item, { type: "dir" }> => it.type === "dir");
  const def = dirs.find((it) => it.a.kind === "default");
  const moved = dirs.filter((it) => it.a.kind !== "default");
  const orphans = list.filter((it) => it.type === "orphan");
  const live = dirs.filter((it) => it.a.state === "ok");
  return (
    <div className="cl-confirm">
      {moved.length > 0 && <p>· {moved.length} 个目录移到 ~/.claude-buddy-trash（能捞回），它们的 Keychain 凭据一并删除。</p>}
      {def && <p>· 默认目录 ~/.claude 不挪走，只删掉它的登录凭据（{def.a.email ?? "当前账号"} 会掉登录）。</p>}
      {orphans.length > 0 && <p>· 删除 {orphans.length} 条无人认领的 Keychain 凭据。</p>}
      {live.length > 0 && (
        <p className="warn">
          其中 {live.length} 个是正常登录着的账号（{live.map((it) => it.a.email ?? it.a.name).join("、")}），清掉后要重新登录。
        </p>
      )}
      {busy > 0 && <p className="warn">其中 {busy} 个目录还有会话开着，清掉后那些会话会立刻掉登录，建议先关掉。</p>}
      <p className="dim">Keychain 凭据删了不可恢复。</p>
    </div>
  );
}
