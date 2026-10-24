import { useEffect, useState } from "react";
import type { Account, AccountStatusSnapshot } from "../lib/model";
import type { DesktopProbe, LeakReport } from "../lib/bridge";
import { tr } from "../lib/i18n";

/**
 * 安全状态 —— 一个始终可见的"可信环境"指示器。
 *
 * 它回答一个问题：现在这个环境安不安全、有没有东西该处理。
 * 不是装饰：每一项都对应真实检查结果，不满足就是不合格。
 *
 * 状态分三档：
 *   · safe    全部就绪，呼吸绿色
 *   · warn    能用但有问题（IP 跳了 / 出口没测 / 未登录）
 *   · danger  不能正常用（凭据失效 / 账号暂时风控）
 */

export type SafetyLevel = "safe" | "warn" | "danger";

export interface SafetyIssue {
  key: string;
  /** 一句话问题 */
  text: string;
  /** 怎么解决 */
  fix?: string;
  level: SafetyLevel;
}

export interface SafetyReport {
  level: SafetyLevel;
  issues: SafetyIssue[];
  /** 已通过的项目数 / 总数 */
  passed: number;
  total: number;
}

/**
 * 计算安全状态。
 *
 * 只检查这个软件真正能控制的四件事，不把"内核隔离"这类做不到的
 * 算进来制造焦虑，也不写"完全安全"这种假话。
 */
export function assessSafety(
  account: Account | null,
  status: AccountStatusSnapshot | undefined,
  exitIp: string | null | undefined,
  /**
   * Claude Desktop 的本地体检。它不是某个环境的一部分，
   * 但它在服务端就是同一台机器上的另一个身份 —— 所以要说一声。
   */
  desktop?: DesktopProbe | null,
  /**
   * UDP / STUN 泄漏体检。STUN 走 UDP，HTTPS_PROXY 根本管不到，
   * 一旦有人问出真实公网 IP，环境之间的出口隔离就等于没做。
   */
  leak?: LeakReport | null,
): SafetyReport {
  const issues: SafetyIssue[] = [];
  let passed = 0;
  // 五项：风控 / 凭据 / 出口 / 出口跳变 / 设备码
  const total = 5;

  if (!account) {
    return {
      level: "warn",
      issues: [{ key: "no-account", text: tr("还没有环境", "No environment yet"), fix: tr("先建一个", "Create one first"), level: "warn" }],
      passed: 0,
      total,
    };
  }

  /** 本地凭据的真实状态，不揉进风控 */
  const auth = status?.auth ?? account.auth;

  // ① 账号级风控（跟本地凭据是两条轴，两件都报）
  if (account.heldAt) {
    issues.push({
      key: "held",
      text: tr("账号正在暂时风控", "Account temporarily restricted"),
      fix: tr("先换个环境用，等它解除", "Use another environment while it clears"),
      level: "danger",
    });
  }

  // ② 本地凭据
  if (auth === "signedIn") passed++;
  else if (auth === "expired")
    issues.push({ key: "auth", text: tr("登录凭据已失效", "Sign-in expired"), fix: tr("重新授权一次", "Authorize once to restore"), level: "danger" });
  else
    issues.push({ key: "auth", text: tr("这个环境还没登录", "This environment isn't signed in"), fix: tr("去登录", "Sign in"), level: "warn" });

  // ② 出口已配置
  const hasProxy = account.proxy.protocol !== "none";
  if (hasProxy || auth !== "signedIn") passed++;
  else
    issues.push({
      key: "proxy",
      text: tr("走的是直连，出口 IP 和本机一样", "Direct connection; exit IP matches this Mac"),
      fix: tr("配一个代理", "Set up a proxy"),
      level: "warn",
    });

  // ③ 出口 IP 跟上次一致（跳变是被关联的信号）
  const last = account.lastExitIp;
  if (exitIp && last && exitIp !== last) {
    issues.push({
      key: "ip",
      text: tr(`出口 IP 从 ${last} 变成 ${exitIp}`, `Exit IP changed from ${last} to ${exitIp}`),
      fix: tr("确认是不是你主动换的", "Check that you changed it on purpose"),
      level: "warn",
    });
  } else {
    passed++;
  }

  // ④ 设备码已生成（有独立身份）
  if (status?.identity?.userID) passed++;
  else
    issues.push({
      key: "identity",
      text: tr("还没生成独立设备码", "No device ID generated yet"),
      fix: tr("首次启动后自动生成", "Generated automatically on first launch"),
      level: "warn",
    });

  /**
   * Desktop 只在“现在真的开着”或“最近真的登录过”时才提醒。
   * 很久没动过的旧痕迹不弹 —— 那是清理页该说的事，不是安全指示器的活，
   * 否则每次开应用都报一条，用户很快就当它不存在了。
   */
  if (desktop) {
    if (desktop.running) {
      issues.push({
        key: "desktop-running",
        text: tr("Claude Desktop 正开着", "Claude Desktop is running"),
        fix: tr("它不归环境管，和这些环境共用整机身份；测完建议退出", "It sits outside these environments and shares the machine's identity; quit it after testing"),
        level: "warn",
      });
    } else if (desktop.signedIn === "likely" || desktop.signedIn === "running-no-key") {
      issues.push({
        key: "desktop-recent",
        text: tr("Claude Desktop 最近用过，还留着登录痕迹", "Claude Desktop was used recently and still holds sign-in traces"),
        fix: tr("要用这个软件做隔离测试的话，先在 Desktop 里退出登录", "If you're testing isolation, sign out in Desktop first"),
        level: "warn",
      });
    }
  }

  /**
   * STUN 命中是危险级：它不是“配置不对”，是隔离在事实上不成立 ——
   * 真实出口 IP 已经泄了，而且所有环境泄的是同一个。
   *
   * 只看命中，不看泛泛的 UDP：QUIC、DNS 都会走 UDP，报出来只会变成噪声。
   */
  if (leak) {
    for (const t of leak.targets) {
      if (t.stun.length === 0) continue;
      issues.push({
        key: `stun-${t.key}`,
        text: tr(
          `${t.label} 正在发 STUN，真实公网 IP 已经暴露`,
          `${t.label} is sending STUN; the real public IP is exposed`,
        ),
        fix: tr(
          "STUN 走 UDP，代理管不到它。先退出这个程序再继续测试",
          "STUN uses UDP, which proxies do not cover. Quit it before continuing",
        ),
        level: "danger",
      });
    }
  }

  const finalLevel: SafetyLevel = issues.some((i) => i.level === "danger")
    ? "danger"
    : issues.length > 0
      ? "warn"
      : "safe";

  return { level: finalLevel, issues, passed, total };
}

const LABEL: Record<SafetyLevel, string> = {
  get safe() { return tr("环境就绪", "Environment ready"); },
  get warn() { return tr("有需要注意的", "Needs attention"); },
  get danger() { return tr("需要处理", "Action required"); },
};

/**
 * 指示器本体。
 *
 * 动画很克制：safe 时一个缓慢的呼吸光环，warn/danger 时不闪 ——
 * 闪烁会让人焦虑，而这里要的是"我知道状态，不用管它"。
 */
export default function SafetyBadge({
  report,
  expanded,
  onToggle,
}: {
  report: SafetyReport;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const [breathe, setBreathe] = useState(false);

  useEffect(() => {
    if (report.level !== "safe") return;
    setBreathe(true);
    return () => setBreathe(false);
  }, [report.level]);

  return (
    <button
      className={`safe safe-${report.level}${breathe ? " breathe" : ""}`}
      onClick={onToggle}
      title={report.issues.map((i) => i.text).join("；") || tr("全部检查通过", "All checks passed")}
    >
      <span className="safe-dot">
        <i />
      </span>
      <span className="safe-text">
        <b>{LABEL[report.level]}</b>
        <small>
          {report.level === "safe"
            ? tr(`${report.passed}/${report.total} 项通过`, `${report.passed}/${report.total} passed`)
            : tr(`${report.issues.length} 项待处理`, `${report.issues.length} to resolve`)}
        </small>
      </span>
      {onToggle && (
        <span className={`safe-chev${expanded ? " open" : ""}`}>
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6 L8 10 L12 6" />
          </svg>
        </span>
      )}
    </button>
  );
}

/** 展开后的明细：一条条说清是什么、怎么改 */
export function SafetyDetails({ report }: { report: SafetyReport }) {
  if (report.issues.length === 0) {
    return (
      <div className="safe-detail">
        <div className="safe-ok">
          <span>{tr("目录、出口、设备码、终端画像都已就位。", "Folder, exit, device ID and terminal profile are all in place.")}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="safe-detail">
      {report.issues.map((i) => (
        <div key={i.key} className={`safe-issue lv-${i.level}`}>
          <span className="safe-issue-dot" />
          <span className="safe-issue-body">
            <b>{i.text}</b>
            {i.fix ? <small>{i.fix}</small> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
