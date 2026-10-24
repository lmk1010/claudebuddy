import { useEffect, useState } from "react";
import type { IpInfo } from "../lib/bridge";
import { useContextMenu } from "./ContextMenu";
import { tr } from "../lib/i18n";

/** 国家码 → 旗帜 emoji */
export function flag(cc: string): string {
  if (!/^[A-Z]{2}$/i.test(cc)) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * 出口 IP 的类型判断。
 *
 * 对 Claude 来说最要紧的是「像不像真人在用」：
 *   · 被标记成代理/VPN —— 最差，很多风控直接拦
 *   · 机房 IP（云服务器、IDC）—— 常见于梯子，纯净度一般
 *   · 移动网络 / 住宅宽带 —— 最像真人
 */
export function ipKind(i: IpInfo): { label: string; tone: "ok" | "mid" | "bad"; note: string } {
  if (i.proxy) return { label: tr("代理标记", "Flagged as proxy"), tone: "bad", note: tr("这个 IP 已被公开库标记为代理/VPN，风控概率高", "This IP is flagged as a proxy/VPN in public databases, so risk controls are likely to trigger") };
  if (i.hosting) return { label: tr("机房 IP", "Datacenter"), tone: "mid", note: tr("云服务器或 IDC 的 IP，不是家庭宽带，纯净度一般", "A cloud server or IDC address, not home broadband, so trust is only fair") };
  if (i.mobile) return { label: tr("移动网络", "Mobile"), tone: "ok", note: tr("运营商移动网络，看起来像手机热点", "Carrier mobile network, looks like a phone hotspot") };
  return { label: tr("住宅宽带", "Residential"), tone: "ok", note: tr("家庭/企业宽带，最像真人在用", "Home or business broadband, the most human-like") };
}

/** 去外部站点看更完整的纯净度评分 */
export const CHECKERS: { readonly label: string; url: (ip: string) => string }[] = [
  { get label() { return tr("ip.net.coffee · IP 评分", "ip.net.coffee · IP score"); }, url: (ip) => `https://ip.net.coffee/ip/?ip=${ip}` },
  { get label() { return tr("Scamalytics · 欺诈分", "Scamalytics · Fraud score"); }, url: (ip) => `https://scamalytics.com/ip/${ip}` },
  { get label() { return tr("IPinfo · 归属与类型", "IPinfo · Ownership and type"); }, url: (ip) => `https://ipinfo.io/${ip}` },
  { get label() { return tr("ping0 · 原生 / 广播", "ping0 · Native / broadcast"); }, url: (ip) => `https://ping0.cc/ip/${ip}` },
  { get label() { return tr("IPPure · 纯净度", "IPPure · Trust score"); }, url: (ip) => `https://ippure.com/?ip=${ip}` },
];

/**
 * 一行小字：🇺🇸 洛杉矶 · 运营商 · [住宅宽带]  查纯净度↗
 * 不占地方，放在任何显示出口 IP 的地方下面。
 */
export default function IpBadge({ ip, compact }: { ip: string | null | undefined; compact?: boolean }) {
  const [info, setInfo] = useState<IpInfo | null | undefined>(undefined);
  const menu = useContextMenu();

  useEffect(() => {
    if (!ip) {
      setInfo(undefined);
      return;
    }
    let alive = true;
    setInfo(undefined);
    void window.claudeBuddy.ipInfo(ip).then((r) => alive && setInfo(r));
    return () => {
      alive = false;
    };
  }, [ip]);

  if (!ip) return null;
  const k = info ? ipKind(info) : null;
  const place = info ? [info.city || info.region, info.country].filter(Boolean).join(" · ") : "";

  return (
    <span className={`ipb${compact ? " compact" : ""}`}>
      {info === undefined ? (
        <span className="ipb-dim">{tr("查询归属…", "Looking up location…")}</span>
      ) : info === null ? (
        <span className="ipb-dim">{tr("归属查不到", "Location unavailable")}</span>
      ) : (
        <>
          <span className="ipb-geo" title={`${info.as}\n${info.org}`}>
            {flag(info.countryCode)} {place}
            {!compact && info.isp ? ` · ${info.isp}` : ""}
          </span>
          {k && (
            <span className={`ipb-kind ${k.tone}`} title={k.note}>
              {k.label}
            </span>
          )}
        </>
      )}
      {/* span 而不是 button：徽章常被放进可点击的卡片里，按钮套按钮不合法 */}
      <span
        role="button"
        tabIndex={0}
        className="ipb-more"
        title={tr("在第三方网站查这个 IP 的纯净度", "Check this IP's trust score on a third-party site")}
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          menu.open(
            { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => e.stopPropagation() },
            CHECKERS.map((c) => ({ label: c.label, hint: "↗", run: () => void window.claudeBuddy.openExternal(c.url(ip)) })),
            tr(`查 ${ip} 的纯净度`, `Trust score for ${ip}`),
          );
        }}
      >
        {tr("查纯净度 ↗", "Check trust ↗")}
      </span>
      {menu.node}
    </span>
  );
}
