import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { NetReport } from "../lib/bridge";
import { CHECKERS, flag } from "./IpBadge";
import { useContextMenu } from "./ContextMenu";
import Help from "./Help";
import { IconRefresh, IconWarning } from "./iconAliases";
import { tr } from "../lib/i18n";
import { askDetect } from "../lib/detect";

/** 同一个环境、同一条线路，5 分钟内切回来不重测 */
const cache = new Map<string, { key: string; at: number; r: NetReport }>();

/** 切语言后清掉：缓存里的城市名、说明文字还是旧语言 */
export function resetNetReports() {
  cache.clear();
}

/**
 * 丢掉一个环境的体检缓存，下次渲染就重测。
 *
 * 托管出口的实例是**异步起来**的：应用刚启动那几秒，实例还没监听端口，
 * 这时候测必然失败。如果把这个失败缓存住，实例起来了界面还写着「出口不通」——
 * 用户看到的就是"明明在跑却说我不通"。所以实例就绪后要主动清掉。
 */
export function invalidateNetReport(accountId: string) {
  cache.delete(accountId);
  listeners.forEach((f) => f());
}

const TTL = 5 * 60 * 1000;

/** 函数而不是常量：文案要跟着当前语言走 */
function kindName(k: string): string | undefined {
  switch (k) {
    case "residential":
      return tr("住宅宽带", "Residential");
    case "mobile":
    case "wireless":
      return tr("移动网络", "Mobile");
    case "hosting":
      return tr("机房 IP", "Datacenter");
    case "business":
      return tr("企业线路", "Business");
    case "vpn":
      return "VPN";
    default:
      return undefined;
  }
}

/** 同一个环境同时只发一次体检，几个地方一起要也只跑一趟 */
const inflight = new Map<string, Promise<NetReport>>();
const listeners = new Set<() => void>();

/**
 * 发起一次体检。
 *
 * **先问，再发**。体检不是免费的：它会带着这个环境的出口 IP 去打
 * api.*（那是真带身份），再去 ip-api / proxycheck 这类站点查归属 ——
 * 那些站点会记录来源地址。用户必须知道这件事并点头。
 *
 * 拒绝就到此为止，不"那我小心点测一下"。
 */
function fetchReport(accountId: string, key: string): Promise<NetReport> {
  const running = inflight.get(accountId);
  if (running) return running;
  const p = (async (): Promise<NetReport> => {
    const allow = await askDetect({
      targets: ["api.anthropic.com", "ip-api.com", "proxycheck.io", "ipinfo.io", "ipwho.is"],
      exposes: tr(
        "这个环境的出口 IP、城市、运营商、时区，以及请求时间。上面每个站点都会记录来源地址。",
        "This environment's exit IP, city, carrier and time zone, plus the request time. Every site above records the source address.",
      ),
      why: tr(
        "体检会告诉你 Claude 服务器看到的出口是哪个、有没有被标成代理、时区跟出口对得上不。不测就只能靠猜。",
        "A check tells you which exit Claude's servers see, whether it is flagged as a proxy, and whether the time zone matches. Without it you are guessing.",
      ),
    });
    if (!allow) {
      return { ok: false, blocked: true, reason: tr("你取消了这次检测", "You cancelled this check") } as NetReport;
    }
    try {
      const r = await window.claudeBuddy.netReport(accountId);
      cache.set(accountId, { key, at: Date.now(), r });
      listeners.forEach((f) => f());
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 开发时界面热更新了、后台没重启，会出现这个；给人话而不是原始报错
      const r: NetReport = {
        ok: false,
        reason: /No handler registered/.test(msg)
          ? tr("应用后台是旧版本，重启应用后再试", "The app backend is outdated. Restart the app and try again")
          : msg,
      };
      return r;
    } finally {
      inflight.delete(accountId);
    }
  })();
  inflight.set(accountId, p);
  return p;
}

/**
 * 读一个环境的出口体检（带缓存）。
 *
 * **不自动测**。以前 stale 就会自己发请求，但那意味着用户什么都没点，
 * 我们已经在往外报这个环境的出口 IP 了 —— 跟"检测前必须确认"直接矛盾。
 * 现在只读已有结果；要测得由用户点（走 fetchReport，里面有确认弹窗）。
 */
export function useNetReport(accountId: string | null | undefined, proxyKey: string): NetReport | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  const hit = accountId ? cache.get(accountId) : undefined;
  return hit && hit.key.startsWith(`${proxyKey}|`) ? hit.r : null;
}

/** 主动测一次（已包含确认弹窗）。给那些想点一下就测的小地方用 */
export function measureNetReport(accountId: string, proxyKey: string) {
  return fetchReport(accountId, `${proxyKey}|`);
}

/** 一小枚：🇺🇸 100 纯净。没测过就显示「未检测」，不自动发请求 */
export function NetScore({ accountId, proxyKey }: { accountId: string | null | undefined; proxyKey: string }) {
  const r = useNetReport(accountId, proxyKey);
  if (!r) return <span className="nsc dim">{tr("未检测", "Not checked")}</span>;
  if (!r.ok && r.blocked) return <span className="nsc dim">{tr("未检测", "Not checked")}</span>;
  /**
   * 实例还在启动 ≠ 不通。
   *
   * 托管实例是异步拉起来的，应用刚开那两秒端口确实没监听。
   * 这时候标红「出口不通」，用户会去排查一个根本不存在的问题。
   */
  if (!r.ok && r.starting) return <span className="nsc dim">{tr("出口启动中…", "Exit starting…")}</span>;
  if (!r.ok) return <span className="nsc bad" title={r.reason}>{tr("出口不通", "Exit unreachable")}</span>;
  const v = verdict(r.score ?? 0);
  return (
    <span className={`nsc ${v.tone}`} title={tr(`${r.ip} · 信任分 ${r.score}（${v.text}）`, `${r.ip} · Trust score ${r.score} (${v.text})`)}>
      {flag(r.info?.countryCode ?? r.claude?.loc ?? "")}
      <b>{r.score}</b>
      {v.text}
    </span>
  );
}

export function verdict(score: number): { text: string; tone: "ok" | "mid" | "bad" } {
  if (score >= 75) return { text: tr("纯净", "Clean"), tone: "ok" };
  if (score >= 50) return { text: tr("一般", "Fair"), tone: "mid" };
  return { text: tr("高危", "Risky"), tone: "bad" };
}

function ms(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

/**
 * 出口体检卡 —— 站在 Claude 的角度看这个环境的出口。
 *
 * 左边一个信任分，右边 IP 与归属；下面三栏：Claude 看到的、IP 属性、一致性。
 * 信任分是按公开数据估的（proxycheck 风险分 + 代理 / 机房标记），不是 Anthropic 的内部分。
 * 要更细的评分，右下角「查纯净度」去第三方站点看。
 */
export default function NetReportCard({
  accountId,
  proxyKey,
  lastIp,
  tz,
  onIp,
  onAlign,
}: {
  accountId: string;
  /** 线路变了要重测 */
  proxyKey: string;
  lastIp: string | null;
  tz: string;
  onIp: (ip: string) => void;
  /** 把环境的时区 / 语言改成跟出口一致 */
  onAlign: (t: { tz?: string; lang?: string }) => void;
}) {
  const hit = cache.get(accountId);
  const fresh = hit && hit.key === `${proxyKey}|${tz}` && Date.now() - hit.at < TTL ? hit.r : null;
  const [r, setR] = useState<NetReport | null>(fresh);
  const [busy, setBusy] = useState(false);
  const prevIp = useRef(lastIp);
  const menu = useContextMenu();

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetchReport(accountId, `${proxyKey}|${tz}`);
      setR(res);
      if (res.ok && res.ip) onIp(res.ip);
    } catch (e) {
      setR({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, proxyKey, tz]);

  /**
   * **不自动测**。
   *
   * 之前这里挂载就 run()，也就是用户刚点开「网络出口」我们已经在往外
   * 报这个环境的出口 IP 了。检测本身是有代价的（第三方站点会记录来源），
   * 必须用户点头才发。所以进来只读缓存，要测由人点。
   */

  if (!r) {
    return (
      <div className="nr nr-idle">
        <span>
          {tr(
            "还没检测过。检测会向 ip-api、proxycheck 和 api.anthropic.com 发请求，把出口 IP 报给它们。",
            "Not checked yet. A check sends requests to ip-api, proxycheck and api.anthropic.com, disclosing the exit IP to them.",
          )}
        </span>
        <button className="btn pri" onClick={() => void run()} disabled={busy}>
          <IconRefresh size={12} />
          {busy ? tr("检测中…", "Checking…") : tr("开始检测", "Run the check")}
        </button>
      </div>
    );
  }

  if (busy && !r.ok) {
    return (
      <div className="nr nr-loading">
        <span className="nr-spin" />
        <span>{tr("正在从这个环境的线路连 Claude，看它眼里的出口…", "Connecting to Claude through this environment's route to see the exit as it does…")}</span>
      </div>
    );
  }

  if (!r.ok) {
    // 用户自己取消的，不是故障 —— 不要红字警告，也不要催重试
    if (r.blocked) {
      return (
        <div className="nr nr-idle">
          <span>{tr("已取消，没有发出任何请求。", "Cancelled. Nothing was sent.")}</span>
          <button className="btn" onClick={() => void run()} disabled={busy}>
            {tr("现在检测", "Check now")}
          </button>
        </div>
      );
    }
    return (
      <div className="nr nr-fail">
        <IconWarning size={15} />
        <span>{r.reason ?? tr("检测失败", "Check failed")}</span>
        <button className="btn" onClick={() => void run()} disabled={busy}>
          {busy ? tr("检测中…", "Checking…") : tr("重试", "Retry")}
        </button>
      </div>
    );
  }

  const score = r.score ?? 0;
  const v = verdict(score);
  const info = r.info;
  const c = r.claude!;
  const cs = r.consistency!;
  const kind = kindName((r.kind || "").toLowerCase()) ?? r.kind ?? tr("未知", "Unknown");
  const hosting = ["hosting", "business", "vpn"].includes((r.kind || "").toLowerCase()) || /机房|企业|VPN/.test(kind);
  const jumped = prevIp.current && r.ip && prevIp.current !== r.ip;

  return (
    <div className={`nr${busy ? " busy" : ""}`}>
      <div className="nr-top">
        <div className={`nr-score ${v.tone}`}>
          <b>{score}</b>
          <span>{v.text}</span>
        </div>
        <div className="nr-id">
          {/* 「出口」有好几种：本机直连的、代理的、DNS 的……这里说清楚是哪一个 */}
          <div className="nr-cap">{tr(`Claude 看到的出口 · 走 ${proxyKey}`, `Exit seen by Claude · via ${proxyKey}`)}</div>
          <div className="nr-ip">
            <span className="mono">{r.ip}</span>
            <span className={`ipb-kind ${hosting ? "mid" : "ok"}`}>{kind}</span>
          </div>
          <div className="nr-geo">
            {info ? (
              <>
                {flag(info.countryCode)} {[info.city || info.region, info.country].filter(Boolean).join(" · ")}
                {info.isp ? ` · ${info.isp}` : ""}
              </>
            ) : (
              tr("归属查不到", "Location unavailable")
            )}
          </div>
          <div className="nr-meter" title={tr("0 高危 · 100 可信", "0 risky · 100 trusted")}>
            <i style={{ left: `${score}%` }} />
          </div>
        </div>
        <div className="nr-acts">
          <button className="btn" onClick={() => void run()} disabled={busy}>
            <IconRefresh />
            {busy ? tr("检测中…", "Checking…") : tr("重新检测", "Check again")}
          </button>
          <Help title={tr("这个分怎么来的？", "How is this score calculated?")} wide>
            <p>
              {tr(
                "信任分 = 100 − proxycheck.io 的风险分，被标成代理 / VPN 直接压到 30 以下，机房 IP 再扣 15。它是按公开数据估的，",
                "Trust score = 100 minus the proxycheck.io risk score. An IP flagged as proxy / VPN is capped below 30, and a datacenter IP loses another 15. It is estimated from public data, ",
              )}
              <b>{tr("不是 Anthropic 的内部分数", "not an internal Anthropic score")}</b>
              {tr("，只用来对比线路好坏。", ", and is only for comparing routes.")}
            </p>
            <p>{tr("这里的 IP 是直接请求 claude.ai 时，Cloudflare 回报的来源地址，走的就是这个环境的线路，跟真实会话同一条路。", "This IP is the source address Cloudflare reports when claude.ai is requested directly. It uses this environment's route, the same path as a real session.")}</p>
            <p>{tr("它跟「设置 → 网络测试」里的「本机直连出口」不一定一样：那个不走任何环境的代理。", "It may differ from the direct exit of this Mac under Settings → Network test, which does not use any environment's proxy.")}</p>
            <p>{tr("IP 属性两个来源各说各的（ip-api、proxycheck），照实列出，不按运营商名字去猜。", "The two sources for IP attributes (ip-api, proxycheck) can disagree. Both are listed as reported, with no guessing from the carrier name.")}</p>
          </Help>
        </div>
      </div>

      {jumped && (
        <div className="nr-warn">
          <IconWarning size={13} />
          {tr(
            `出口变了：${prevIp.current} → ${r.ip}。同一个号频繁换出口本身就是风控信号。`,
            `Exit changed: ${prevIp.current} → ${r.ip}. Frequently changing the exit on one account is itself a risk signal.`,
          )}
        </div>
      )}

      <div className="nr-grid">
        <div className="nr-col">
          <h4>{tr("Claude 看到的", "What Claude sees")}</h4>
          <Line k={tr("地区", "Region")}>
            {flag(c.loc)} {c.loc || "—"}
            {c.supported === false ? <Tag tone="bad">{tr("不在服务区", "Unsupported region")}</Tag> : c.supported ? <Tag tone="ok">{tr("支持", "Supported")}</Tag> : null}
          </Line>
          <Line k="claude.ai">{c.web.ok ? <Tag tone={c.web.ms > 1500 ? "mid" : "ok"}>{ms(c.web.ms)}</Tag> : <Tag tone="bad">{tr("不通", "Unreachable")}</Tag>}</Line>
          <Line k="API">{c.api.ok ? <Tag tone={c.api.ms > 1500 ? "mid" : "ok"}>{ms(c.api.ms)}</Tag> : <Tag tone="bad">{tr("不通", "Unreachable")}</Tag>}</Line>
          <Line k={tr("服务状态", "Service status")}>
            {c.status ? <Tag tone={c.status.ok ? "ok" : "mid"}>{c.status.ok ? tr("全部正常", "All OK") : c.status.text}</Tag> : "—"}
          </Line>
        </div>

        <div className="nr-col">
          <h4>{tr("IP 属性", "IP attributes")}</h4>
          <Line k={tr("代理 / VPN", "Proxy / VPN")}>{r.risk?.proxy || info?.proxy ? <Tag tone="bad">{tr("已标记", "Flagged")}</Tag> : <Tag tone="ok">{tr("未检测到", "Not detected")}</Tag>}</Line>
          {/* 两个来源分开列，各说各的 */}
          <Line k="proxycheck">
            {r.risk ? (
              <Tag tone={r.risk.risk >= 50 ? "bad" : r.risk.risk >= 25 ? "mid" : "ok"}>
                {kindName(r.risk.type.toLowerCase()) ?? (r.risk.type || tr("未知", "Unknown"))} · {r.risk.risk}
              </Tag>
            ) : (
              tr("没查到", "No result")
            )}
          </Line>
          <Line k="ip-api">
            {info ? (
              <Tag tone={info.proxy ? "bad" : info.hosting ? "mid" : "ok"}>
                {info.proxy ? tr("代理", "Proxy") : info.hosting ? tr("机房", "Datacenter") : info.mobile ? tr("移动网络", "Mobile") : tr("非机房", "Not datacenter")}
              </Tag>
            ) : (
              tr("没查到", "No result")
            )}
          </Line>
          <Line k="ASN">
            <span className="nr-trunc" title={`${info?.as ?? ""}\n${info?.isp ?? ""}`}>
              {info?.as || "—"}
            </span>
          </Line>
        </div>

        <div className="nr-col">
          <h4>{tr("一致性", "Consistency")}</h4>
          <Line k={tr("时区", "Time zone")}>
            {cs.tzOk ? (
              <Tag tone="ok">{tr("一致", "Match")}</Tag>
            ) : (
              <button className="nr-fix" onClick={() => onAlign({ tz: cs.ipTz })} title={tr(`把环境时区改成 ${cs.ipTz}，下次开会话生效`, `Set the environment time zone to ${cs.ipTz}, effective for the next session`)}>
                <Tag tone="mid">{tr("不一致", "Mismatch")}</Tag>
                <span>{tr("对齐", "Align")}</span>
              </button>
            )}
          </Line>
          <Line k={tr("环境时区", "Env zone")}>
            <span className="mono nr-trunc">{cs.tz}</span>
          </Line>
          <Line k={tr("出口时区", "Exit zone")}>
            <span className="mono nr-trunc">{cs.ipTz || "—"}</span>
          </Line>
          <Line k={tr("语言", "Language")}>
            {cs.langOk ? (
              <Tag tone="ok">{cs.lang.split(".")[0]}</Tag>
            ) : (
              <button
                className="nr-fix"
                onClick={() => onAlign({ lang: /^zh/i.test(cs.lang) ? "en_US.UTF-8" : "zh_CN.UTF-8" })}
                title={tr(`环境 ${cs.lang}，跟出口所在地不搭。点一下改过来，下次开会话生效`, `Environment is ${cs.lang}, which doesn't fit the exit location. Click to fix, effective for the next session`)}
              >
                <Tag tone="mid">{cs.lang.split(".")[0]}</Tag>
                <span>{tr("对齐", "Align")}</span>
              </button>
            )}
          </Line>
        </div>
      </div>

      <div className="nr-foot">
        <span>{tr("数据：", "Data: ")}claude.ai · ip-api.com · proxycheck.io{r.at ? ` · ${new Date(r.at).toLocaleTimeString(tr("zh-CN", "en-US"), { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        <button
          className="nr-more"
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            menu.open(
              { clientX: b.left, clientY: b.bottom + 4, preventDefault: () => {}, stopPropagation: () => {} },
              CHECKERS.map((x) => ({ label: x.label, hint: "↗", run: () => void window.claudeBuddy.openExternal(x.url(r.ip!)) })),
              tr(`到第三方站点查 ${r.ip}`, `Look up ${r.ip} on third-party sites`),
            );
          }}
        >
          {tr("更多评分 ↗", "More scores ↗")}
        </button>
      </div>
      {menu.node}
    </div>
  );
}

function Line({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="nr-line">
      <span>{k}</span>
      <span className="nr-v">{children}</span>
    </div>
  );
}

function Tag({ tone, children }: { tone: "ok" | "mid" | "bad"; children: ReactNode }) {
  return <span className={`nr-tag ${tone}`}>{children}</span>;
}
