import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { NetReport } from "../lib/bridge";
import { CHECKERS, flag } from "./IpBadge";
import { useContextMenu } from "./ContextMenu";
import Help from "./Help";
import { IconRefresh, IconWarning } from "./iconAliases";

/** 同一个环境、同一条线路，5 分钟内切回来不重测 */
const cache = new Map<string, { key: string; at: number; r: NetReport }>();
const TTL = 5 * 60 * 1000;

const KIND_ZH: Record<string, string> = {
  residential: "住宅宽带",
  mobile: "移动网络",
  wireless: "移动网络",
  hosting: "机房 IP",
  business: "企业线路",
  vpn: "VPN",
};

/** 同一个环境同时只发一次体检，几个地方一起要也只跑一趟 */
const inflight = new Map<string, Promise<NetReport>>();
const listeners = new Set<() => void>();

function fetchReport(accountId: string, key: string): Promise<NetReport> {
  const running = inflight.get(accountId);
  if (running) return running;
  const p = window.claudeBuddy
    .netReport(accountId)
    .catch((e): NetReport => ({ ok: false, reason: e instanceof Error ? e.message : String(e) }))
    .then((r) => {
      cache.set(accountId, { key, at: Date.now(), r });
      inflight.delete(accountId);
      listeners.forEach((f) => f());
      return r;
    });
  inflight.set(accountId, p);
  return p;
}

/**
 * 读一个环境的出口体检（带缓存）。会话顶栏、首页输入框这些小地方用它显示一个分数，
 * 不用每处都自己去测；在「网络出口」里重测后，这些地方跟着更新。
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
  const stale = !hit || !hit.key.startsWith(`${proxyKey}|`) || Date.now() - hit.at > TTL;
  useEffect(() => {
    if (accountId && stale) void fetchReport(accountId, `${proxyKey}|`);
  }, [accountId, proxyKey, stale]);
  return hit && hit.key.startsWith(`${proxyKey}|`) ? hit.r : null;
}

/** 一小枚：🇺🇸 100 纯净。测着时显示「测出口…」，测不通显示「出口不通」 */
export function NetScore({ accountId, proxyKey }: { accountId: string | null | undefined; proxyKey: string }) {
  const r = useNetReport(accountId, proxyKey);
  if (!r) return <span className="nsc dim">测出口…</span>;
  if (!r.ok) return <span className="nsc bad">出口不通</span>;
  const v = verdict(r.score ?? 0);
  return (
    <span className={`nsc ${v.tone}`} title={`${r.ip} · 信任分 ${r.score}（${v.text}）`}>
      {flag(r.info?.countryCode ?? r.claude?.loc ?? "")}
      <b>{r.score}</b>
      {v.text}
    </span>
  );
}

export function verdict(score: number): { text: string; tone: "ok" | "mid" | "bad" } {
  if (score >= 75) return { text: "纯净", tone: "ok" };
  if (score >= 50) return { text: "一般", tone: "mid" };
  return { text: "高危", tone: "bad" };
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
  // 进来时记下的上一次出口，用来判断这次是不是跳了
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

  // 进来就测；线路改了也重测
  useEffect(() => {
    if (!fresh) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  if (!r || (busy && !r.ok)) {
    return (
      <div className="nr nr-loading">
        <span className="nr-spin" />
        <span>正在从这个环境的线路连 Claude，看它眼里的出口…</span>
      </div>
    );
  }

  if (!r.ok) {
    return (
      <div className="nr nr-fail">
        <IconWarning size={15} />
        <span>{r.reason ?? "检测失败"}</span>
        <button className="btn" onClick={() => void run()} disabled={busy}>
          {busy ? "检测中…" : "重试"}
        </button>
      </div>
    );
  }

  const score = r.score ?? 0;
  const v = verdict(score);
  const info = r.info;
  const c = r.claude!;
  const cs = r.consistency!;
  const kind = KIND_ZH[(r.kind || "").toLowerCase()] ?? r.kind ?? "未知";
  const hosting = /机房|企业|VPN/.test(kind);
  const jumped = prevIp.current && r.ip && prevIp.current !== r.ip;

  return (
    <div className={`nr${busy ? " busy" : ""}`}>
      <div className="nr-top">
        <div className={`nr-score ${v.tone}`}>
          <b>{score}</b>
          <span>{v.text}</span>
        </div>
        <div className="nr-id">
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
              "归属查不到"
            )}
          </div>
          <div className="nr-meter" title="0 高危 · 100 可信">
            <i style={{ left: `${score}%` }} />
          </div>
        </div>
        <div className="nr-acts">
          <button className="btn" onClick={() => void run()} disabled={busy}>
            <IconRefresh />
            {busy ? "检测中…" : "重新检测"}
          </button>
          <Help title="这个分怎么来的？" wide>
            <p>
              信任分 = 100 − proxycheck.io 的风险分，被标成代理 / VPN 直接压到 30 以下，机房 IP 再扣 15。它是按公开数据估的，
              <b>不是 Anthropic 的内部分数</b>，只用来对比线路好坏。
            </p>
            <p>「Claude 看到的」直接请求 claude.ai 拿到，走的就是这个环境的代理，跟真实会话是同一条路。</p>
          </Help>
        </div>
      </div>

      {jumped && (
        <div className="nr-warn">
          <IconWarning size={13} />
          出口变了：{prevIp.current} → {r.ip}。同一个号频繁换出口本身就是风控信号。
        </div>
      )}

      <div className="nr-grid">
        <div className="nr-col">
          <h4>Claude 看到的</h4>
          <Line k="地区">
            {flag(c.loc)} {c.loc || "—"}
            {c.supported === false ? <Tag tone="bad">不在服务区</Tag> : c.supported ? <Tag tone="ok">支持</Tag> : null}
          </Line>
          <Line k="claude.ai">{c.web.ok ? <Tag tone={c.web.ms > 1500 ? "mid" : "ok"}>{ms(c.web.ms)}</Tag> : <Tag tone="bad">不通</Tag>}</Line>
          <Line k="API">{c.api.ok ? <Tag tone={c.api.ms > 1500 ? "mid" : "ok"}>{ms(c.api.ms)}</Tag> : <Tag tone="bad">不通</Tag>}</Line>
          <Line k="服务状态">
            {c.status ? <Tag tone={c.status.ok ? "ok" : "mid"}>{c.status.ok ? "全部正常" : c.status.text}</Tag> : "—"}
          </Line>
        </div>

        <div className="nr-col">
          <h4>IP 属性</h4>
          <Line k="代理 / VPN">{r.risk?.proxy || info?.proxy ? <Tag tone="bad">已标记</Tag> : <Tag tone="ok">未检测到</Tag>}</Line>
          <Line k="风险分">{r.risk ? <Tag tone={r.risk.risk >= 50 ? "bad" : r.risk.risk >= 25 ? "mid" : "ok"}>{r.risk.risk} / 100</Tag> : "—"}</Line>
          <Line k="ASN">
            <span className="mono nr-trunc" title={info?.as}>
              {info?.as?.split(" ")[0] || "—"}
            </span>
          </Line>
          <Line k="运营商">
            <span className="nr-trunc" title={info?.org}>
              {r.risk?.provider || info?.org || "—"}
            </span>
          </Line>
        </div>

        <div className="nr-col">
          <h4>一致性</h4>
          <Line k="时区">
            {cs.tzOk ? (
              <Tag tone="ok">一致</Tag>
            ) : (
              <button className="nr-fix" onClick={() => onAlign({ tz: cs.ipTz })} title={`把环境时区改成 ${cs.ipTz}，下次开会话生效`}>
                <Tag tone="mid">不一致</Tag>
                <span>对齐</span>
              </button>
            )}
          </Line>
          <Line k="环境时区">
            <span className="mono nr-trunc">{cs.tz}</span>
          </Line>
          <Line k="出口时区">
            <span className="mono nr-trunc">{cs.ipTz || "—"}</span>
          </Line>
          <Line k="语言">
            {cs.langOk ? (
              <Tag tone="ok">{cs.lang.split(".")[0]}</Tag>
            ) : (
              <button
                className="nr-fix"
                onClick={() => onAlign({ lang: /^zh/i.test(cs.lang) ? "en_US.UTF-8" : "zh_CN.UTF-8" })}
                title={`环境 ${cs.lang}，跟出口所在地不搭。点一下改过来，下次开会话生效`}
              >
                <Tag tone="mid">{cs.lang.split(".")[0]}</Tag>
                <span>对齐</span>
              </button>
            )}
          </Line>
        </div>
      </div>

      <div className="nr-foot">
        <span>数据：claude.ai · ip-api.com · proxycheck.io{r.at ? ` · ${new Date(r.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        <button
          className="nr-more"
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            menu.open(
              { clientX: b.left, clientY: b.bottom + 4, preventDefault: () => {}, stopPropagation: () => {} },
              CHECKERS.map((x) => ({ label: x.label, hint: "↗", run: () => void window.claudeBuddy.openExternal(x.url(r.ip!)) })),
              `到第三方站点查 ${r.ip}`,
            );
          }}
        >
          更多评分 ↗
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
