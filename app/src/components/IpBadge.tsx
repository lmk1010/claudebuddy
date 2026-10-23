import { useEffect, useState } from "react";
import type { IpInfo } from "../lib/bridge";
import { useContextMenu } from "./ContextMenu";

/** 国家码 → 旗帜 emoji */
function flag(cc: string): string {
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
  if (i.proxy) return { label: "代理标记", tone: "bad", note: "这个 IP 已被公开库标记为代理/VPN，风控概率高" };
  if (i.hosting) return { label: "机房 IP", tone: "mid", note: "云服务器或 IDC 的 IP，不是家庭宽带，纯净度一般" };
  if (i.mobile) return { label: "移动网络", tone: "ok", note: "运营商移动网络，看起来像手机热点" };
  return { label: "住宅宽带", tone: "ok", note: "家庭/企业宽带，最像真人在用" };
}

/** 去外部站点看更完整的纯净度评分 */
const CHECKERS: { label: string; url: (ip: string) => string }[] = [
  { label: "Scamalytics · 欺诈分", url: (ip) => `https://scamalytics.com/ip/${ip}` },
  { label: "IPinfo · 归属与类型", url: (ip) => `https://ipinfo.io/${ip}` },
  { label: "ping0 · 原生 / 广播", url: (ip) => `https://ping0.cc/ip/${ip}` },
  { label: "IPPure · 纯净度", url: (ip) => `https://ippure.com/?ip=${ip}` },
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
        <span className="ipb-dim">查询归属…</span>
      ) : info === null ? (
        <span className="ipb-dim">归属查不到</span>
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
        title="在第三方网站查这个 IP 的纯净度"
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          menu.open(
            { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => e.stopPropagation() },
            CHECKERS.map((c) => ({ label: c.label, hint: "↗", run: () => void window.claudeBuddy.openExternal(c.url(ip)) })),
            `查 ${ip} 的纯净度`,
          );
        }}
      >
        查纯净度 ↗
      </span>
      {menu.node}
    </span>
  );
}
