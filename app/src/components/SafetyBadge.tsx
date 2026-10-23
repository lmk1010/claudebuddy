import { useEffect, useState } from "react";
import type { Account, AccountStatusSnapshot } from "../lib/model";

/**
 * 安全状态 —— 一个始终可见的"可信环境"指示器。
 *
 * 它回答一个问题：现在这个环境安不安全、有没有东西该处理。
 * 不是装饰：每一项都对应真实检查结果，不满足就是不合格。
 *
 * 状态分三档：
 *   · safe    全部就绪，呼吸绿色
 *   · warn    能用但有问题（IP 跳了 / 出口没测 / 未登录）
 *   · danger  不能正常用（凭据失效 / 账号被挂起）
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
): SafetyReport {
  const issues: SafetyIssue[] = [];
  let passed = 0;
  const total = 4;

  if (!account) {
    return {
      level: "warn",
      issues: [{ key: "no-account", text: "还没有环境", fix: "先建一个", level: "warn" }],
      passed: 0,
      total,
    };
  }

  // ① 登录态
  const auth = status?.auth ?? account.auth;
  if (auth === "signedIn") passed++;
  else if (auth === "suspended")
    issues.push({ key: "auth", text: "账号已被挂起", fix: "换一个账号", level: "danger" });
  else if (auth === "expired")
    issues.push({ key: "auth", text: "登录凭据已失效", fix: "重新登录", level: "danger" });
  else
    issues.push({ key: "auth", text: "这个环境还没登录", fix: "去登录", level: "warn" });

  // ② 出口已配置
  const hasProxy = account.proxy.protocol !== "none";
  if (hasProxy || auth !== "signedIn") passed++;
  else
    issues.push({
      key: "proxy",
      text: "走的是直连，出口 IP 和本机一样",
      fix: "配一个代理",
      level: "warn",
    });

  // ③ 出口 IP 跟上次一致（跳变是被关联的信号）
  const last = account.lastExitIp;
  if (exitIp && last && exitIp !== last) {
    issues.push({
      key: "ip",
      text: `出口 IP 从 ${last} 变成 ${exitIp}`,
      fix: "确认是不是你主动换的",
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
      text: "还没生成独立设备码",
      fix: "首次启动后自动生成",
      level: "warn",
    });

  const level: SafetyLevel = issues.some((i) => i.level === "danger")
    ? "danger"
    : issues.length > 0
      ? "warn"
      : "safe";

  return { level, issues, passed, total };
}

const LABEL: Record<SafetyLevel, string> = {
  safe: "环境就绪",
  warn: "有需要注意的",
  danger: "需要处理",
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
      title={report.issues.map((i) => i.text).join("；") || "全部检查通过"}
    >
      <span className="safe-dot">
        <i />
      </span>
      <span className="safe-text">
        <b>{LABEL[report.level]}</b>
        <small>
          {report.level === "safe"
            ? `${report.passed}/${report.total} 项通过`
            : `${report.issues.length} 项待处理`}
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
          <span>目录、出口、设备码、终端画像都已就位。</span>
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
