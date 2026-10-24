import { useCallback, useEffect, useState } from "react";
import type {
  CleanupAccount,
  CleanupResult,
  CleanupSurvey,
  DiagnoseResult,
} from "../lib/bridge";
import { IconRefresh } from "./iconAliases";
import StatusIcon from "./StatusIcon";
import { tr } from "../lib/i18n";

/**
 * 体检 —— 一进来就查，不用点。
 *
 * 两件事：这台机器上有哪些账号（含别的工具建的 prof_*）、各自还能不能用；
 * 以及 403 卡在哪一层。能直接动手的地方就在行内给按钮，不另开页。
 *
 * 清理的语义：目录移到 ~/.claude-buddy-trash（可捞回），凭据条目删掉（不可恢复）。
 * 所以行内二次确认，但不弹窗 —— 弹窗会被无脑点掉，行内确认必须看清是哪一行。
 */

/** 函数而不是常量：文案要跟着当前语言走 */
function stateLabel(s: CleanupAccount["state"]): { text: string; tone: string } {
  switch (s) {
    case "ok":
      return { text: tr("正常", "OK"), tone: "p-ok" };
    // 掉登录不等于该删：目录里可能存着大量对话，重新登录就能接着用
    case "signed-out":
      return { text: tr("掉登录", "Signed out"), tone: "p-warn" };
    default:
      return { text: tr("空壳", "Empty"), tone: "p-bad" };
  }
}

function bytes(n: number) {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function when(ts: number) {
  if (!ts) return tr("从未", "Never");
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return tr("今天", "Today");
  if (days === 1) return tr("昨天", "Yesterday");
  if (days < 30) return tr(`${days} 天前`, `${days}d ago`);
  return d.toLocaleDateString(tr("zh-CN", "en-US"), { month: "numeric", day: "numeric" });
}

/** embedded：嵌在网络测试页底部时不要自己的大标题 */
export default function Diagnose({ part, embedded }: { part: "clean" | "net"; embedded?: boolean }) {
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
        if (!s.ok) setErr(tr("主进程还没准备好，请用 npm run app 启动。", "The main process is not ready. Start the app with npm run app."));
        else setSurvey(s);
      } else {
        const d = await window.claudeBuddy.diagnoseRun().catch(() => null);
        setDiag(d && d.ok ? d : null);
        if (!d || !d.ok) setErr(tr("诊断没跑起来，请用 npm run app 启动。", "Diagnostics did not start. Start the app with npm run app."));
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
      {!embedded && <h1>{part === "clean" ? tr("清理本机", "Clean up this Mac") : tr("连通诊断", "Connectivity diagnosis")}</h1>}

      {err && <div className="diag-head">{err}</div>}

      {part === "clean" && (
        <>
      <div className="clean-intro">
        <b>{tr("把这台电脑上所有 Claude Code 的登录痕迹找出来", "Find every Claude Code sign-in trace on this Mac")}</b>
        <p>
          {tr(
            "包括本应用建的环境、别的工具建的配置目录（prof_* 等），以及 Keychain 里没人认领的凭据。想从零开始登录一个新号，先在这里清干净。目录会移到 ",
            "This includes environments created by this app, config folders created by other tools (prof_* and so on), and Keychain credentials that nobody claims. To start fresh with a new account, clean up here first. Folders are moved to ",
          )}
          <code>~/.claude-buddy-trash</code>
          {tr("，需要时能捞回；Keychain 凭据删了就没了。", " and can be recovered if needed; Keychain credentials are gone once deleted.")}
        </p>
      </div>

      <div className="diag-cap-row">
        <span className="diag-cap">
          {survey
            ? tr(
                `找到 ${survey.accounts.length} 个配置目录${survey.orphans.length ? ` · ${survey.orphans.length} 条孤儿凭据` : ""}`,
                `Found ${survey.accounts.length} config folders${survey.orphans.length ? ` · ${survey.orphans.length} orphaned credentials` : ""}`,
              )
            : busy
              ? tr("正在扫描…", "Scanning…")
              : tr("未扫描", "Not scanned")}
        </span>
        <button className="det-k" disabled={busy} onClick={() => void load()}>
          {busy ? tr("扫描中…", "Scanning…") : tr("重新扫描", "Rescan")}
        </button>
      </div>

      {suggestedCount > 0 && (
        <div className="diag-bulk">
          <div>
            <b>{tr(`有 ${suggestedCount} 项可以清掉`, `${suggestedCount} items can be cleaned up`)}</b>
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
            {tr("全部清理", "Clean all")}
          </button>
        </div>
      )}

      <div className="diag-list">
        {survey?.accounts.map((a) => {
          const st = stateLabel(a.state);
          const isConfirm = confirming === a.id;
          return (
            <div key={a.id} className={`diag-row s-${a.state === "ok" ? "ok" : a.state === "empty" ? "fail" : "warn"}`}>
              <div className="diag-k">
                <span>{a.email ?? a.name}</span>
                <span className={`pill ${st.tone}`}>{st.text}</span>
              </div>
              <div className="diag-d">
                {a.kind === "codex-profile" ? "prof_* · " : a.kind === "default" ? tr("默认 · ", "Default · ") : ""}
                {bytes(a.sizeBytes)}
                {a.sessions > 0 ? tr(` · ${a.sessions} 段对话`, ` · ${a.sessions} chats`) : tr(" · 无对话", " · No chats")}
                {tr(" · 最后活动 ", " · Last active ")}
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
                      {tr("确认清理", "Confirm")}
                    </button>
                    <button className="btn btn-quiet" onClick={() => setConfirming(null)}>
                      {tr("取消", "Cancel")}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-quiet"
                    disabled={busy || (a.kind === "default" && !a.hasKeychain)}
                    title={
                      a.kind === "default"
                        ? tr("默认目录不会被删，只清掉登录凭据", "The default folder is not deleted; only sign-in credentials are removed")
                        : tr("目录移到回收站，凭据条目删除", "The folder is moved to the trash and the credential entry is deleted")
                    }
                    onClick={() => setConfirming(a.id)}
                  >
                    {tr("清理", "Clean up")}
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
                <span className="pill p-warn">{tr("无人认领", "Unclaimed")}</span>
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
                      {tr("确认清理", "Confirm")}
                    </button>
                    <button className="btn btn-quiet" onClick={() => setConfirming(null)}>
                      {tr("取消", "Cancel")}
                    </button>
                  </>
                ) : (
                  <button className="btn btn-quiet" disabled={busy} onClick={() => setConfirming(key)}>
                    {tr("清理", "Clean up")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {lastResult && (
        <div className="diag-ua">
          <b>{tr("上次清理", "Last cleanup")}</b>
          <span>
            {tr(`移动 ${lastResult.moved.length} 个目录 · 删除 ${lastResult.keychainDeleted.length} 条凭据`, `Moved ${lastResult.moved.length} folders · deleted ${lastResult.keychainDeleted.length} credentials`)}
            {lastResult.unregistered.length ? tr(` · 摘除 ${lastResult.unregistered.length} 条登记`, ` · unregistered ${lastResult.unregistered.length} entries`) : ""}
          </span>
          {lastResult.moved.length > 0 && (
            <small>{tr(`已移到 ${lastResult.trashRoot}，需要时可以捞回来。`, `Moved to ${lastResult.trashRoot}; you can recover them if needed.`)}</small>
          )}
          {lastResult.failed.length > 0 && (
            <small style={{ color: "var(--danger)" }}>
              {tr("未完成：", "Not completed: ")}{lastResult.failed.map((f) => f.reason).join(tr("；", "; "))}
            </small>
          )}
        </div>
      )}

        </>
      )}

      {/* ── 连通 ── */}
      {part === "net" && (
        <p className="dx-lead">
          {tr(
            "用这台电脑当前的网络（不走任何环境的代理）逐层探测：出口 → Cloudflare 挑战 → 账号 → 额度，看 403 / 连不上卡在哪一层。",
            "Probes layer by layer using this Mac's current network (no environment proxy): exit, Cloudflare challenge, account, quota, to see which layer causes a 403 or connection failure.",
          )}
        </p>
      )}
      {part === "net" && !diag && busy && (
        <div className="em-card dx-loading">
          <span className="nr-spin" />
          {tr("正在逐层探测：网络出口 → Bot 挑战 → 账号 → 额度…", "Probing layer by layer: network exit → bot challenge → account → quota…")}
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
              <StatusIcon tone={worst} size={30} />
              <div className="dx-sum-t">
                <b>{diag.headline}</b>
                <small>
                  {diag.exitIp ? (
                    <>
                      {tr("本机直连出口", "Direct exit of this Mac")} <span className="mono">{diag.exitIp.ip}</span> · {diag.exitIp.asn}
                    </>
                  ) : (
                    tr("出口没查到", "Exit not found")
                  )}
                  {worst === "ok" ? tr(" · 若仍遇到 403，多半是登录态失效，重新登录这个环境即可", " · If you still get a 403, the sign-in has most likely expired. Sign in to this environment again") : ""}
                </small>
              </div>
              <button className="btn" disabled={busy} onClick={() => void load()}>
                <IconRefresh />
                {busy ? tr("检查中…", "Checking…") : tr("重新检查", "Check again")}
              </button>
            </div>

            <div className="em-card dx-list">
              {diag.layers.map((l, i) => {
                const tone = l.status === "ok" ? "ok" : l.status === "warn" ? "mid" : l.status === "fail" ? "bad" : "idle";
                return (
                  <div key={l.id} className="dx-row">
                    <StatusIcon tone={tone} size={22} n={i + 1} />
                    <div className="dx-main">
                      <div className="dx-t">
                        <b>{l.label}</b>
                        <span className={`nr-tag ${tone === "idle" ? "" : tone}`}>
                          {l.status === "ok" ? tr("通", "OK") : l.status === "warn" ? tr("注意", "Warning") : l.status === "fail" ? tr("不通", "Unreachable") : tr("未测", "Not tested")}
                        </span>
                      </div>
                      <p className="dx-n">{l.note}</p>
                      {/* 原始数据按「 · 」「；」拆成一枚枚小签，比一整行等宽长串好扫 */}
                      <div className="dx-chips">
                        {l.detail
                          .split(/ · |；/)
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map((s, k) => {
                            const m = s.match(/^([^：:\d]+?)[：:]\s*(.+)$/);
                            return (
                              <span className="dx-chip" key={k}>
                                {m ? (
                                  <>
                                    <em>{m[1]}</em>
                                    {m[2]}
                                  </>
                                ) : (
                                  s
                                )}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {diag.uaVerdict.tested && diag.uaVerdict.uaDecidesResult && (
              <div className="em-card dx-ua">
                <b>{tr("UA 对照", "UA comparison")}</b>
                <span>
                  {tr("浏览器 UA", "Browser UA")} <code>{diag.uaVerdict.browser}</code> · {tr("CLI UA", "CLI UA")} <code>{diag.uaVerdict.cli}</code>
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
