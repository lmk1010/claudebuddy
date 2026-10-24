import { useState } from "react";
import type { Account } from "../lib/model";
import { proxyLabel } from "../lib/model";
import type { IpInfo, NetTest, NetTarget } from "../lib/bridge";
import { flag } from "./IpBadge";
import Diagnose from "./Diagnose";
import Help from "./Help";
import { IconGlobe, IconRefresh } from "./iconAliases";
import StatusIcon from "./StatusIcon";
import { tr } from "../lib/i18n";

/**
 * 网络测试 —— 专业版连通测试，单独一整页。
 *
 * 不是「通 / 不通」两个字：把 Claude Code 会连的每个域名拆成 DNS → TCP → TLS → 首字节四段计时，
 * 连测几次给均值、抖动、失败率；再看 DNS 有没有被污染、本机是不是 TUN / fake-ip、IPv6 会不会绕开代理。
 * 最上面是从这些数据里直接读出来的结论，下面是原始数字，结论可以对着数字核。
 */

type Tone = "ok" | "mid" | "bad" | "info";
type Finding = { tone: Tone; title: string; body: string };

function ms(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n}ms`;
}

function where(i: IpInfo | null | undefined) {
  if (!i) return "";
  return [flag(i.countryCode), [i.city || i.region, i.country].filter(Boolean).join(" · "), i.isp].filter(Boolean).join(" ");
}

/** 从数据里读结论。每一条都要能在下面的数字里找到依据 */
function findings(r: NetTest): Finding[] {
  const out: Finding[] = [];
  const api = r.targets.find((t) => t.id === "api");
  const v4 = r.route.proxy ? r.exitInfo.route : r.exitInfo.direct;
  const v4Country = v4?.countryCode;
  const v6 = r.exitInfo.v6;

  if (api && api.okCount === 0)
    out.push({
      tone: "bad",
      title: tr("连不上模型 API", "Cannot reach the model API"),
      body: tr(`api.anthropic.com ${api.error ?? "无响应"}。Claude Code 完全用不了。`, `api.anthropic.com ${api.error ?? "no response"}. Claude Code will not work at all.`),
    });
  else if (api && api.loss > 0)
    out.push({
      tone: "bad",
      title: tr(`API 有 ${api.loss}% 请求失败`, `${api.loss}% of API requests failed`),
      body: tr("线路不稳，长对话中途断开、工具调用超时多半是它。", "The route is unstable. This is likely why long chats drop midway or tool calls time out."),
    });

  const badTls = r.targets.filter((t) => t.tlsOk === false);
  if (badTls.length)
    out.push({
      tone: "bad",
      title: tr("证书校验没通过", "Certificate check failed"),
      body: tr(
        `${badTls.map((t) => t.host).join("、")} 的 TLS 证书不被系统信任，可能有中间人（公司网关、抓包工具）。`,
        `The TLS certificate for ${badTls.map((t) => t.host).join(", ")} is not trusted by the system. There may be a man in the middle (corporate gateway, packet capture tool).`,
      ),
    });

  if (v6 && v4Country && v6.countryCode && v6.countryCode !== v4Country)
    out.push({
      tone: "mid",
      title: tr("IPv6 出口跟 IPv4 不在一个地方", "IPv6 exit is in a different place than IPv4"),
      body: tr(
        `IPv4 从 ${where(v4)} 出去，IPv6 却是 ${where(v6)}。Claude 的域名有 IPv6 地址，程序要是走了 IPv6、代理又没接管 IPv6，就会绕开代理直连。必要时在代理软件里开启 IPv6 接管，或关掉系统 IPv6。`,
        `IPv4 exits from ${where(v4)}, but IPv6 exits from ${where(v6)}. Claude's domains have IPv6 addresses, so if a program uses IPv6 and the proxy does not handle IPv6, traffic bypasses the proxy. If needed, enable IPv6 handling in your proxy app or turn off system IPv6.`,
      ),
    });

  if (r.dns.some((d) => d.mismatch))
    out.push({
      tone: "mid",
      title: tr("系统 DNS 跟 DoH 结果对不上", "System DNS and DoH results differ"),
      body: tr("可能被运营商 DNS 污染。用 TUN 或让代理接管 DNS 能避开。", "Your carrier's DNS may be poisoned. Use TUN or let the proxy handle DNS to avoid it."),
    });
  if (r.dns.some((d) => d.bogus))
    out.push({
      tone: "bad",
      title: tr("域名被解析到内网地址", "Domain resolved to a private address"),
      body: tr("典型的 DNS 劫持，Claude 的请求会发到错误的地方。", "A classic DNS hijack. Claude's requests will be sent to the wrong place."),
    });

  if (api && api.okCount > 0) {
    if (api.total > 2000)
      out.push({
        tone: "mid",
        title: tr(`API 往返偏慢（${ms(api.total)}）`, `API round trip is slow (${ms(api.total)})`),
        body: tr("每次请求都要等这么久起步，长任务会明显变慢。换近一点的节点能改善。", "Every request waits this long before it starts, so long tasks will be noticeably slower. A closer node can help."),
      });
    else if (api.jitter > 400)
      out.push({
        tone: "mid",
        title: tr(`抖动偏大（±${ms(api.jitter)}）`, `High jitter (±${ms(api.jitter)})`),
        body: tr("延迟忽高忽低，流式输出会一顿一顿。", "Latency swings up and down, so streaming output will stutter."),
      });
  }

  if (r.local.tunLikely)
    out.push({
      tone: "info",
      title: tr("本机流量被 TUN 接管", "Traffic on this Mac is handled by TUN"),
      body: tr(
        "直连时到海外的 TCP 握手不到 3ms，物理上不可能 —— 说明代理软件的虚拟网卡在接管全部流量。所以「直连」其实也在走代理。",
        "A direct TCP handshake to an overseas host took under 3ms, which is physically impossible. The proxy app's virtual adapter is taking over all traffic, so \"direct\" is actually going through a proxy too.",
      ),
    });
  if (r.local.fakeIp)
    out.push({
      tone: "info",
      title: tr("DNS 是 fake-ip 模式", "DNS is in fake-ip mode"),
      body: tr("域名被解析成 198.18.x.x 的假地址，由代理软件在远端解析。正常现象，不是污染。", "Domains resolve to fake 198.18.x.x addresses and the proxy app resolves them remotely. This is normal, not poisoning."),
    });

  if (!out.some((f) => f.tone === "bad" || f.tone === "mid")) {
    const okN = r.targets.filter((t) => t.okCount > 0).length;
    out.unshift({
      tone: "ok",
      title: tr("线路正常", "Route is healthy"),
      body: tr(
        `${okN}/${r.targets.length} 个域名都通，API 平均 ${api ? ms(api.total) : "—"}，没有失败、证书都校验通过。`,
        `${okN}/${r.targets.length} domains reachable, API average ${api ? ms(api.total) : "—"}, no failures, and all certificates verified.`,
      ),
    });
  }
  return out;
}

export default function NetTestPage({ accounts }: { accounts: Account[] }) {
  const routes = [{ id: null as string | null, label: tr("本机直连", "Direct from this Mac"), sub: tr("不走任何环境的代理", "Bypasses every environment's proxy") }].concat(
    accounts.map((a) => ({
      id: a.id as string | null,
      label: a.label,
      // 没配代理的环境，实际走的就是本机网络，说清楚免得以为是另一条线
      sub: a.proxy.protocol === "none" ? tr("直连 · 跟本机一样", "Direct · same as this Mac") : proxyLabel(a.proxy),
    })),
  );
  const [route, setRoute] = useState<string | null>(null);
  const [rounds, setRounds] = useState(4);
  const [r, setR] = useState<NetTest | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setR(await window.claudeBuddy.netTest(route, rounds));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const maxTotal = r ? Math.max(1, ...r.targets.map((t) => t.dns + t.tcp + t.tls + t.ttfb)) : 1;
  const api = r?.targets.find((t) => t.id === "api");
  const exit = r ? (r.route.proxy ? r.exitInfo.route : r.exitInfo.direct) : null;
  const exitIp = r ? (r.route.proxy ? r.exits.route : r.exits.direct) : null;

  return (
    <div className="sv nt">
      <div className="sv-h">
        <div>
          <h1>{tr("网络测试", "Network test")}</h1>
          <p>{tr(`测 Claude Code 实际会连的 ${5} 个域名，每段耗时、抖动、失败率、DNS、IPv6 都拆开看`, `Tests the ${5} domains Claude Code actually connects to, with timing per stage, jitter, failure rate, DNS and IPv6 broken out`)}</p>
        </div>
      </div>

      {/* 测什么、怎么测 */}
      <div className="nt-ctl">
        <div className="nt-routes">
          {routes.map((x) => (
            <button key={x.id ?? "direct"} className={`nt-route${route === x.id ? " on" : ""}`} onClick={() => setRoute(x.id)}>
              <b>{x.label}</b>
              <small className="mono">{x.sub}</small>
            </button>
          ))}
        </div>
        <div className="nt-go">
          <div className="seg sm">
            {[4, 8].map((n) => (
              <button key={n} className={rounds === n ? "on" : ""} onClick={() => setRounds(n)}>
                {tr(`每个测 ${n} 次`, `${n} rounds each`)}
              </button>
            ))}
          </div>
          <button className="btn pri" onClick={() => void run()} disabled={busy}>
            {busy ? <span className="nr-spin" /> : <IconRefresh />}
            {busy ? tr("测试中…", "Testing…") : r ? tr("重新测试", "Test again") : tr("开始测试", "Start test")}
          </button>
        </div>
      </div>

      {err && <div className="cl-err">{err}</div>}

      {!r && !busy && (
        <div className="nt-empty">
          <IconGlobe size={22} />
          <b>{tr("选一条线路，点「开始测试」", "Pick a route and click \"Start test\"")}</b>
          <span>{tr("大约 15–40 秒。测试只发普通的 HTTPS 请求，不带任何账号凭据。", "Takes about 15 to 40 seconds. The test only sends plain HTTPS requests and carries no account credentials.")}</span>
        </div>
      )}
      {!r && busy && (
        <div className="nt-empty">
          <span className="nr-spin" />
          <b>{tr("正在逐个域名测试…", "Testing each domain…")}</b>
          <span>{tr(`每个域名串行测 ${rounds} 次，避免互相抢带宽把抖动测歪`, `Each domain is tested ${rounds} times in sequence so they don't compete for bandwidth and skew jitter`)}</span>
        </div>
      )}

      {r && (
        <div className={busy ? "nt-busy" : ""} key={r.at}>
          {/* 结论 */}
          <div className="nt-finds">
            {findings(r).map((f) => (
              <div key={f.title} className={`nt-find ${f.tone}`}>
                <StatusIcon tone={f.tone} size={22} />
                <div>
                  <b>{f.title}</b>
                  <p>{f.body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 四个关键数 */}
          <div className="nt-stats">
            <Stat k={tr("API 往返", "API round trip")} v={api && api.okCount ? ms(api.total) : "—"} sub={api && api.okCount ? tr(`最快 ${ms(api.min)} · 最慢 ${ms(api.max)}`, `Fastest ${ms(api.min)} · slowest ${ms(api.max)}`) : api?.error ?? ""} />
            <Stat k={tr("抖动", "Jitter")} v={api && api.okCount ? `±${ms(api.jitter)}` : "—"} sub={tr("相邻两次的差，越小越稳", "Difference between consecutive runs; smaller is steadier")} />
            <Stat k={tr("失败率", "Failure rate")} v={`${Math.round(r.targets.reduce((s, t) => s + t.loss, 0) / r.targets.length)}%`} sub={tr(`${r.targets.length} 个域名 × ${r.rounds} 次`, `${r.targets.length} domains × ${r.rounds} rounds`)} />
            <Stat k={r.route.proxy ? tr("线路出口", "Route exit") : tr("直连出口", "Direct exit")} v={exitIp ?? "—"} mono sub={where(exit) || tr("查不到归属", "Location unavailable")} />
          </div>

          {/* 分阶段瀑布 */}
          <div className="nt-sec">
            <span>{tr("分阶段耗时", "Time per stage")}</span>
            <span className="nt-legend">
              <i className="p-dns" />DNS
              <i className="p-tcp" />TCP
              <i className="p-tls" />TLS
              <i className="p-ttfb" />{tr("首字节", "TTFB")}
            </span>
          </div>
          <div className="nt-table">
            <div className="nt-tr nt-th">
              <span>{tr("域名", "Domain")}</span>
              <span>{tr("耗时分布", "Time breakdown")}</span>
              <span className="r">{tr("总计", "Total")}</span>
              <span className="r">{tr("抖动", "Jitter")}</span>
              <span className="r">{tr("失败", "Failed")}</span>
              <span className="r" title={tr("只看请求有没有到达服务器。API 根路径回 404、安装源回 400 都是正常的", "Only checks whether the request reached the server. A 404 from the API root or a 400 from the install source is normal")}>
                HTTP
              </span>
            </div>
            {r.targets.map((t) => (
              <TargetRow key={t.id} t={t} max={maxTotal} />
            ))}
          </div>

          <div className="nt-two">
            {/* DNS */}
            <div>
              <div className="nt-sec">
                <span>{tr("DNS 解析", "DNS resolution")}</span>
                <Help title={tr("怎么看 DNS", "How to read DNS")}>
                  <p>{tr("「系统」是这台电脑的 DNS 给的地址，「DoH」是走加密 DNS 拿到的干净结果。CDN 会按地区给不同地址，同网段就算一致。", "\"System\" is the address from this Mac's DNS; \"DoH\" is the clean result from encrypted DNS. CDNs hand out different addresses by region, and the same subnet counts as a match.")}</p>
                  <p>{tr("198.18.x.x 是代理软件 fake-ip 模式的假地址，正常；解析到 10.x / 192.168.x 这种内网地址才是被劫持。", "198.18.x.x is the fake address from a proxy app's fake-ip mode and is normal. Resolving to a private address such as 10.x or 192.168.x means hijacking.")}</p>
                </Help>
              </div>
              <div className="em-card">
                {r.dns.map((d) => (
                  <div className="nt-kv" key={d.host}>
                    <span className="nt-k">
                      <b>{d.host}</b>
                      <small className="mono">{tr("系统", "System")} {d.sys.slice(0, 2).join(" · ") || tr("解析失败", "Resolution failed")}</small>
                      <small className="mono">
                        DoH{d.dohVia ? tr(`（${d.dohVia}）`, ` (${d.dohVia})`) : ""} {d.doh ? d.doh.join(" · ") || tr("无结果", "No result") : tr("没拿到", "Unavailable")}
                      </small>
                    </span>
                    <span className={`nr-tag ${d.bogus ? "bad" : d.mismatch ? "mid" : "ok"}`}>
                      {d.bogus ? tr("被劫持", "Hijacked") : d.fake ? "fake-ip" : d.mismatch ? tr("不一致", "Mismatch") : tr("一致", "Match")}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 本机网络形态 */}
            <div>
              <div className="nt-sec">
                <span>{tr("本机网络", "This Mac's network")}</span>
              </div>
              <div className="em-card">
                <div className="nt-kv">
                  <span className="nt-k">
                    <b>{tr("系统代理", "System proxy")}</b>
                    <small className="mono">
                      {r.local.systemProxy?.length ? r.local.systemProxy.map((p) => `${p.kind} ${p.addr}`).join(" · ") : tr("没开", "Off")}
                    </small>
                  </span>
                  <span className={`nr-tag ${r.local.systemProxy?.length ? "ok" : ""}`}>{r.local.systemProxy?.length ? tr("已开", "On") : tr("关", "Off")}</span>
                </div>
                <div className="nt-kv">
                  <span className="nt-k">
                    <b>{tr("TUN 接管", "TUN takeover")}</b>
                    <small>{r.local.tunLikely ? tr("到海外握手 < 3ms，流量被虚拟网卡接管", "Overseas handshake under 3ms; traffic is taken over by a virtual adapter") : r.route.proxy ? tr("走代理测试时不判断", "Not checked when testing through a proxy") : tr("没有迹象", "No sign of it")}</small>
                  </span>
                  <span className={`nr-tag ${r.local.tunLikely ? "ok" : ""}`}>{r.local.tunLikely ? tr("是", "Yes") : tr("否", "No")}</span>
                </div>
                <div className="nt-kv">
                  <span className="nt-k">
                    <b>{tr("IPv6 出口", "IPv6 exit")}</b>
                    <small className="mono">{r.local.ipv6 ?? tr("没有 IPv6", "No IPv6")}</small>
                    {r.exitInfo.v6 && <small>{where(r.exitInfo.v6)}</small>}
                  </span>
                  <span className={`nr-tag ${r.local.ipv6 ? (r.exitInfo.v6?.countryCode && r.exitInfo.v6.countryCode !== exit?.countryCode ? "mid" : "ok") : ""}`}>
                    {r.local.ipv6 ? tr("有", "Yes") : tr("无", "No")}
                  </span>
                </div>
                <div className="nt-kv">
                  <span className="nt-k">
                    <b>{tr("本机直连出口", "Direct exit of this Mac")}</b>
                    <small className="mono">{r.exits.direct ?? tr("没拿到", "Unavailable")}</small>
                    {r.exitInfo.direct && <small>{where(r.exitInfo.direct)}</small>}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="nt-foot">
            {tr("线路：", "Route: ")}{r.route.label}
            {r.route.proxy ? tr(`（${r.route.proxy.replace(/\/\/[^@]*@/, "//")}）`, ` (${r.route.proxy.replace(/\/\/[^@]*@/, "//")})`) : ""} · {tr("用时", "Took")} {(r.tookMs / 1000).toFixed(1)}s ·{" "}
            {new Date(r.at).toLocaleTimeString(tr("zh-CN", "en-US"))} · {tr("数据全部来自真实请求（curl 计时）", "All data comes from real requests (timed with curl)")}
          </p>
        </div>
      )}

      {/* 403 卡在哪一层 —— 原来的连通诊断，保留在最下面 */}
      <div className="nt-sec nt-sec-big">
        <span>{tr("访问判定 · 403 卡在哪一层", "Access verdict · which layer returns 403")}</span>
      </div>
      <Diagnose part="net" embedded />
    </div>
  );
}

function Stat({ k, v, sub, mono }: { k: string; v: string; sub: string; mono?: boolean }) {
  return (
    <div className="nt-stat">
      <span>{k}</span>
      <b className={mono ? "mono" : ""}>{v}</b>
      <small title={sub}>{sub}</small>
    </div>
  );
}

function TargetRow({ t, max }: { t: NetTarget; max: number }) {
  const seg = (v: number) => `${(v / max) * 100}%`;
  const tone = t.okCount === 0 ? "bad" : t.loss > 0 || t.tlsOk === false ? "mid" : "ok";
  return (
    <div className="nt-tr">
      <span className="nt-host">
        <b>{t.host}</b>
        <small>{t.role}</small>
      </span>
      <span className="nt-bar" title={`DNS ${t.dns}ms · TCP ${t.tcp}ms · TLS ${t.tls}ms · TTFB ${t.ttfb}ms`}>
        {t.okCount === 0 ? (
          <em>{t.error}</em>
        ) : (
          <>
            <i className="p-dns" style={{ width: seg(t.dns) }} />
            <i className="p-tcp" style={{ width: seg(t.tcp) }} />
            <i className="p-tls" style={{ width: seg(t.tls) }} />
            <i className="p-ttfb" style={{ width: seg(t.ttfb) }} />
          </>
        )}
      </span>
      <span className="r mono">{t.okCount ? ms(t.total) : "—"}</span>
      <span className="r mono">{t.okCount > 1 ? `±${t.jitter}` : "—"}</span>
      <span className={`r mono${t.loss ? " nt-loss" : ""}`}>{t.loss}%</span>
      <span className="r">
        <span className={`nr-tag ${tone}`} title={`${t.remoteIp} · HTTP/${t.http} · ${t.tlsOk ? tr("证书已校验", "Certificate verified") : tr("证书未校验", "Certificate not verified")}`}>
          {t.okCount ? t.code : tr("不通", "Unreachable")}
        </span>
      </span>
    </div>
  );
}
