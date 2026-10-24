import { useState } from "react";
import type { Account } from "../lib/model";
import { proxyLabel } from "../lib/model";
import type { IpInfo, NetTest, NetTarget } from "../lib/bridge";
import { flag } from "./IpBadge";
import Diagnose from "./Diagnose";
import Help from "./Help";
import { IconGlobe, IconRefresh } from "./iconAliases";
import StatusIcon from "./StatusIcon";

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

  if (api && api.okCount === 0) out.push({ tone: "bad", title: "连不上模型 API", body: `api.anthropic.com ${api.error ?? "无响应"}。Claude Code 完全用不了。` });
  else if (api && api.loss > 0) out.push({ tone: "bad", title: `API 有 ${api.loss}% 请求失败`, body: "线路不稳，长对话中途断开、工具调用超时多半是它。" });

  const badTls = r.targets.filter((t) => t.tlsOk === false);
  if (badTls.length)
    out.push({ tone: "bad", title: "证书校验没通过", body: `${badTls.map((t) => t.host).join("、")} 的 TLS 证书不被系统信任，可能有中间人（公司网关、抓包工具）。` });

  if (v6 && v4Country && v6.countryCode && v6.countryCode !== v4Country)
    out.push({
      tone: "mid",
      title: "IPv6 出口跟 IPv4 不在一个地方",
      body: `IPv4 从 ${where(v4)} 出去，IPv6 却是 ${where(v6)}。Claude 的域名有 IPv6 地址，程序要是走了 IPv6、代理又没接管 IPv6，就会绕开代理直连。必要时在代理软件里开启 IPv6 接管，或关掉系统 IPv6。`,
    });

  if (r.dns.some((d) => d.mismatch))
    out.push({ tone: "mid", title: "系统 DNS 跟 DoH 结果对不上", body: "可能被运营商 DNS 污染。用 TUN 或让代理接管 DNS 能避开。" });
  if (r.dns.some((d) => d.bogus)) out.push({ tone: "bad", title: "域名被解析到内网地址", body: "典型的 DNS 劫持，Claude 的请求会发到错误的地方。" });

  if (api && api.okCount > 0) {
    if (api.total > 2000) out.push({ tone: "mid", title: `API 往返偏慢（${ms(api.total)}）`, body: "每次请求都要等这么久起步，长任务会明显变慢。换近一点的节点能改善。" });
    else if (api.jitter > 400) out.push({ tone: "mid", title: `抖动偏大（±${ms(api.jitter)}）`, body: "延迟忽高忽低，流式输出会一顿一顿。" });
  }

  if (r.local.tunLikely) out.push({ tone: "info", title: "本机流量被 TUN 接管", body: "直连时到海外的 TCP 握手不到 3ms，物理上不可能 —— 说明代理软件的虚拟网卡在接管全部流量。所以「直连」其实也在走代理。" });
  if (r.local.fakeIp) out.push({ tone: "info", title: "DNS 是 fake-ip 模式", body: "域名被解析成 198.18.x.x 的假地址，由代理软件在远端解析。正常现象，不是污染。" });

  if (!out.some((f) => f.tone === "bad" || f.tone === "mid"))
    out.unshift({ tone: "ok", title: "线路正常", body: `${r.targets.filter((t) => t.okCount > 0).length}/${r.targets.length} 个域名都通，API 平均 ${api ? ms(api.total) : "—"}，没有失败、证书都校验通过。` });
  return out;
}

export default function NetTestPage({ accounts }: { accounts: Account[] }) {
  const routes = [{ id: null as string | null, label: "本机直连", sub: "不走任何环境的代理" }].concat(
    accounts.map((a) => ({
      id: a.id as string | null,
      label: a.label,
      // 没配代理的环境，实际走的就是本机网络，说清楚免得以为是另一条线
      sub: a.proxy.protocol === "none" ? "直连 · 跟本机一样" : proxyLabel(a.proxy),
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
          <h1>网络测试</h1>
          <p>测 Claude Code 实际会连的 {5} 个域名，每段耗时、抖动、失败率、DNS、IPv6 都拆开看</p>
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
                每个测 {n} 次
              </button>
            ))}
          </div>
          <button className="btn pri" onClick={() => void run()} disabled={busy}>
            {busy ? <span className="nr-spin" /> : <IconRefresh />}
            {busy ? "测试中…" : r ? "重新测试" : "开始测试"}
          </button>
        </div>
      </div>

      {err && <div className="cl-err">{err}</div>}

      {!r && !busy && (
        <div className="nt-empty">
          <IconGlobe size={22} />
          <b>选一条线路，点「开始测试」</b>
          <span>大约 15–40 秒。测试只发普通的 HTTPS 请求，不带任何账号凭据。</span>
        </div>
      )}
      {!r && busy && (
        <div className="nt-empty">
          <span className="nr-spin" />
          <b>正在逐个域名测试…</b>
          <span>每个域名串行测 {rounds} 次，避免互相抢带宽把抖动测歪</span>
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
            <Stat k="API 往返" v={api && api.okCount ? ms(api.total) : "—"} sub={api && api.okCount ? `最快 ${ms(api.min)} · 最慢 ${ms(api.max)}` : api?.error ?? ""} />
            <Stat k="抖动" v={api && api.okCount ? `±${ms(api.jitter)}` : "—"} sub="相邻两次的差，越小越稳" />
            <Stat k="失败率" v={`${Math.round(r.targets.reduce((s, t) => s + t.loss, 0) / r.targets.length)}%`} sub={`${r.targets.length} 个域名 × ${r.rounds} 次`} />
            <Stat k={r.route.proxy ? "线路出口" : "直连出口"} v={exitIp ?? "—"} mono sub={where(exit) || "查不到归属"} />
          </div>

          {/* 分阶段瀑布 */}
          <div className="nt-sec">
            <span>分阶段耗时</span>
            <span className="nt-legend">
              <i className="p-dns" />DNS
              <i className="p-tcp" />TCP
              <i className="p-tls" />TLS
              <i className="p-ttfb" />首字节
            </span>
          </div>
          <div className="nt-table">
            <div className="nt-tr nt-th">
              <span>域名</span>
              <span>耗时分布</span>
              <span className="r">总计</span>
              <span className="r">抖动</span>
              <span className="r">失败</span>
              <span className="r" title="只看请求有没有到达服务器。API 根路径回 404、安装源回 400 都是正常的">
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
                <span>DNS 解析</span>
                <Help title="怎么看 DNS">
                  <p>「系统」是这台电脑的 DNS 给的地址，「DoH」是走加密 DNS 拿到的干净结果。CDN 会按地区给不同地址，同网段就算一致。</p>
                  <p>198.18.x.x 是代理软件 fake-ip 模式的假地址，正常；解析到 10.x / 192.168.x 这种内网地址才是被劫持。</p>
                </Help>
              </div>
              <div className="em-card">
                {r.dns.map((d) => (
                  <div className="nt-kv" key={d.host}>
                    <span className="nt-k">
                      <b>{d.host}</b>
                      <small className="mono">系统 {d.sys.slice(0, 2).join(" · ") || "解析失败"}</small>
                      <small className="mono">
                        DoH{d.dohVia ? `（${d.dohVia}）` : ""} {d.doh ? d.doh.join(" · ") || "无结果" : "没拿到"}
                      </small>
                    </span>
                    <span className={`nr-tag ${d.bogus ? "bad" : d.mismatch ? "mid" : "ok"}`}>
                      {d.bogus ? "被劫持" : d.fake ? "fake-ip" : d.mismatch ? "不一致" : "一致"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 本机网络形态 */}
            <div>
              <div className="nt-sec">
                <span>本机网络</span>
              </div>
              <div className="em-card">
                <div className="nt-kv">
                  <span className="nt-k">
                    <b>系统代理</b>
                    <small className="mono">
                      {r.local.systemProxy?.length ? r.local.systemProxy.map((p) => `${p.kind} ${p.addr}`).join(" · ") : "没开"}
                    </small>
                  </span>
                  <span className={`nr-tag ${r.local.systemProxy?.length ? "ok" : ""}`}>{r.local.systemProxy?.length ? "已开" : "关"}</span>
                </div>
                <div className="nt-kv">
                  <span className="nt-k">
                    <b>TUN 接管</b>
                    <small>{r.local.tunLikely ? "到海外握手 < 3ms，流量被虚拟网卡接管" : r.route.proxy ? "走代理测试时不判断" : "没有迹象"}</small>
                  </span>
                  <span className={`nr-tag ${r.local.tunLikely ? "ok" : ""}`}>{r.local.tunLikely ? "是" : "否"}</span>
                </div>
                <div className="nt-kv">
                  <span className="nt-k">
                    <b>IPv6 出口</b>
                    <small className="mono">{r.local.ipv6 ?? "没有 IPv6"}</small>
                    {r.exitInfo.v6 && <small>{where(r.exitInfo.v6)}</small>}
                  </span>
                  <span className={`nr-tag ${r.local.ipv6 ? (r.exitInfo.v6?.countryCode && r.exitInfo.v6.countryCode !== exit?.countryCode ? "mid" : "ok") : ""}`}>
                    {r.local.ipv6 ? "有" : "无"}
                  </span>
                </div>
                <div className="nt-kv">
                  <span className="nt-k">
                    <b>本机直连出口</b>
                    <small className="mono">{r.exits.direct ?? "没拿到"}</small>
                    {r.exitInfo.direct && <small>{where(r.exitInfo.direct)}</small>}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="nt-foot">
            线路：{r.route.label}
            {r.route.proxy ? `（${r.route.proxy.replace(/\/\/[^@]*@/, "//")}）` : ""} · 用时 {(r.tookMs / 1000).toFixed(1)}s ·{" "}
            {new Date(r.at).toLocaleTimeString("zh-CN")} · 数据全部来自真实请求（curl 计时）
          </p>
        </div>
      )}

      {/* 403 卡在哪一层 —— 原来的连通诊断，保留在最下面 */}
      <div className="nt-sec nt-sec-big">
        <span>访问判定 · 403 卡在哪一层</span>
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
      <span className="nt-bar" title={`DNS ${t.dns}ms · TCP ${t.tcp}ms · TLS ${t.tls}ms · 首字节 ${t.ttfb}ms`}>
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
        <span className={`nr-tag ${tone}`} title={`${t.remoteIp} · HTTP/${t.http} · 证书${t.tlsOk ? "已校验" : "未校验"}`}>
          {t.okCount ? t.code : "不通"}
        </span>
      </span>
    </div>
  );
}
