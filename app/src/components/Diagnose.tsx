import { useCallback, useEffect, useState } from "react";
import type {
  CleanupAccount,
  CleanupResult,
  CleanupSurvey,
  DiagnoseResult,
} from "../lib/bridge";
import { IconCheck, IconRefresh, IconWarning } from "./iconAliases";

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

export default function Diagnose({ part }: { part: "clean" | "net" }) {
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
      // 清理只扫本地（很快）；连通诊断要发请求，慢一些 —— 各看各的，不互相等
      if (part === "clean") {
        const s = await window.claudeBuddy.cleanupSurvey();
        if (!s.ok) setErr("主进程还没准备好，请用 npm run app 启动。");
        else setSurvey(s);
      } else {
        const d = await window.claudeBuddy.diagnoseRun().catch(() => null);
        setDiag(d && d.ok ? d : null);
        if (!d || !d.ok) setErr("诊断没跑起来，请用 npm run app 启动。");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [part]);

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
      <h1>{part === "clean" ? "清理本机" : "连通诊断"}</h1>

      {err && <div className="diag-head">{err}</div>}

      {part === "clean" && (
        <>
      <div className="clean-intro">
        <b>把这台电脑上所有 Claude Code 的登录痕迹找出来</b>
        <p>
          包括本应用建的环境、别的工具建的配置目录（prof_* 等），以及 Keychain 里没人认领的凭据。
          想从零开始登录一个新号，先在这里清干净。目录会移到 <code>~/.claude-buddy-trash</code>，需要时能捞回；Keychain 凭据删了就没了。
        </p>
      </div>

      <div className="diag-cap-row">
        <span className="diag-cap">
          {survey
            ? `找到 ${survey.accounts.length} 个配置目录${survey.orphans.length ? ` · ${survey.orphans.length} 条孤儿凭据` : ""}`
            : busy
              ? "正在扫描…"
              : "未扫描"}
        </span>
        <button className="det-k" disabled={busy} onClick={() => void load()}>
          {busy ? "扫描中…" : "重新扫描"}
        </button>
      </div>

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

        </>
      )}

      {/* ── 连通 ── */}
      {part === "net" && (
        <p className="dx-lead">
          用这台电脑当前的网络（不走任何环境的代理）逐层探测，看 403 / 连不上卡在哪一层。各环境自己的出口在「环境 → 网络出口」里看。
        </p>
      )}
      {part === "net" && !diag && busy && (
        <div className="em-card dx-loading">
          <span className="nr-spin" />
          正在逐层探测：网络出口 → Bot 挑战 → 账号 → 额度…
        </div>
      )}
      {part === "net" && diag && (() => {
        // 总体结论的色调取最差的一层
        const worst = diag.layers.some((l) => l.status === "fail")
          ? "bad"
          : diag.layers.some((l) => l.status === "warn")
            ? "mid"
            : "ok";
        return (
          <>
            <div className={`dx-sum ${worst}`}>
              <span className="dx-sum-ic">{worst === "ok" ? <IconCheck size={16} /> : <IconWarning size={16} />}</span>
              <div className="dx-sum-t">
                <b>{diag.headline}</b>
                {diag.exitIp && (
                  <small>
                    出口 <span className="mono">{diag.exitIp.ip}</span> · {diag.exitIp.asn}
                  </small>
                )}
              </div>
              <button className="btn" disabled={busy} onClick={() => void load()}>
                <IconRefresh />
                {busy ? "检查中…" : "重新检查"}
              </button>
            </div>

            <div className="em-card dx-list">
              {diag.layers.map((l, i) => {
                const tone = l.status === "ok" ? "ok" : l.status === "warn" ? "mid" : l.status === "fail" ? "bad" : "idle";
                return (
                  <div key={l.id} className="dx-row">
                    <span className={`dx-st ${tone}`}>
                      {tone === "ok" ? <IconCheck size={12} /> : tone === "idle" ? i + 1 : <IconWarning size={12} />}
                    </span>
                    <div className="dx-main">
                      <div className="dx-t">
                        <b>{l.label}</b>
                        <span className={`nr-tag ${tone === "idle" ? "" : tone}`}>
                          {l.status === "ok" ? "通" : l.status === "warn" ? "注意" : l.status === "fail" ? "不通" : "未测"}
                        </span>
                      </div>
                      <p className="dx-n">{l.note}</p>
                      <code className="dx-d">{l.detail}</code>
                    </div>
                  </div>
                );
              })}
            </div>

            {diag.uaVerdict.tested && diag.uaVerdict.uaDecidesResult && (
              <div className="em-card dx-ua">
                <b>UA 对照</b>
                <span>
                  浏览器 UA <code>{diag.uaVerdict.browser}</code> · CLI UA <code>{diag.uaVerdict.cli}</code>
                </span>
                <small>{diag.uaVerdict.summary}</small>
              </div>
            )}
          </>
        );
      })()}
    </>
  );
}
