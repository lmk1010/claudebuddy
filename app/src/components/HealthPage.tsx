import type { Account, AccountStatusSnapshot, Health } from "../lib/model";
import { AUTH_LABEL, healthOf } from "../lib/model";
import type { DesktopProbe, LeakReport, RiskReport } from "../lib/bridge";
import { tr } from "../lib/i18n";
import Help from "./Help";

/**
 * 健康检查 —— 一眼看完所有环境，一键重跑。
 *
 * 为什么要有这一页：环境列表只能一行一行看，看不出"现在整台机器怎么样"。
 * 这里按分数从低到高排，红的最上面 —— 先处理会咬人的，再管整洁。
 *
 * 分数不是黑箱：每一行展开就是扣分理由，点得动、改得掉。
 */

function tone(level: Health["level"]) {
  return level === "blocked" ? "bad" : level === "risk" ? "mid" : "ok";
}

function levelLabel(level: Health["level"]) {
  if (level === "blocked") return tr("被风控", "Restricted");
  if (level === "risk") return tr("有风险", "At risk");
  return tr("就绪", "Ready");
}

export default function HealthPage({
  accounts,
  status,
  exitIp,
  desktop,
  leak,
  risk,
  checking,
  onCheckAll,
  onOpenAccount,
  onOpenClean,
}: {
  accounts: Account[];
  status: Record<string, AccountStatusSnapshot>;
  exitIp: Record<string, string | null>;
  desktop: DesktopProbe | null;
  leak: LeakReport | null;
  risk: RiskReport | null;
  checking: boolean;
  onCheckAll: () => void;
  onOpenAccount: (id: string) => void;
  onOpenClean: () => void;
}) {
  const stunDetected = Boolean(leak?.stunDetected);
  const desktopRunning = Boolean(desktop?.running);

  const rows = accounts
    .map((a) => ({
      a,
      h: healthOf(a, status[a.id], exitIp[a.id], accounts, { stunDetected, desktopRunning }),
    }))
    .sort((x, y) => x.h.score - y.h.score);

  const n = { ok: 0, risk: 0, blocked: 0 };
  for (const r of rows) n[r.h.level]++;
  const worst = rows[0];
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.h.score, 0) / rows.length) : 0;

  return (
    <>
      <div className="wh" />

      <div className="sv">
        <div className="sv-h">
          <div>
            <h1>{tr("健康检查", "Health check")}</h1>
            <p>
              {accounts.length === 0
                ? tr("还没有环境", "No environments yet")
                : tr(
                    `${accounts.length} 个环境 · 平均 ${avg} 分 · ${n.ok} 绿 / ${n.risk} 黄 / ${n.blocked} 红`,
                    `${accounts.length} environments · ${avg} avg · ${n.ok} green / ${n.risk} amber / ${n.blocked} red`,
                  )}
            </p>
          </div>
          <div className="pg-acts">
            <Help title={tr("分数怎么算？", "How is the score computed?")} wide>
              <p>
                {tr(
                  "从 100 分往下扣，每扣一次都有一条理由，展开就能看到。红色只留给账号级状态（被风控 / 凭据失效）—— 那不是你能在本机改掉的。",
                  "It starts at 100 and every deduction carries a reason you can read. Red is reserved for account-level states (restricted / expired), which you cannot fix locally.",
                )}
              </p>
              <p>
                {tr(
                  "能改的一律算黄色：直连、没设备码、出口跟别的环境撞了、有程序在发 STUN、Desktop 还开着。",
                  "Anything fixable stays amber: direct connection, missing device ID, shared exit, STUN in flight, Desktop running.",
                )}
              </p>
            </Help>
            <button className="btn pri" onClick={onCheckAll} disabled={checking}>
              {checking ? tr("检查中…", "Checking…") : tr("一键检查全部", "Check all")}
            </button>
          </div>
        </div>

        {n.blocked > 0 && (
          <div className="hc-note bad">
            <b>{tr(`${n.blocked} 个环境处于暂时风控`, `${n.blocked} environments are temporarily restricted`)}</b>
            <span>
              {tr(
                "这是账号级状态，换本机凭据绕不过去；先用别的环境，等它解除。",
                "That is account-level; local credentials will not get around it. Use another environment while it clears.",
              )}
            </span>
          </div>
        )}
        {n.blocked === 0 && worst && worst.h.level === "ok" && (
          <div className="hc-note ok">
            <b>{tr("全部就绪", "All ready")}</b>
            <span>{tr("每个环境都登录着、有自己的出口和设备码。", "Every environment is signed in with its own exit and device ID.")}</span>
          </div>
        )}

        <div className="hc-list">
          {rows.map(({ a, h }) => (
            <div key={a.id} className={`hc-i lv-${h.level}`}>
              <span className={`hc-dot ${tone(h.level)}`} />
              <span className="hc-score mono">{h.score}</span>
              <span className="hc-name">
                <b>{a.label}</b>
                <small>
                  <span className="mono">~/{a.configDir}</span>
                  {status[a.id]?.email || a.email ? ` · ${status[a.id]?.email ?? a.email}` : ""}
                </small>
              </span>
              <span className={`pill ${h.level === "blocked" ? "p-bad" : h.level === "risk" ? "p-warn" : "p-ok"}`}>
                {levelLabel(h.level)}
              </span>
              <span className="hc-auth">{AUTH_LABEL[status[a.id]?.auth ?? a.auth]}</span>
              <button className="btn" onClick={() => onOpenAccount(a.id)}>
                {tr("去处理", "Open")}
              </button>
              {h.reasons.length > 0 && (
                <ul className="hc-why">
                  {h.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {risk && risk.items.length > 0 && (
          <div className="hc-global">
            <div className="hc-global-h">
              <b>{tr("整机层面", "Machine-wide")}</b>
              <span className={risk.danger ? "bad" : risk.warn ? "mid" : "ok"}>
                {risk.danger
                  ? tr(`${risk.danger} 项会直接暴露`, `${risk.danger} exposures`)
                  : risk.warn
                    ? tr(`${risk.warn} 项要注意`, `${risk.warn} warnings`)
                    : tr("没有发现暴露", "No exposures found")}
              </span>
              <span className="rk-sp" />
              <button className="btn ghost" onClick={onOpenClean}>
                {tr("看完整清单 →", "Full list →")}
              </button>
            </div>
            <ul className="hc-global-l">
              {risk.items
                .filter((i) => i.status !== "ok")
                .slice(0, 4)
                .map((i) => (
                  <li key={i.key} className={`lv-${i.level}`}>
                    {i.title}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
