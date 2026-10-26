import { useEffect, useRef, useState } from "react";
import { tr } from "../lib/i18n";
import type { ExitConnection, ExitConnections } from "../lib/bridge";
import type { Exit } from "../lib/model";
import Modal from "./Modal";
import { IconRefresh } from "./iconAliases";

/**
 * 出口连接监控。
 *
 * 回答的是一个此前完全看不到的问题：**到底有哪些请求真的走了这个代理？**
 * 之前界面上只有一个出口 IP，那是"结果"；至于某个请求是走了代理还是漏到
 * 直连了，只能靠猜。
 *
 * 数据来自这个实例自己的 mihomo API（`/connections`），不是抓包、也不是
 * 从终端输出里猜 —— 那是内核自己记的账：目标域名、走的节点链、上下行字节。
 *
 * 两个层次：
 *   · 累计流量 —— 实例启动以来的总字节，证明"这个出口确实在承载流量"
 *   · 连接列表 —— 此刻还开着的连接。短连接（curl 一下就结束）在这里一闪就没了，
 *     所以额外累积一份「见过的域名」，否则用户什么也留不下。
 */

const POLL_MS = 1500;

/** 见过一次的域名记录 */
type Seen = { host: string; chains: string[]; up: number; down: number; hits: number; last: number };

/**
 * 这是不是"要命的那条流量"。
 *
 * 其他域名走了代理、没走代理，后果有限；只有 Claude 自己的 API 流量
 * 决定了服务端把这次请求算在哪个出口上。所以单独标出来一眼能看到，
 * 不用在几十行域名里找。
 */
function isCritical(host: string) {
  return /anthropic|claude/i.test(host);
}

function fmtBytes(n: number) {
  if (!n) return "0";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export default function ExitMonitor({ exit, onClose }: { exit: Exit; onClose: () => void }) {
  const [data, setData] = useState<ExitConnections | null>(null);
  const [seen, setSeen] = useState<Record<string, Seen>>({});
  const [live, setLive] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** 上一次的累计字节，用来算速率 */
  const prev = useRef<{ up: number; down: number; at: number } | null>(null);
  const [rate, setRate] = useState({ up: 0, down: 0 });

  useEffect(() => {
    if (!live) return;
    let stop = false;

    const tick = async () => {
      try {
        const r = await window.claudeBuddy.exitConnections({ exitId: exit.id });
        if (stop) return;
        setData(r);
        setErr(r.ok ? null : (r.reason ?? null));

        /**
         * 累积"见过的域名"。
         *
         * 短连接在下一次轮询前就关了 —— 只显示实时列表的话，用户 curl 一下
         * 什么都看不到，会以为代理没生效。累积一份，至少留下痕迹。
         */
        if (r.ok && r.list.length) {
          setSeen((m) => {
            const next = { ...m };
            for (const c of r.list) {
              if (!c.host) continue;
              const key = c.host;
              const cur = next[key];
              next[key] = {
                host: c.host,
                chains: c.chains,
                up: Math.max(cur?.up ?? 0, c.up),
                down: Math.max(cur?.down ?? 0, c.down),
                hits: (cur?.hits ?? 0) + 1,
                last: Date.now(),
              };
            }
            return next;
          });
        }

        // 速率：用两次累计值的差除以时间
        const p = prev.current;
        if (r.ok && p) {
          const dt = (Date.now() - p.at) / 1000;
          if (dt > 0) {
            setRate({
              up: Math.max(0, (r.up - p.up) / dt),
              down: Math.max(0, (r.down - p.down) / dt),
            });
          }
        }
        if (r.ok) prev.current = { up: r.up, down: r.down, at: Date.now() };
      } catch (e) {
        if (!stop) setErr((e as Error)?.message ?? String(e));
      }
    };

    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [exit.id, live]);

  const conns: ExitConnection[] = data?.list ?? [];
  const seenList = Object.values(seen).sort((a, b) => b.last - a.last);
  /** Claude 自己的流量走没走这个出口 —— 被封与否看的就是这个 */
  const critical = seenList.filter((s) => isCritical(s.host));
  const criticalDown = critical.reduce((n, s) => n + s.down, 0);

  const clear = async () => {
    await window.claudeBuddy.exitClearConnections({ exitId: exit.id });
    setSeen({});
    prev.current = null;
    setRate({ up: 0, down: 0 });
  };

  return (
    <Modal onClose={onClose} className="mon" label={tr("连接监控", "Connections")}>
      {(close) => (
        <>
          <div className="mon-head">
            <div>
              <b>{tr("连接监控", "Connections")}</b>
              <small>
                {exit.managed?.node ?? exit.label}
                {" · "}
                <span className="mono">
                  {exit.proxy.host}:{exit.proxy.port}
                </span>
              </small>
            </div>
            <button className="ib" onClick={close} title={tr("关闭", "Close")}>
              ✕
            </button>
          </div>

          <div className="mon-stats">
            <div className="mon-stat">
              <span>{tr("累计上行", "Total up")}</span>
              <b className="mono">{fmtBytes(data?.up ?? 0)}</b>
              {rate.up > 0 && <small className="mono">{fmtBytes(rate.up)}/s</small>}
            </div>
            <div className="mon-stat">
              <span>{tr("累计下行", "Total down")}</span>
              <b className="mono">{fmtBytes(data?.down ?? 0)}</b>
              {rate.down > 0 && <small className="mono">{fmtBytes(rate.down)}/s</small>}
            </div>
            <div className="mon-stat">
              <span>{tr("当前连接", "Active")}</span>
              <b className="mono">{conns.length}</b>
            </div>
            <div className="mon-acts">
              <button className="det-k" onClick={() => setLive((v) => !v)}>
                {live ? tr("暂停", "Pause") : tr("继续", "Resume")}
              </button>
              <button className="det-k" onClick={() => void clear()}>
                <IconRefresh size={11} />
                {tr("清空", "Clear")}
              </button>
            </div>
          </div>

          {err && <div className="mon-err">{err}</div>}

          <div className="mon-body">
            <div className="mon-sec">
              <div className="mon-sec-h">
                <span>{tr("正在连接", "Active connections")}</span>
                <small>{tr("此刻还开着的", "Still open right now")}</small>
              </div>
              {conns.length === 0 ? (
                <div className="mon-empty">
                  {tr(
                    "现在没有活跃连接。开个会话、或者在终端里跑条 curl，这里就会冒出来。",
                    "No active connections. Start a session or run a curl in a terminal and it shows up here.",
                  )}
                </div>
              ) : (
                <div className="mon-rows">
                  {conns.map((c) => (
                    <div className="mon-row" key={c.id}>
                      <span className="mon-host" title={c.destIp || c.host}>
                        {c.host || c.destIp}
                      </span>
                      <span className="mon-chain mono">{c.chains.join(" → ") || "—"}</span>
                      <span className="mon-bytes mono">
                        ↑{fmtBytes(c.up)} ↓{fmtBytes(c.down)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mon-sec">
              <div className="mon-sec-h">
                <span>{tr("走过的域名", "Hosts seen")}</span>
                <small>{tr("包括已经关掉的短连接", "Includes short connections that already closed")}</small>
              </div>
              {/* Claude 自己的流量单独报一下：这是唯一决定"算在哪条出口"的流量 */}
              <div className={`mon-crit${critical.length ? " on" : ""}`}>
                {critical.length ? (
                  <>
                    <b>{tr("Claude 流量已走这个出口", "Claude traffic went through this exit")}</b>
                    <small>
                      {tr(
                        `${critical.length} 个域名 · 下行 ${fmtBytes(criticalDown)}`,
                        `${critical.length} host(s) · ${fmtBytes(criticalDown)} down`,
                      )}
                    </small>
                  </>
                ) : (
                  <small>
                    {tr(
                      "还没看到 Claude 自己的流量（api.anthropic.com）。在这个环境里发一句话就会冒出来。",
                      "No Claude traffic yet (api.anthropic.com). Send one message in this environment and it shows up.",
                    )}
                  </small>
                )}
              </div>
              {seenList.length === 0 ? (
                <div className="mon-empty">{tr("还没看到流量。", "No traffic seen yet.")}</div>
              ) : (
                <div className="mon-rows">
                  {seenList.map((s) => (
                    <div className={`mon-row${isCritical(s.host) ? " crit" : ""}`} key={s.host}>
                      <span className="mon-host" title={s.host}>
                        {s.host}
                      </span>
                      <span className="mon-chain mono">{s.chains.join(" → ") || "—"}</span>
                      <span className="mon-bytes mono">↓{fmtBytes(s.down)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mon-foot">
            <span className="mon-note">
              {tr(
                "数据来自这个出口自己的 mihomo 内核（只绑本机、带随机密钥），不是抓包。",
                "Data comes from this exit's own mihomo kernel (loopback only, random secret) — not packet capture.",
              )}
            </span>
            <button className="btn" onClick={close}>
              {tr("关闭", "Close")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}