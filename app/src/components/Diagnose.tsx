import { useCallback, useEffect, useState } from "react";
import type {
  CleanupAccount,
  CleanupResult,
  CleanupSurvey,
  DiagnoseLayer,
  DiagnoseResult,
} from "../lib/bridge";
import { IconPulse } from "./iconAliases";

/**
 * 体检 —— 一进来就查，不用点。
 *
 * 两件事：这台机器上有哪些账号（含别的工具建的 prof_*）、各自还能不能用；
 * 以及 403 卡在哪一层。能直接动手的地方就在行内给按钮，不另开页。
 *
 * 清理的语义：目录移到 ~/.claude-buddy-trash（可捞回），凭据条目删掉（不可恢复）。
 * 所以行内二次确认，但不弹窗 —— 弹窗会被无脑点掉，行内确认必须看清是哪一行。
 */

const STATE_LABEL: Record<CleanupAccount["state"], { text: string; tone: string }> = {
  ok: { text: "正常", tone: "p-ok" },
  // 掉登录不等于该删：目录里可能存着大量对话，重新登录就能接着用
  "signed-out": { text: "掉登录", tone: "p-warn" },
  empty: { text: "空壳", tone: "p-bad" },
};

const LAYER_TONE: Record<DiagnoseLayer["status"], string> = {
  ok: "p-ok",
  warn: "p-warn",
  fail: "p-bad",
  unknown: "p-idle",
};

function bytes(n: number) {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function when(ts: number) {
  if (!ts) return "从未";
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function Diagnose() {
  const [survey, setSurvey] = useState<CleanupSurvey | null>(null);
  const [diag, setDiag] = useState<DiagnoseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 正在等待二次确认的目标：账号 id 或 `svc:<service>` */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CleanupResult | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      // 两个都并行跑：账号扫描是本地的，很快就回；连通诊断要发请求，慢一些
      const [s, d] = await Promise.all([
        window.claudeBuddy.cleanupSurvey(),
        window.claudeBuddy.diagnoseRun().catch(() => null),
      ]);
      if (!s.ok) setErr("主进程还没准备好，请用 npm run app 启动。");
      else setSurvey(s);
      setDiag(d && d.ok ? d : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // 进来就查，不等用户点
  useEffect(() => {
    void load();
  }, [load]);

  async function runPurge(payload: {
    accountIds?: string[];
    services?: string[];
    allowMainKeychain?: boolean;
  }) {
    setBusy(true);
    setConfirming(null);
    try {
      const r = await window.claudeBuddy.cleanupPurge(payload);
      setLastResult(r);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const suggestedCount =
    (survey?.suggested.accountIds.length ?? 0) + (survey?.suggested.services.length ?? 0);

  return (
    <>
      <h1>体检</h1>

      {err && <div className="diag-head">{err}</div>}

      {/* ── 账号 ── */}
      <h2>本机账号</h2>
      <p className="diag-cap">
        {survey
          ? `${survey.accounts.length} 个 · 含其他工具建的配置目录`
          : busy
            ? "正在扫描…"
            : "未扫描"}
      </p>

      {suggestedCount > 0 && (
        <div className="diag-bulk">
          <div>
            <b>有 {suggestedCount} 项可以清掉</b>
            <small>{survey?.suggested.reason}</small>
          </div>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              runPurge({
                accountIds: survey?.suggested.accountIds ?? [],
                services: survey?.suggested.services ?? [],
              })
            }
          >
            全部清理
          </button>
        </div>
      )}

      <div className="diag-list">
        {survey?.accounts.map((a) => {
          const st = STATE_LABEL[a.state];
          const isConfirm = confirming === a.id;
          return (
            <div key={a.id} className={`diag-row s-${a.state === "ok" ? "ok" : a.state === "empty" ? "fail" : "warn"}`}>
              <div className="diag-k">
                <span>{a.email ?? a.name}</span>
                <span className={`pill ${st.tone}`}>{st.text}</span>
              </div>
              <div className="diag-d">
                {a.kind === "codex-profile" ? "prof_* · " : a.kind === "default" ? "默认 · " : ""}
                {bytes(a.sizeBytes)}
                {a.sessions > 0 ? ` · ${a.sessions} 段对话` : " · 无对话"}
                {" · 最后活动 "}
                {when(a.lastActive)}
              </div>
              <div className="diag-actions">
                {isConfirm ? (
                  <>
                    <button
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() =>
                        runPurge({
                          accountIds: [a.id],
                          allowMainKeychain: a.kind === "default",
                        })
                      }
                    >
                      确认清理
                    </button>
                    <button className="btn btn-quiet" onClick={() => setConfirming(null)}>
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-quiet"
                    disabled={busy || (a.kind === "default" && !a.hasKeychain)}
                    title={
                      a.kind === "default"
                        ? "默认目录不会被删，只清掉登录凭据"
                        : "目录移到回收站，凭据条目删除"
                    }
                    onClick={() => setConfirming(a.id)}
                  >
                    清理
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* 孤儿凭据：Keychain 里有，但没有任何目录认领 */}
        {survey?.orphans.map((o) => {
          const key = `svc:${o.service}`;
          const isConfirm = confirming === key;
          return (
            <div key={key} className="diag-row s-warn">
              <div className="diag-k">
                <span>{o.service}</span>
                <span className="pill p-warn">无人认领</span>
              </div>
              <div className="diag-d">{o.reason}</div>
              <div className="diag-actions">
                {isConfirm ? (
                  <>
                    <button
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => runPurge({ services: [o.service], allowMainKeychain: true })}
                    >
                      确认清理
                    </button>
                    <button className="btn btn-quiet" onClick={() => setConfirming(null)}>
                      取消
                    </button>
                  </>
                ) : (
                  <button className="btn btn-quiet" disabled={busy} onClick={() => setConfirming(key)}>
                    清理
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {lastResult && (
        <div className="diag-ua">
          <b>上次清理</b>
          <span>
            移动 {lastResult.moved.length} 个目录 · 删除 {lastResult.keychainDeleted.length} 条凭据
            {lastResult.unregistered.length ? ` · 摘除 ${lastResult.unregistered.length} 条登记` : ""}
          </span>
          {lastResult.moved.length > 0 && (
            <small>已移到 {lastResult.trashRoot}，需要时可以捞回来。</small>
          )}
          {lastResult.failed.length > 0 && (
            <small style={{ color: "var(--danger)" }}>
              未完成：{lastResult.failed.map((f) => f.reason).join("；")}
            </small>
          )}
        </div>
      )}

      {/* ── 连通 ── */}
      {diag && (
        <>
          <h2>连通</h2>
          <div className="diag-head">
            <IconPulse size={15} />
            <span>{diag.headline}</span>
          </div>
          {diag.exitIp && (
            <p className="diag-cap">
              出口 <b>{diag.exitIp.ip}</b> · {diag.exitIp.asn}
              {diag.exitIp.hosting ? " · 机房 IP" : ""}
            </p>
          )}
          <div className="diag-list">
            {diag.layers.map((l) => (
              <div key={l.id} className={`diag-row s-${l.status}`}>
                <div className="diag-k">
                  <span>{l.label}</span>
                  <span className={`pill ${LAYER_TONE[l.status]}`}>{l.status === "ok" ? "通" : l.status === "warn" ? "注意" : l.status === "fail" ? "不通" : "未测"}</span>
                </div>
                <div className="diag-d">{l.detail}</div>
                <div className="diag-n">{l.note}</div>
              </div>
            ))}
          </div>
          {diag.uaVerdict.tested && diag.uaVerdict.uaDecidesResult && (
            <div className="diag-ua">
              <b>UA 对照</b>
              <span>
                浏览器 UA <code>{diag.uaVerdict.browser}</code> · CLI UA <code>{diag.uaVerdict.cli}</code>
              </span>
              <small>{diag.uaVerdict.summary}</small>
            </div>
          )}
        </>
      )}

      <button className="btn btn-quiet diag-refresh" disabled={busy} onClick={() => void load()}>
        {busy ? "检查中…" : "重新检查"}
      </button>
    </>
  );
}
