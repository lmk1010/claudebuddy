import { useEffect, useState } from "react";
import type { Account, AccountStatusSnapshot, ProxyConfig } from "../lib/model";
import type { KeychainEntry, SessionSummary, TraceItem } from "../lib/bridge";
import { AUTH_LABEL, AUTH_PILL, proxyLabel, relTime, type SimilarityReport } from "../lib/model";
import LoginConsole from "./LoginConsole";
import Art from "./Art";
import {
  IconCheck,
  IconClose,
  IconGlobe,
  IconKey,
  IconLock,
  IconPlus,
  IconRefresh,
  IconShield,
  IconWarning,
} from "./iconAliases";

/**
 * 账号页 —— 设计稿 10 · accounts（样机 750–760）。
 *
 * 页面本身只有三块：标题行、说明条、账号列表。
 * 四层隔离的细节不铺在页面上，点账号右侧「详情」才滑出来 ——
 * 这是"不要信息过载"的具体做法：默认只给你一眼能看完的东西。
 */
interface Props {
  accounts: Account[];
  activeId: string | null;
  status: Record<string, AccountStatusSnapshot>;
  exitIp: Record<string, string | null>;
  checking: Record<string, boolean>;
  loginTerm: Record<string, string>;
  traces: Record<string, TraceItem[] | undefined>;
  keychain: KeychainEntry[] | null;
  busy: Record<string, boolean>;
  bannerDismissed: boolean;
  onDismissBanner: () => void;
  onSelect: (id: string) => void;
  onCreate: (label: string) => Account;
  onScanImport: () => void;
  onOpenDetail: (account: Account) => void;
}

export default function Accounts(p: Props) {
  const [newLabel, setNewLabel] = useState("");

  return (
    <div className="pg">
      <div className="pg-h">
        <div>
          <h1>账号</h1>
          <p>
            {p.accounts.length} 个账号 · 全部本机存储 · 每个独立目录、独立出口
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={p.onScanImport} title="导入本机已有的 ~/.claude 目录">
            <IconRefresh />
            导入
          </button>
        </div>
      </div>

      {!p.bannerDismissed && (
        <div className="banner">
          <div>
            <b>每个账号一间屋子</b>
            <p>
              凭据、对话记录、file-history 全落在各自的配置目录里。切账号就是换一间屋子，
              不会串号，也不用反复登录。
            </p>
          </div>
          <Art name="isolation" />
          <button className="banner-x" title="不再显示" onClick={p.onDismissBanner}>
            <IconClose size={13} />
          </button>
        </div>
      )}

      <div className="acc">
        {p.accounts.map((a) => {
          const s = p.status[a.id];
          const auth = s?.auth ?? a.auth ?? "unknown";
          const on = a.id === p.activeId;
          const detail = auth === "suspended";
          return (
            <button
              key={a.id}
              className={`ar${on ? " on" : ""}`}
              onClick={() => p.onSelect(a.id)}
              onDoubleClick={() => p.onOpenDetail(a)}
            >
              <span className="av" style={{ background: a.tint }}>
                {a.label.slice(0, 1)}
              </span>
              <span className="an">
                <b>{a.label}</b>
                {/* 第二行只放最能说明"这是什么环境"的两件事：目录 + 账号 */}
                <small>
                  <span className="mono">~/{a.configDir}</span>
                  {s?.email || a.email ? ` · ${s?.email ?? a.email}` : " · 未登录"}
                </small>
              </span>
              <span className="as" title={proxyLabel(a.proxy)}>
                {a.proxy.protocol === "none" ? "直连" : a.proxy.protocol.toUpperCase()}
              </span>
              <span className={`pill ${AUTH_PILL[auth]}`}>{AUTH_LABEL[auth]}</span>
              <span className="al">{on ? "当前" : relTime(a.lastUsedAt)}</span>
              <span
                className="ar-more"
                title="详情"
                onClick={(e) => {
                  e.stopPropagation();
                  p.onOpenDetail(a);
                }}
              >
                {detail ? <IconWarning size={13} /> : <IconKey size={13} />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="ob-row" style={{ marginTop: 16 }}>
        <input
          className="ob-input"
          value={newLabel}
          placeholder="新账号名字，例如 主力 / 工作"
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newLabel.trim()) {
              const a = p.onCreate(newLabel.trim());
              p.onSelect(a.id);
              setNewLabel("");
            }
          }}
        />
        <button
          className="btn pri"
          disabled={!newLabel.trim()}
          onClick={() => {
            const a = p.onCreate(newLabel.trim());
            p.onSelect(a.id);
            setNewLabel("");
          }}
        >
          <IconPlus />
          添加账号
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════ 详情抽屉 ══════════════════════ */

/**
 * 详情抽屉 —— 页面上不常驻，点开才有。
 *
 * 四段对应四层隔离，但每段只放必要信息：
 * 能做的给按钮，做不到的用一句话说清，不铺表格。
 */
export function AccountDrawer({
  account,
  status,
  exitIp,
  checking,
  loginTermId,
  traces,
  keychain,
  busy,
  onClose,
  onLogin,
  onLogout,
  onCheckExit,
  onRotate,
  onLoadTraces,
  onLoadKeychain,
  onSetProxy,
  onOpenTerminal,
  onRefresh,
  onCancelLogin,
  onDiversify,
  similar,
  onClearTraces,
  clearing,
  onRemove,
  removing,
  sessions,
  onLoadSessions,
  onOpenSession,
}: {
  account: Account;
  status: AccountStatusSnapshot | undefined;
  exitIp: string | null;
  checking: boolean;
  loginTermId: string | null;
  traces: TraceItem[] | undefined;
  keychain: KeychainEntry[] | null;
  busy: boolean;
  onClose: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onCheckExit: () => void;
  onRotate: () => void;
  onLoadTraces: () => void;
  onLoadKeychain: () => void;
  onSetProxy: (p: ProxyConfig) => void;
  onOpenTerminal: () => void;
  onRefresh: () => void;
  onCancelLogin: () => void;
  /** 把当前的终端画像改成和别的环境不同 */
  onDiversify: () => void;
  /** 与另一个环境的相似度对比 */
  similar: { otherLabel: string; report: SimilarityReport } | null;
  /** 清理痕迹 */
  onClearTraces: (keys: string[]) => void;
  clearing: boolean;
  /** 删除环境：purge=true 连磁盘目录一起删 */
  onRemove: (purge: boolean) => void;
  removing: boolean;
  /** 历史会话：undefined = 还没加载，[] = 确实没有 */
  sessions: SessionSummary[] | undefined;
  onLoadSessions: () => void;
  onOpenSession: (s: SessionSummary) => void;
}) {
  const auth = status?.auth ?? account.auth ?? "unknown";
  const signedIn = auth === "signedIn";
  const p = account.proxy;

  // 清理确认：默认收起，避免误点
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearKeys, setClearKeys] = useState<string[]>([]);
  // 删除确认
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [purge, setPurge] = useState(false);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="ov" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${account.label} 详情`}>
        <div className="drawer-h">
          <span className="av" style={{ background: account.tint }}>
            {account.label.slice(0, 1)}
          </span>
          <div className="drawer-t">
            <b>{account.label}</b>
            <small className="mono">~/{account.configDir}</small>
          </div>
          <span className={`pill ${AUTH_PILL[auth]}`}>{AUTH_LABEL[auth]}</span>
          <button className="ib" title="关闭" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <div className="drawer-b">
          {/* ① 登录 */}
          <section className="drawer-s">
            <div className="in-k">
              <span>登录</span>
              <button className="det-k" onClick={onRefresh}>
                刷新
              </button>
            </div>

            {/* 只有真的读到东西才列出来，避免两行 "—" 占位置 */}
            {status?.email && (
              <div className="det-kv">
                <span>账号</span>
                <b>{status.email}</b>
              </div>
            )}
            {status?.tier && (
              <div className="det-kv">
                <span>订阅</span>
                <b>{status.tier}</b>
              </div>
            )}
            {!status?.email && !status?.tier && (
              <div className="in-cap" style={{ marginBottom: 4 }}>
                {auth === "unknown" ? "读不到状态（CLI 未响应）" : "这个环境还没有登录过。"}
              </div>
            )}

            {auth === "suspended" && (
              <div className="det-warn">
                <IconWarning size={13} />
                这个账号处于挂起状态。风控在 API 请求、OAuth 回调、Token 刷新三处都判定，
                换本地凭据绕不过去。
              </div>
            )}

            <div className="det-acts">
              {!signedIn ? (
                <button className="btn pri" onClick={onLogin} disabled={busy}>
                  <IconKey />
                  {busy ? "启动中…" : "登录授权"}
                </button>
              ) : (
                <button className="btn" onClick={onLogout} disabled={busy}>
                  退出登录
                </button>
              )}
              <button className="btn ghost" onClick={onOpenTerminal}>
                打开终端
              </button>
            </div>

            {loginTermId && (
              <LoginConsole
                termId={loginTermId}
                signedIn={signedIn}
                onCancel={() => {
                  void window.claudeBuddy.accountCloseLogin(account.id, loginTermId);
                  onCancelLogin();
                }}
              />
            )}
          </section>

          {/* ② 网络 */}
          <section className="drawer-s">
            <div className="in-k">
              <span>网络出口</span>
              <span className="mono">{p.protocol === "none" ? "direct" : p.protocol}</span>
            </div>

            <div className="seg" style={{ marginBottom: 10 }}>
              <button
                className={p.protocol === "none" ? "on" : ""}
                onClick={() => onSetProxy({ protocol: "none", host: "", port: 0 })}
              >
                直连
              </button>
              <button
                className={p.protocol === "socks5" ? "on" : ""}
                onClick={() =>
                  onSetProxy({
                    protocol: "socks5",
                    host: p.host || "127.0.0.1",
                    port: p.port || 1080,
                    noProxy: p.noProxy || "localhost,127.0.0.1,::1",
                  })
                }
              >
                SOCKS5
              </button>
              <button
                className={p.protocol === "http" ? "on" : ""}
                onClick={() =>
                  onSetProxy({
                    protocol: "http",
                    host: p.host || "127.0.0.1",
                    port: p.port || 7890,
                    noProxy: p.noProxy || "localhost,127.0.0.1,::1",
                  })
                }
              >
                HTTP
              </button>
            </div>

            {p.protocol !== "none" && (
              <div className="det-proxy-form">
                <input
                  className="ob-input"
                  defaultValue={p.host}
                  placeholder="主机"
                  onBlur={(e) => onSetProxy({ ...p, host: e.target.value.trim() })}
                />
                <input
                  className="ob-input ob-port"
                  defaultValue={p.port || ""}
                  placeholder="端口"
                  onBlur={(e) =>
                    onSetProxy({ ...p, port: Number(e.target.value.replace(/\D/g, "")) || 0 })
                  }
                />
              </div>
            )}

            <div className="det-kv">
              <span>出口</span>
              <b className="mono">{proxyLabel(p)}</b>
            </div>
            <div className="det-kv">
              <span>实测 IP</span>
              <b className="mono">{exitIp || "未检测"}</b>
            </div>

            {exitIp && account.lastExitIp && exitIp !== account.lastExitIp && (
              <div className="det-warn">
                <IconWarning size={13} />
                IP 跳变：{account.lastExitIp} → {exitIp}。频繁换出口本身就是信号。
              </div>
            )}

            <div className="det-acts">
              <button className="btn" onClick={onCheckExit} disabled={checking}>
                <IconGlobe />
                {checking ? "检测中…" : "检测出口 IP"}
              </button>
            </div>
          </section>

          {/* ③ 身份 */}
          <section className="drawer-s">
            <div className="in-k">
              <span>设备身份</span>
            </div>
            <div className="det-kv">
              <span>userID</span>
              <b className="mono">
                {status?.identity.userID ? `${status.identity.userID.slice(0, 14)}…` : "尚未生成"}
              </b>
            </div>
            <div className="det-kv">
              <span>machineID</span>
              <b className="mono">
                {status?.identity.machineID
                  ? `${status.identity.machineID.slice(0, 14)}…`
                  : "尚未生成"}
              </b>
            </div>

            <div className="det-note">
              userID 就是遥测的 <code>device_id</code>。轮换能重置"这台机器"的画像，
              但换不掉账号 UUID、uname 画像、仓库哈希和 IP。
            </div>

            <div className="det-acts">
              <button className="btn" onClick={onRotate} disabled={busy}>
                <IconShield />
                轮换设备身份
              </button>
            </div>
          </section>

          {/* ③.5 终端画像 + 与另一个环境的相似度 */}
          <section className="drawer-s">
            <div className="in-k">
              <span>终端画像</span>
              <span className="mono">{account.terminal?.term ?? "—"}</span>
            </div>

            <div className="det-kv">
              <span>终端类型</span>
              <b className="mono">{account.terminal?.term ?? "—"}</b>
            </div>
            <div className="det-kv">
              <span>语言</span>
              <b className="mono">{account.terminal?.lang ?? "—"}</b>
            </div>
            <div className="det-kv">
              <span>时区</span>
              <b className="mono">{account.terminal?.tz ?? "—"}</b>
            </div>

            <div className="det-note">
              这三项会进 Claude Code 的 env 上报。同一台机器上内核和架构换不掉，
              但终端类型、语言、时区可以拉开 —— 让另一个环境和自己不一样，比什么都换更实在。
            </div>

            <div className="det-acts">
              <button className="btn" onClick={onDiversify}>
                <IconShield />
                和其他环境拉开差距
              </button>
            </div>

            {/* 相似度：只统计能拉开的部分，换不掉的单独列，不混进分数 */}
            {similar && (
              <div className="sim">
                <div className="sim-head">
                  <span>与「{similar.otherLabel}」的对比</span>
                  <span className={`sim-score${similar.report.isolationScore >= 60 ? " good" : similar.report.isolationScore >= 30 ? " mid" : " low"}`}>
                    {similar.report.isolationScore}%
                  </span>
                </div>
                <div className="sim-bar">
                  <i style={{ width: `${similar.report.isolationScore}%` }} />
                </div>
                <div className="sim-cap">
                  能拉开的 {similar.report.movableTotal} 项里，已经拉开{" "}
                  {similar.report.movableDiffered} 项
                </div>

                <div className="sim-axes">
                  {similar.report.axes.map((ax) => (
                    <div key={ax.key} className={`sim-ax${ax.fixed ? " fixed" : ax.differs ? " diff" : ""}`}>
                      <span className="sim-ax-name">
                        {ax.fixed && <i className="sim-lock" />}
                        {ax.label}
                      </span>
                      <span className="sim-ax-vals mono">
                        {ax.fixed ? "同机，改不掉" : ax.differs ? "已不同" : "相同"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ④ 历史会话 */}
          <section className="drawer-s">
            <div className="in-k">
              <span>历史会话</span>
              <button className="det-k" onClick={onLoadSessions}>
                {sessions ? "刷新" : "加载"}
              </button>
            </div>

            {sessions === undefined ? (
              <div className="in-cap">看看这个环境跑过哪些会话。</div>
            ) : sessions.length === 0 ? (
              <div className="in-cap">这个环境还没有历史会话。</div>
            ) : (
              <div className="sess-list">
                {sessions.slice(0, 12).map((s) => (
                  <button
                    key={`${s.id}`}
                    className="sess"
                    onClick={() => onOpenSession(s)}
                    title={`${s.cwd}\n${s.title}`}
                  >
                    <span className="sess-title">{s.title}</span>
                    <span className="sess-meta">
                      <span className="mono">{s.project}</span>
                      <span>{relTime(s.lastActive)}</span>
                      <span className="mono">{fmtSize(s.sizeBytes)}</span>
                    </span>
                  </button>
                ))}
                {sessions.length > 12 && (
                  <div className="in-cap">还有 {sessions.length - 12} 个更早的会话</div>
                )}
              </div>
            )}
          </section>

          {/* ⑤ 痕迹 */}
          <section className="drawer-s">
            <div className="in-k">
              <span>本机痕迹</span>
              <button className="det-k" onClick={onLoadTraces}>
                {traces ? "重新统计" : "统计体积"}
              </button>
            </div>

            {traces ? (
              <div className="det-traces">
                {traces
                  .filter((t) => t.exists)
                  .map((t) => (
                    <div key={t.key} className="det-trace">
                      <span className="dt-name">
                        {t.critical && <i className="dt-dot" />}
                        {t.label}
                      </span>
                      <span className="dt-size mono">{fmtSize(t.size)}</span>
                    </div>
                  ))}
                {traces.filter((t) => t.exists).length === 0 && (
                  <div className="in-cap">这个环境还没有留下痕迹。</div>
                )}
              </div>
            ) : (
              <div className="in-cap">看看这个环境留下了什么。</div>
            )}

            {/* 清理：先勾选要清什么，再确认。凭据默认保留（删了会掉登录） */}
            {traces && traces.some((t) => t.exists) && (
              <>
                {!confirmClear ? (
                  <div className="det-acts">
                    <button className="btn" onClick={() => setConfirmClear(true)}>
                      <IconClose size={13} />
                      清理痕迹
                    </button>
                  </div>
                ) : (
                  <div className="clear-box">
                    <div className="clear-h">选择要清掉的内容</div>
                    <div className="clear-list">
                      {traces
                        .filter((t) => t.exists && t.key !== "credentials" && t.key !== "identity")
                        .map((t) => (
                          <label key={t.key} className="clear-row">
                            <input
                              type="checkbox"
                              checked={clearKeys.includes(t.key)}
                              onChange={(e) =>
                                setClearKeys((prev) =>
                                  e.target.checked
                                    ? [...prev, t.key]
                                    : prev.filter((k) => k !== t.key),
                                )
                              }
                            />
                            <span>{t.label}</span>
                            <span className="mono">{fmtSize(t.size)}</span>
                          </label>
                        ))}
                    </div>
                    <div className="clear-note">
                      登录凭据和设备身份会保留 —— 清掉它们等于掉登录，需要单独操作。
                    </div>
                    <div className="det-acts">
                      <button
                        className="btn pri"
                        disabled={clearKeys.length === 0 || clearing}
                        onClick={() => onClearTraces(clearKeys)}
                      >
                        {clearing ? "清理中…" : `清掉这 ${clearKeys.length} 项`}
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => {
                          setConfirmClear(false);
                          setClearKeys([]);
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="det-acts">
              <button className="btn ghost" onClick={onLoadKeychain}>
                <IconLock size={13} />
                Keychain 条目
              </button>
            </div>

            {keychain && (
              <div className="det-keychain">
                {keychain.length === 0 ? (
                  <div className="in-cap">没有找到 Claude Code 的 Keychain 条目。</div>
                ) : (
                  keychain.map((k) => (
                    <div key={k.service} className="det-kc-row">
                      <span className="mono">{k.service}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          {/* ⑤ 删除环境 —— 放最后并默认折叠，避免误触 */}
          <section className="drawer-s">
            <div className="in-k">
              <span>删除环境</span>
            </div>

            {!confirmRemove ? (
              <>
                <div className="in-cap" style={{ marginBottom: 10 }}>
                  只从列表里移除，磁盘目录会保留，之后还能用「导入」加回来。
                </div>
                <div className="det-acts">
                  <button className="btn ghost" onClick={() => setConfirmRemove(true)}>
                    移除这个环境
                  </button>
                </div>
              </>
            ) : (
              <div className="clear-box">
                <div className="clear-h">确定要移除「{account.label}」？</div>
                <label className="clear-row" style={{ height: 30 }}>
                  <input
                    type="checkbox"
                    checked={purge}
                    onChange={(e) => setPurge(e.target.checked)}
                    disabled={account.configDir === ".claude"}
                  />
                  <span>连磁盘目录一起删</span>
                  <span className="mono">~/{account.configDir}</span>
                </label>
                <div className="clear-note">
                  {account.configDir === ".claude"
                    ? "这是你原本的 ~/.claude，只能从列表移除，目录不能删。"
                    : purge
                      ? "勾上之后目录会被永久删除 —— 对话记录、凭据、历史全没了，不能撤销。"
                      : "不勾的话目录留着，只是不再出现在列表里。"}
                </div>
                <div className="det-acts">
                  <button className="btn pri" disabled={removing} onClick={() => onRemove(purge)}>
                    {removing ? "处理中…" : purge ? "删除目录并移除" : "仅从列表移除"}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setConfirmRemove(false);
                      setPurge(false);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="drawer-f">
          <span className="in-cap">
            目录、出口、设备码、终端画像这四样是真的分开的；内核、架构、主机名换不掉。
          </span>
        </div>
      </aside>
    </>
  );
}

function fmtSize(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export { IconCheck };
