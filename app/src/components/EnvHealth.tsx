import { useEffect } from "react";
import type { Account, AccountStatusSnapshot, AuthState } from "../lib/model";
import { healthOf } from "../lib/model";
import type { DesktopProbe, LeakReport, TraceItem } from "../lib/bridge";
import { tr } from "../lib/i18n";
import { IconCheck } from "./iconAliases";

/**
 * 环境抽屉里的「健康评分」。
 *
 * 它不是一个总览页，而是「这个环境现在怎么样」的就地体检：
 * 先把分和扣分项摆出来，然后每条能自己修的直接带按钮 —— 不把人甩到
 * 另一个菜单去自己找。
 *
 *   · 痕迹 / 遥测还在        → 就地清掉
 *   · 设备码没生成或跟人撞了 → 就地换一个
 *   · 出口没测过             → 就地测一次
 *   · 没登录 / 没配出口      → 跳过去（这两件必须你输入，替不了）
 *   · Desktop / STUN         → 不归我们管，说清楚就行，不装作能修
 */

/** 健康页里的一条：一句问题、一句原因、一个能按的按钮 */
export function HealthItem({
  level,
  title,
  why,
  detail,
  action,
}: {
  level: "danger" | "warn" | "info";
  title: string;
  why?: string;
  detail?: string;
  action?: { label: string; run: () => void; disabled?: boolean };
}) {
  return (
    <div className={`rk-i lv-${level}`}>
      <div className="rk-t">
        <b>{title}</b>
      </div>
      {why && <p>{why}</p>}
      {detail && <p className="rk-d">{detail}</p>}
      {action && (
        <button className="btn" onClick={action.run} disabled={action.disabled}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export default function HealthSection({
  account,
  status,
  exitIp,
  auth,
  peers,
  desktop,
  leak,
  traces,
  busy,
  onGo,
  onLogin,
  onRotate,
  onCheckExit,
  onLoadTraces,
  onClearTraces,
}: {
  account: Account;
  status: AccountStatusSnapshot | undefined;
  exitIp: string | null;
  auth: AuthState;
  peers: Account[];
  desktop: DesktopProbe | null;
  leak: LeakReport | null;
  traces: TraceItem[] | undefined;
  busy: boolean;
  onGo: (sec: "health" | "general" | "network" | "fingerprint" | "sessions" | "clean") => void;
  onLogin: (browser?: string) => void;
  onRotate: () => void;
  onCheckExit: () => void;
  onLoadTraces: () => void;
  onClearTraces: (keys: string[]) => void;
}) {
  useEffect(() => {
    onLoadTraces();
    // 只在打开这一页时扫一次，后面交给用户主动点刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const others = peers.filter((a) => a.id !== account.id);
  const ip = exitIp ?? account.lastExitIp ?? null;
  const stunDetected = Boolean(leak?.stunDetected);
  const desktopRunning = Boolean(desktop?.running);

  const h = healthOf(account, status, exitIp, peers, { stunDetected, desktopRunning });

  const dirty = (traces ?? []).filter((t) => t.exists && !t.machineWide && t.size > 0);
  const machineDirty = (traces ?? []).filter((t) => t.exists && t.machineWide && t.size > 0);

  const proxied = Boolean(account.proxy && account.proxy.protocol !== "none" && account.proxy.host);
  const sharedIp = ip ? others.filter((a) => a.lastExitIp === ip) : [];
  const uid = account.identity?.userID;
  const sharedUid = uid ? others.filter((a) => a.identity?.userID === uid) : [];

  const problems = h.reasons.length;

  return (
    <>
      {/* 小节标题和说明由抽屉统一渲染，这里不再重复一遍 */}
      <div className={`hs-score lv-${h.level}`}>
        <span className="hs-num">{h.score}</span>
        <span className="hs-meta">
          <b>
            {h.level === "blocked" ? tr("被风控", "Restricted") : h.level === "risk" ? tr("有风险", "At risk") : tr("就绪", "Ready")}
          </b>
          <small>
            {problems ? tr(`${problems} 项待处理`, `${problems} to resolve`) : tr("没有发现问题", "Nothing wrong")}
          </small>
        </span>
        <span className="rk-sp" />
        <button
          className="btn"
          onClick={onCheckExit}
          disabled={busy || !proxied}
          title={proxied ? undefined : tr("先配出口", "Set an exit first")}
        >
          {tr("重测出口", "Re-measure exit")}
        </button>
      </div>

      <div className="rk-list hs-list">
        {auth === "suspended" && (
          <HealthItem
            level="danger"
            title={tr("账号处于暂时风控", "Account is temporarily restricted")}
            why={tr(
              "这是账号级状态，换本机凭据绕不过去。先用别的环境，等它解除；要看原因去 claude.ai/restricted。",
              "Account-level state; local credentials will not get around it. Use another environment while it clears.",
            )}
          />
        )}
        {auth === "expired" && (
          <HealthItem
            level="danger"
            title={tr("登录凭据已失效", "Sign-in expired")}
            why={
              status?.email
                ? tr(`上次是 ${status.email}，重新授权一次就好`, `Last signed in as ${status.email}; authorize once to restore`)
                : undefined
            }
            action={{ label: tr("重新登录", "Sign in again"), run: () => onLogin() }}
          />
        )}
        {auth === "signedOut" && (
          <HealthItem
            level="warn"
            title={tr("这个环境还没登录", "Not signed in")}
            why={tr("没登录就开不了会话", "Sessions cannot start without signing in")}
            action={{ label: tr("现在登录", "Sign in now"), run: () => onLogin() }}
          />
        )}
        {auth === "unknown" && (
          <HealthItem
            level="info"
            title={tr("登录态还没确认", "Sign-in state not confirmed")}
            why={tr("还没问过 CLI。去通用页点一下刷新", "The CLI has not been asked yet")}
            action={{ label: tr("去刷新", "Refresh"), run: () => onGo("general") }}
          />
        )}

        {!proxied && (
          <HealthItem
            level="warn"
            title={tr("走的是直连", "Direct connection")}
            why={tr(
              "直连就是本机那条宽带。几个环境共用同一个出口 IP，是最容易被连起来的一条线",
              "Direct means this Mac's connection; several environments sharing one exit IP is the easiest link to spot",
            )}
            action={{ label: tr("去配出口", "Set the exit"), run: () => onGo("network") }}
          />
        )}
        {proxied && !ip && (
          <HealthItem
            level="info"
            title={tr("出口还没测过", "Exit not measured")}
            why={tr("没测过就不知道实际从哪个 IP 出去", "Without measuring you do not know which IP you exit from")}
            action={{ label: tr("测一下", "Measure"), run: onCheckExit, disabled: busy }}
          />
        )}
        {sharedIp.length > 0 && (
          <HealthItem
            level="danger"
            title={tr(
              `出口 IP 和「${sharedIp.map((a) => a.label).join("、")}」相同`,
              `Exit IP matches ${sharedIp.map((a) => a.label).join(", ")}`,
            )}
            why={tr(
              "两个环境走同一个出口，等于把两个身份钉在同一台机器上",
              "Two environments on one exit pin two identities to one machine",
            )}
            action={{ label: tr("换个出口", "Change exit"), run: () => onGo("network") }}
          />
        )}

        {!uid && (
          <HealthItem
            level="warn"
            title={tr("还没生成设备码", "No device ID yet")}
            why={tr(
              "deviceId 和 accountUuid 出现在同一条遥测里。没轮换过，就是同一台设备",
              "deviceId ships alongside accountUuid in telemetry; unrotated, it reads as one device",
            )}
            action={{ label: tr("生成一个", "Generate"), run: onRotate, disabled: busy }}
          />
        )}
        {sharedUid.length > 0 && (
          <HealthItem
            level="danger"
            title={tr(
              `设备码和「${sharedUid.map((a) => a.label).join("、")}」相同`,
              `Device ID matches ${sharedUid.map((a) => a.label).join(", ")}`,
            )}
            why={tr(
              "设备码一样，服务端不需要看别的就知道这几个号在同一台机器上",
              "Identical device IDs tell the server outright that these accounts share a machine",
            )}
            action={{ label: tr("换一个", "Rotate"), run: onRotate, disabled: busy }}
          />
        )}

        {dirty.length > 0 && (
          <HealthItem
            level="warn"
            title={tr(`${dirty.length} 项痕迹还在这个环境里`, `${dirty.length} traces still in this environment`)}
            why={tr(
              "对话记录、跑过的命令、文件路径 —— 跨环境关联时最先被翻的就是这些",
              "History, commands and file paths are the first thing lined up when linking environments",
            )}
            detail={dirty.map((t) => `${t.label} ${Math.round(t.size / 1024)}KB`).join("；")}
            action={{
              label: busy ? tr("清理中…", "Cleaning…") : tr("就地清掉", "Clean now"),
              run: () => onClearTraces(dirty.map((t) => t.key)),
              disabled: busy,
            }}
          />
        )}
        {machineDirty.length > 0 && (
          <HealthItem
            level="info"
            title={tr("整机还有日志（所有环境共用）", "Machine-wide logs remain (shared by all environments)")}
            why={tr(
              "MCP 日志和客户端日志不按环境分，清任意一个环境时会一起清掉",
              "MCP and client logs are not per-environment; cleaning any environment clears them",
            )}
            detail={machineDirty.map((t) => `${t.label} ${Math.round(t.size / 1024)}KB`).join("；")}
            action={{
              label: busy ? tr("清理中…", "Cleaning…") : tr("一起清掉", "Clean too"),
              run: () => onClearTraces(machineDirty.map((t) => t.key)),
              disabled: busy,
            }}
          />
        )}

        {stunDetected && (
          <HealthItem
            level="danger"
            title={tr("有程序在发 STUN，真实公网 IP 已暴露", "Something is sending STUN; the real public IP is exposed")}
            why={tr(
              "STUN 走 UDP，代理盖不住。本应用已经堵死，能发的是 Claude Desktop 这类不属于我们的进程",
              "STUN uses UDP, which proxies do not cover. This app is sealed; senders are processes we do not own, such as Claude Desktop",
            )}
          />
        )}
        {desktopRunning && (
          <HealthItem
            level="warn"
            title={tr("Claude Desktop 正开着", "Claude Desktop is running")}
            why={tr(
              "它不归环境管，Cookies 和 Safe Storage 都是整机一份。做隔离测试前先在它里面退出登录",
              "It sits outside environments; cookies and Safe Storage are machine-wide. Sign out there before testing isolation",
            )}
          />
        )}

        {problems === 0 && (
          <div className="hs-ok">
            <IconCheck size={14} />
            <span>
              {tr(
                "这个环境干净：登录着、有自己的出口和设备码，也没有残留痕迹。",
                "This environment is clean: signed in, its own exit and device ID, no leftover traces.",
              )}
            </span>
          </div>
        )}
      </div>
    </>
  );
}