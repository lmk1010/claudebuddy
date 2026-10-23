import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Account, AccountStatusSnapshot, ProxyConfig } from "../lib/model";
import type { KeychainEntry, ScannedDir, SessionSummary, TraceItem } from "../lib/bridge";
import { ACCOUNT_TINTS, AUTH_LABEL, AUTH_PILL, proxyLabel, relTime, type SimilarityReport } from "../lib/model";
import LoginConsole from "./LoginConsole";
import Art from "./Art";
import Modal from "./Modal";
import Help, { Steps } from "./Help";
import type { ProxyCandidate } from "../lib/bridge";
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconClose,
  IconFile,
  IconGear,
  IconGlobe,
  IconKey,
  IconLock,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTerminal,
  IconTrash,
  IconWarning,
} from "./iconAliases";

/**
 * 环境页 —— 标题行、说明条、环境列表。
 *
 * 细节不铺在页面上：点一行打开编辑弹窗，弹窗里左边分类、右边内容，
 * 跟 Claude Desktop 的设置同构。
 */
interface Props {
  accounts: Account[];
  activeId: string | null;
  status: Record<string, AccountStatusSnapshot>;
  sessionCount: Record<string, number>;
  bannerDismissed: boolean;
  onDismissBanner: () => void;
  onCreate: () => void;
  onScanImport: () => void;
  onOpenDetail: (account: Account) => void;
}

export default function Accounts(p: Props) {
  return (
    <div className="pg">
      <div className="pg-h">
        <div>
          <h1>环境</h1>
          <p>{p.accounts.length} 个环境 · 全部本机存储 · 每个独立目录、独立出口</p>
        </div>
        <div className="pg-acts">
          <button className="btn" onClick={p.onScanImport} title="导入本机已有的 ~/.claude* 目录">
            <IconRefresh />
            导入
          </button>
          <button className="btn pri" onClick={p.onCreate}>
            <IconPlus />
            新建环境
          </button>
        </div>
      </div>

      {!p.bannerDismissed && (
        <div className="banner">
          <div>
            <b>每个环境一间屋子</b>
            <p>
              凭据、对话记录、file-history 全落在各自的配置目录里。切环境就是换一间屋子，
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
          const n = p.sessionCount[a.id] ?? 0;
          return (
            <button key={a.id} className={`ar${on ? " on" : ""}`} onClick={() => p.onOpenDetail(a)}>
              <span className="av" style={{ background: a.tint }}>
                {a.label.slice(0, 1)}
              </span>
              <span className="an">
                <b>
                  {a.label}
                  {on && <em className="ar-cur">当前</em>}
                </b>
                <small>
                  <span className="mono">~/{a.configDir}</span>
                  {s?.email || a.email ? ` · ${s?.email ?? a.email}` : " · 未登录"}
                </small>
              </span>
              <span className="as" title={proxyLabel(a.proxy)}>
                {a.proxy.protocol === "none" ? "直连" : a.proxy.protocol.toUpperCase()}
              </span>
              <span className="as">{n > 0 ? `${n} 个会话` : relTime(a.lastUsedAt)}</span>
              <span className={`pill ${AUTH_PILL[auth]}`}>{AUTH_LABEL[auth]}</span>
              <span className="ar-more" aria-hidden>
                {auth === "suspended" ? <IconWarning size={13} /> : <IconChevronRight size={13} />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="pg-foot">点一行编辑：登录、网络出口、设备身份、痕迹清理都在里面。</div>
    </div>
  );
}

/* ══════════════════════ 新建环境 ══════════════════════ */

export function CreateEnvDialog({
  existing,
  onCreate,
  onClose,
}: {
  existing: string[];
  onCreate: (label: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const v = name.trim();
  const dup = existing.includes(v);
  const ok = Boolean(v) && !dup;
  return (
    <Modal onClose={onClose} className="dlg-sm" label="新建环境">
      {(close) => (
        <>
          <div className="dlg-h">
            <h2>新建环境</h2>
            <button className="ib" title="关闭 esc" onClick={close}>
              <IconClose />
            </button>
          </div>
          <p>环境 = 一个独立的 Claude Code 配置目录。一个 Claude 账号放一个环境，互相不串号、不用反复登录。</p>
          <div className="dlg-guide">
            <Steps
              items={[
                <>
                  <b>起个名字</b>，比如账号的用途或邮箱前缀（主力、工作…）
                </>,
                <>
                  <b>登录授权</b>：建好会自动打开编辑页，点「登录」在浏览器里授权
                </>,
                <>
                  <b>网络出口（可选）</b>：用梯子的话点「自动探测」选一个，多个号建议各走各的
                </>,
              ]}
            />
          </div>
          <input
            className="dlg-in"
            autoFocus
            value={name}
            placeholder="名字，例如 主力 / 工作"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ok && !e.nativeEvent.isComposing) {
                onCreate(v);
                close();
              }
            }}
          />
          <div className="dlg-err">{dup ? "已经有同名环境了" : " "}</div>
          <div className="dlg-acts">
            <button className="btn ghost" onClick={close}>
              取消
            </button>
            <button
              className="btn pri"
              disabled={!ok}
              onClick={() => {
                onCreate(v);
                close();
              }}
            >
              创建并编辑
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ══════════════════════ 导入已有目录 ══════════════════════ */

export function ImportDialog({
  list,
  imported,
  onImport,
  onClose,
}: {
  list: ScannedDir[];
  imported: string[];
  onImport: (configDir: string, label: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} className="dlg-md" label="导入已有环境">
      {(close) => (
        <>
          <div className="dlg-h">
            <h2>导入已有环境</h2>
            <button className="ib" title="关闭 esc" onClick={close}>
              <IconClose />
            </button>
          </div>
          <p>本机扫到的 Claude Code 配置目录。导入只是登记，不会动目录里的任何东西。</p>
          {list.length === 0 ? (
            <div className="imp-empty">没有找到可导入的目录。</div>
          ) : (
            <div className="imp-list">
              {list.map((d) => {
                const done = imported.includes(d.configDir);
                return (
                  <div className="imp-row" key={d.configDir}>
                    <span className="imp-main">
                      <b className="mono">~/{d.configDir}</b>
                      <small>
                        {d.email ?? "未登录"}
                        {d.tier ? ` · ${d.tier}` : ""} · {d.sessions} 个会话 · {fmtSize(d.sizeBytes)}
                        {d.lastActive ? ` · ${relTime(d.lastActive)}` : ""}
                      </small>
                    </span>
                    <button
                      className={`btn${done ? " ghost" : ""}`}
                      disabled={done}
                      onClick={() => onImport(d.configDir, d.configDir.replace(/^\.claude-?/, "") || "个人")}
                    >
                      {done ? "已导入" : "导入"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="dlg-acts">
            <button className="btn ghost" onClick={close}>
              完成
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ══════════════════════ 编辑环境（弹窗） ══════════════════════ */

export type EnvSection = "general" | "network" | "identity" | "profile" | "sessions" | "traces" | "danger";

const SECTIONS: { id: EnvSection; label: string; desc: string; icon: typeof IconGear }[] = [
  { id: "general", label: "通用", desc: "名字、标识色和这个环境的登录状态", icon: IconGear },
  { id: "network", label: "网络出口", desc: "这个环境走哪条线路出去。一个环境固定一个出口", icon: IconGlobe },
  { id: "identity", label: "设备身份", desc: "遥测里代表\"这台机器\"的那串 ID", icon: IconShield },
  { id: "profile", label: "终端画像", desc: "终端类型、语言、时区 —— 会进 env 上报", icon: IconTerminal },
  { id: "sessions", label: "历史会话", desc: "这个环境跑过的会话，点一条在原目录里接着开", icon: IconClock },
  { id: "traces", label: "本机痕迹", desc: "这个环境在磁盘和 Keychain 里留下了什么", icon: IconFile },
];

/**
 * 编辑环境 —— 居中弹窗，左边菜单、右边内容。
 *
 * 之前是一整列平铺的长滚动，登录、网络、身份、痕迹全叠在一起，找一项得从头滚到尾。
 * 现在一项一个菜单，切换时内容按菜单方向滑入，左侧选中底色跟着滑过去。
 */
export function EnvModal({
  account,
  status,
  exitIp,
  checking,
  loginTermId,
  traces,
  keychain,
  busy,
  initialSection = "general",
  canRemove,
  onClose,
  onPatch,
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
  onRemove,
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
  initialSection?: EnvSection;
  /** 最后一个环境不能删 */
  canRemove: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<Account>) => void;
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
  onDiversify: () => void;
  similar: { otherLabel: string; report: SimilarityReport } | null;
  onClearTraces: (keys: string[]) => void;
  onRemove: (purge: boolean) => void;
  sessions: SessionSummary[] | undefined;
  onLoadSessions: () => void;
  onOpenSession: (s: SessionSummary) => void;
}) {
  const auth = status?.auth ?? account.auth ?? "unknown";
  const [sec, setSec] = useState<EnvSection>(initialSection);
  const [dir, setDir] = useState<"up" | "down">("down");
  const order: EnvSection[] = [...SECTIONS.map((s) => s.id), "danger"];

  const go = (next: EnvSection) => {
    if (next === sec) return;
    setDir(order.indexOf(next) > order.indexOf(sec) ? "down" : "up");
    setSec(next);
  };

  // 左侧选中底色：量出当前项的位置，滑过去而不是跳过去
  const navRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>(`[data-sec="${sec}"]`);
    if (el) setInd({ top: el.offsetTop, height: el.offsetHeight });
  }, [sec]);

  // 进到需要数据的分类时自动去读，不让用户再点一次「加载」
  useEffect(() => {
    if (sec === "sessions" && sessions === undefined) onLoadSessions();
    if (sec === "traces" && traces === undefined) onLoadTraces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sec]);

  const meta = SECTIONS.find((s) => s.id === sec) ?? {
    label: "删除环境",
    desc: "从列表里移除，或者连目录一起删掉",
  };

  return (
    <Modal onClose={onClose} className="em" label={`编辑 ${account.label}`}>
      {(close) => (
        <>
          <aside className="em-side">
            <div className="em-who">
              <span className="av" style={{ background: account.tint }}>
                {account.label.slice(0, 1)}
              </span>
              <span className="em-who-t">
                <b>{account.label}</b>
                <small className="mono">~/{account.configDir}</small>
              </span>
            </div>

            <div className="em-nav" ref={navRef}>
              {ind && <i className="em-ind" style={{ transform: `translateY(${ind.top}px)`, height: ind.height }} />}
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  data-sec={s.id}
                  className={sec === s.id ? "on" : ""}
                  onClick={() => go(s.id)}
                >
                  <s.icon size={15} />
                  <span>{s.label}</span>
                  {s.id === "general" && auth !== "signedIn" && <em className="em-badge" title="还没登录" />}
                </button>
              ))}
              <span className="em-sep" />
              <button data-sec="danger" className={`em-danger${sec === "danger" ? " on" : ""}`} onClick={() => go("danger")}>
                <IconTrash size={15} />
                <span>删除环境</span>
              </button>
            </div>

            <div className="em-foot">
              <span className={`pill ${AUTH_PILL[auth]}`}>{AUTH_LABEL[auth]}</span>
            </div>
          </aside>

          <section className="em-main">
            <div className="em-head">
              <div>
                <h2>{meta.label}</h2>
                <p>{meta.desc}</p>
              </div>
              <button className="ib" title="关闭 esc" onClick={close}>
                <IconClose />
              </button>
            </div>

            <div className="em-body" key={sec} data-dir={dir}>
              {sec === "general" && (
                <GeneralSection
                  account={account}
                  exitIp={exitIp}
                  onGo={go}
                  status={status}
                  auth={auth}
                  busy={busy}
                  loginTermId={loginTermId}
                  onPatch={onPatch}
                  onLogin={onLogin}
                  onLogout={onLogout}
                  onRefresh={onRefresh}
                  onOpenTerminal={() => {
                    onOpenTerminal();
                    close();
                  }}
                  onCancelLogin={onCancelLogin}
                />
              )}

              {sec === "network" && (
                <NetworkSection
                  account={account}
                  exitIp={exitIp}
                  checking={checking}
                  onSetProxy={onSetProxy}
                  onCheckExit={onCheckExit}
                />
              )}

              {sec === "identity" && (
                <>
                  <div className="em-card">
                    <Row title="userID" desc="遥测里的 device_id">
                      <code className="em-code">{status?.identity.userID ? `${status.identity.userID.slice(0, 18)}…` : "尚未生成"}</code>
                    </Row>
                    <Row title="machineID" desc="第一次启动 Claude Code 时生成">
                      <code className="em-code">
                        {status?.identity.machineID ? `${status.identity.machineID.slice(0, 18)}…` : "尚未生成"}
                      </code>
                    </Row>
                    <Row
                      title="轮换设备身份"
                      desc="重置这台机器的画像，账号本身不变"
                      tip={
                        <Help title="什么时候需要轮换？">
                          <p>Claude Code 会生成一串 userID 当作「这台设备」上报。几个号用同一串，看起来就是同一台机器。</p>
                          <p>新建的环境本来就各自独立，一般不用动。只有从别处拷过来的目录、或者怀疑被关联时才点。轮换不会掉登录。</p>
                        </Help>
                      }
                    >
                      <button className="btn" onClick={onRotate} disabled={busy}>
                        <IconShield />
                        {busy ? "处理中…" : "轮换"}
                      </button>
                    </Row>
                  </div>
                  <div className="em-note">
                    轮换换不掉账号 UUID、uname 画像、仓库哈希和出口 IP —— 这些不在本地，改不了也不假装能改。
                  </div>
                </>
              )}

              {sec === "profile" && (
                <>
                  <div className="em-card">
                    <Row title="终端类型" desc="TERM / TERM_PROGRAM">
                      <code className="em-code">{account.terminal?.term ?? "—"}</code>
                    </Row>
                    <Row title="语言" desc="LANG">
                      <code className="em-code">{account.terminal?.lang ?? "—"}</code>
                    </Row>
                    <Row title="时区" desc="TZ">
                      <code className="em-code">{account.terminal?.tz ?? "—"}</code>
                    </Row>
                    <Row
                      title="和其他环境拉开差距"
                      desc="换一组跟现有环境都不重样的画像"
                      tip={
                        <Help title="终端画像是什么？">
                          <p>终端类型、语言、时区会随请求上报。几个环境一模一样，就少了一层区分。</p>
                          <p>点「换一组」会自动挑一组跟其他环境都不重复的值，下次开会话生效。不影响你实际使用。</p>
                        </Help>
                      }
                    >
                      <button className="btn" onClick={onDiversify}>
                        <IconRefresh />
                        换一组
                      </button>
                    </Row>
                  </div>

                  {similar && (
                    <div className="sim">
                      <div className="sim-head">
                        <span>与「{similar.otherLabel}」的对比</span>
                        <span
                          className={`sim-score${similar.report.isolationScore >= 60 ? " good" : similar.report.isolationScore >= 30 ? " mid" : " low"}`}
                        >
                          {similar.report.isolationScore}%
                        </span>
                      </div>
                      <div className="sim-bar">
                        <i style={{ width: `${similar.report.isolationScore}%` }} />
                      </div>
                      <div className="sim-cap">
                        能拉开的 {similar.report.movableTotal} 项里，已经拉开 {similar.report.movableDiffered} 项
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
                </>
              )}

              {sec === "sessions" && (
                <>
                  <div className="em-bar">
                    <span>{sessions ? `${sessions.length} 个会话` : "读取中…"}</span>
                    <button className="det-k" onClick={onLoadSessions}>
                      刷新
                    </button>
                  </div>
                  {sessions && sessions.length === 0 ? (
                    <div className="em-empty">这个环境还没有历史会话。</div>
                  ) : (
                    <div className="em-card">
                      {(sessions ?? []).slice(0, 30).map((s) => (
                        <button
                          key={s.id}
                          className="em-sess"
                          onClick={() => {
                            onOpenSession(s);
                            close();
                          }}
                          title={`${s.cwd}\n${s.title}`}
                        >
                          <span className="em-sess-t">{s.title}</span>
                          <span className="em-sess-m">
                            <span className="mono">{shortCwd(s.cwd)}</span>
                            <span>{relTime(s.lastActive)}</span>
                            <span className="mono">{fmtSize(s.sizeBytes)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {sec === "traces" && (
                <TracesSection
                  traces={traces}
                  keychain={keychain}
                  busy={busy}
                  onLoadTraces={onLoadTraces}
                  onLoadKeychain={onLoadKeychain}
                  onClearTraces={onClearTraces}
                />
              )}

              {sec === "danger" && (
                <DangerSection account={account} canRemove={canRemove} busy={busy} onRemove={onRemove} />
              )}
            </div>
          </section>
        </>
      )}
    </Modal>
  );
}

function Row({ title, desc, tip, children }: { title: string; desc?: string; tip?: ReactNode; children?: ReactNode }) {
  return (
    <div className="em-row">
      <span className="em-row-t">
        <b>
          {title}
          {tip}
        </b>
        {desc && <small>{desc}</small>}
      </span>
      <span className="em-row-c">{children}</span>
    </div>
  );
}

function GeneralSection({
  account,
  exitIp,
  onGo,
  status,
  auth,
  busy,
  loginTermId,
  onPatch,
  onLogin,
  onLogout,
  onRefresh,
  onOpenTerminal,
  onCancelLogin,
}: {
  account: Account;
  exitIp: string | null;
  onGo: (s: EnvSection) => void;
  status: AccountStatusSnapshot | undefined;
  auth: Account["auth"];
  busy: boolean;
  loginTermId: string | null;
  onPatch: (patch: Partial<Account>) => void;
  onLogin: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onOpenTerminal: () => void;
  onCancelLogin: () => void;
}) {
  const [name, setName] = useState(account.label);
  useEffect(() => setName(account.label), [account.label]);
  const commit = () => {
    const v = name.trim();
    if (v && v !== account.label) onPatch({ label: v });
    else setName(account.label);
  };
  const signedIn = auth === "signedIn";
  const hasProxy = account.proxy.protocol !== "none";
  const ipKnown = Boolean(exitIp || account.lastExitIp);
  const steps: { done: boolean; title: string; desc: string; act: string; run: () => void }[] = [
    {
      done: signedIn,
      title: "登录 Claude 账号",
      desc: signedIn ? `已登录 ${status?.email ?? ""}` : "点「登录」会打开浏览器，在网页上点授权，回来就自动识别",
      act: "登录",
      run: onLogin,
    },
    {
      done: hasProxy,
      title: "设置网络出口（建议）",
      desc: hasProxy ? `走 ${proxyLabel(account.proxy)}` : "多个号最好各走各的线路。用梯子的话点进去「自动探测」就行",
      act: "去设置",
      run: () => onGo("network"),
    },
    {
      done: ipKnown,
      title: "确认出口 IP",
      desc: ipKnown ? `出口 ${exitIp ?? account.lastExitIp}` : "测一下这个环境实际从哪个 IP 出去，之后跳变会提醒你",
      act: "去检测",
      run: () => onGo("network"),
    },
  ];
  const doneN = steps.filter((s) => s.done).length;

  return (
    <>
      {doneN < steps.length && (
        <div className="em-guide">
          <div className="em-guide-h">
            <b>把这个环境配好</b>
            <span>
              {doneN}/{steps.length}
            </span>
            <i className="em-guide-bar">
              <i style={{ width: `${(doneN / steps.length) * 100}%` }} />
            </i>
          </div>
          {steps.map((s, i) => (
            <div key={s.title} className={`em-step${s.done ? " done" : ""}`}>
              <span className="em-step-n">{s.done ? <IconCheck size={11} /> : i + 1}</span>
              <span className="em-step-t">
                <b>{s.title}</b>
                <small>{s.desc}</small>
              </span>
              {!s.done && (
                <button
                  className={`btn${i === steps.findIndex((x) => !x.done) ? " pri" : ""}`}
                  onClick={s.run}
                  disabled={i === 0 && (busy || Boolean(loginTermId))}
                >
                  {i === 0 && loginTermId ? "等待授权…" : s.act}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {loginTermId && (
        <div className="em-login em-login-top">
          <LoginConsole
            termId={loginTermId}
            signedIn={signedIn}
            onCancel={() => {
              void window.claudeBuddy.accountCloseLogin(account.id, loginTermId);
              onCancelLogin();
            }}
          />
        </div>
      )}

      <div className="em-card">
        <Row title="名字" desc="只在本机显示，随时能改">
          <input
            className="em-in"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </Row>
        <Row title="标识色" desc="侧栏、页签上用它区分环境">
          <span className="em-tints">
            {ACCOUNT_TINTS.map((t) => (
              <button
                key={t}
                className={`em-tint${account.tint === t ? " on" : ""}`}
                style={{ background: t }}
                title={t}
                onClick={() => onPatch({ tint: t })}
              />
            ))}
          </span>
        </Row>
        <Row title="配置目录" desc="CLAUDE_CONFIG_DIR，凭据和记录都在这里">
          <code className="em-code">~/{account.configDir}</code>
        </Row>
      </div>

      <div className="em-sub">
        <span>登录</span>
        <button className="det-k" onClick={onRefresh}>
          刷新状态
        </button>
      </div>
      <div className="em-card">
        <Row title="账号" desc={signedIn ? "已授权，凭据在 Keychain" : "这个环境还没有登录过"}>
          <span className="em-val">{status?.email ?? (auth === "unknown" ? "读不到状态" : "未登录")}</span>
        </Row>
        {status?.tier && (
          <Row title="订阅">
            <span className="em-val">{status.tier}</span>
          </Row>
        )}
        <Row title={signedIn ? "退出登录" : "登录授权"} desc={signedIn ? "从 Keychain 清掉这个环境的凭据" : "打开浏览器授权，完成后自动识别"}>
          {!signedIn ? (
            <button className="btn pri" onClick={onLogin} disabled={busy || Boolean(loginTermId)}>
              <IconKey />
              {busy ? "启动中…" : loginTermId ? "等待授权…" : "登录"}
            </button>
          ) : (
            <button className="btn" onClick={onLogout} disabled={busy}>
              退出登录
            </button>
          )}
        </Row>
        <Row title="打开终端" desc="在这个环境里起一个 Claude Code">
          <button className="btn" onClick={onOpenTerminal}>
            <IconTerminal />
            打开
          </button>
        </Row>
      </div>

      {auth === "suspended" && (
        <div className="det-warn">
          <IconWarning size={13} />
          这个账号处于挂起状态。风控在 API 请求、OAuth 回调、Token 刷新三处都判定，换本地凭据绕不过去。
        </div>
      )}

    </>
  );
}

function NetworkSection({
  account,
  exitIp,
  checking,
  onSetProxy,
  onCheckExit,
}: {
  account: Account;
  exitIp: string | null;
  checking: boolean;
  onSetProxy: (p: ProxyConfig) => void;
  onCheckExit: () => void;
}) {
  const p = account.proxy;
  const [scan, setScan] = useState<ProxyCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const discover = async () => {
    setScanning(true);
    try {
      setScan((await window.claudeBuddy.proxyDiscover(account.id)).list);
    } finally {
      setScanning(false);
    }
  };
  return (
    <>
      <div className="em-tipbox">
        <span>
          <b>不知道该填什么？</b>点「自动探测」，会把本机正在跑的代理（Clash、V2RayN、Surge 等）都找出来，并实测每个能不能通、出口 IP 是多少，挑一个点「用这个」就行。
        </span>
        <button className="btn pri" onClick={() => void discover()} disabled={scanning}>
          <IconRefresh />
          {scanning ? "探测中…" : scan ? "重新探测" : "自动探测"}
        </button>
      </div>

      {scan && (
        <div className="em-card em-scan">
          {scan.length === 0 ? (
            <div className="em-empty" style={{ border: 0 }}>
              没找到本机代理。没开梯子的话就选「直连」；开了还找不到，到下面手动填端口。
            </div>
          ) : (
            scan.map((c) => {
              const cur = p.protocol === c.protocol && p.host === c.host && p.port === c.port;
              return (
                <div className="em-row" key={`${c.protocol}-${c.host}-${c.port}`}>
                  <span className="em-row-t">
                    <b>
                      {c.label}
                      <span className={`pill ${c.ok ? "p-ok" : "p-idle"}`} style={{ marginLeft: 8 }}>
                        {c.ok ? "能通" : "不通"}
                      </span>
                    </b>
                    <small className="mono">
                      {c.protocol}://{c.host}:{c.port}
                      {c.ip ? ` · 出口 ${c.ip}` : c.reason ? ` · ${c.reason}` : ""}
                    </small>
                  </span>
                  <span className="em-row-c">
                    <button
                      className={`btn${cur ? " ghost" : ""}`}
                      disabled={cur || !c.ok}
                      onClick={() =>
                        onSetProxy({ protocol: c.protocol, host: c.host, port: c.port, noProxy: "localhost,127.0.0.1,::1" })
                      }
                    >
                      {cur ? "正在用" : "用这个"}
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="em-sub">
        <span>手动设置</span>
      </div>
      <div className="em-card">
        <Row
          title="出口方式"
          desc="直连，或者走本机的代理"
          tip={
            <Help title="直连还是代理？" wide>
              <p>
                <b>直连</b>：用你电脑当前的网络直接出去。没开梯子、或者开了「全局/TUN 模式」时选这个。
              </p>
              <p>
                <b>SOCKS5 / HTTP</b>：只让这个环境走指定的代理端口，别的程序不受影响。多个号各走各的线路，靠的就是这个。
              </p>
              <p>常见端口：</p>
              <Steps
                items={[
                  "Clash / Clash Verge：HTTP 7890，SOCKS5 7891（混合端口 7890 两种都行）",
                  "V2RayN：SOCKS5 10808，HTTP 10809",
                  "Surge / ShadowRocket Mac：HTTP 6152，SOCKS5 6153",
                ]}
              />
            </Help>
          }
        >
          <div className="seg">
            <button className={p.protocol === "none" ? "on" : ""} onClick={() => onSetProxy({ protocol: "none", host: "", port: 0 })}>
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
        </Row>
        {p.protocol !== "none" && (
          <Row title="代理地址" desc="主机和端口，失焦后保存">
            <span className="em-proxy" key={p.protocol}>
              <input
                className="em-in"
                defaultValue={p.host}
                placeholder="127.0.0.1"
                onBlur={(e) => onSetProxy({ ...p, host: e.target.value.trim() })}
              />
              <input
                className="em-in em-port"
                defaultValue={p.port || ""}
                placeholder="端口"
                onBlur={(e) => onSetProxy({ ...p, port: Number(e.target.value.replace(/\D/g, "")) || 0 })}
              />
            </span>
          </Row>
        )}
        <Row
          title="实测出口 IP"
          desc={proxyLabel(p)}
          tip={
            <Help title="为什么要测出口 IP">
              <p>Anthropic 看到的是这个 IP，不是你填的代理地址。测一下才知道线路真的生效了。</p>
              <p>测过之后会记住；以后 IP 变了，这里会提醒你 —— 同一个号频繁换 IP 本身就是风控信号。</p>
            </Help>
          }
        >
          <span className="em-ipline">
            <code className="em-code">{exitIp || "未检测"}</code>
            <button className="btn" onClick={onCheckExit} disabled={checking}>
              <IconGlobe />
              {checking ? "检测中…" : "检测"}
            </button>
          </span>
        </Row>
      </div>
      {exitIp && account.lastExitIp && exitIp !== account.lastExitIp && (
        <div className="det-warn">
          <IconWarning size={13} />
          IP 跳变：{account.lastExitIp} → {exitIp}。频繁换出口本身就是信号。
        </div>
      )}
    </>
  );
}

function TracesSection({
  traces,
  keychain,
  busy,
  onLoadTraces,
  onLoadKeychain,
  onClearTraces,
}: {
  traces: TraceItem[] | undefined;
  keychain: KeychainEntry[] | null;
  busy: boolean;
  onLoadTraces: () => void;
  onLoadKeychain: () => void;
  onClearTraces: (keys: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const existing = (traces ?? []).filter((t) => t.exists);
  const clearable = existing.filter((t) => t.key !== "credentials" && t.key !== "identity");

  return (
    <>
      <div className="em-bar">
        <span className="em-bar-t">
          {traces ? `${existing.length} 项 · 勾选要清掉的` : "统计中…"}
          <Help title="清痕迹会清掉什么？">
            <p>对话记录、文件快照、缓存、日志这类东西，清掉后这个环境就像刚用过一次。</p>
            <p>登录凭据和设备身份锁着不让勾 —— 清了等于掉登录。要彻底清空一个号，去「删除环境」连目录一起删。</p>
          </Help>
        </span>
        <button className="det-k" onClick={onLoadTraces}>
          重新统计
        </button>
      </div>
      {traces && existing.length === 0 ? (
        <div className="em-empty">这个环境还没有留下痕迹。</div>
      ) : (
        <div className="em-card">
          {existing.map((t) => {
            const locked = t.key === "credentials" || t.key === "identity";
            return (
              <label key={t.key} className={`em-trace${locked ? " locked" : ""}`}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={picked.includes(t.key)}
                  onChange={(e) =>
                    setPicked((prev) => (e.target.checked ? [...prev, t.key] : prev.filter((k) => k !== t.key)))
                  }
                />
                <span className="em-trace-n">
                  {t.label}
                  {locked && <small>保留 · 删了会掉登录</small>}
                </span>
                <span className="mono">{fmtSize(t.size)}</span>
              </label>
            );
          })}
        </div>
      )}
      {clearable.length > 0 && (
        <div className="em-acts">
          <button className="det-k" onClick={() => setPicked(picked.length === clearable.length ? [] : clearable.map((t) => t.key))}>
            {picked.length === clearable.length ? "全不选" : "全选可清项"}
          </button>
          <button
            className="btn pri"
            disabled={picked.length === 0 || busy}
            onClick={() => {
              onClearTraces(picked);
              setPicked([]);
            }}
          >
            {busy ? "清理中…" : picked.length ? `清掉这 ${picked.length} 项` : "清理"}
          </button>
        </div>
      )}

      <div className="em-sub">
        <span>Keychain</span>
        <button className="det-k" onClick={onLoadKeychain}>
          {keychain ? "刷新" : "读取"}
        </button>
      </div>
      {keychain ? (
        keychain.length === 0 ? (
          <div className="em-empty">没有找到 Claude Code 的 Keychain 条目。</div>
        ) : (
          <div className="em-card">
            {keychain.map((k) => (
              <div key={k.service} className="em-kc">
                <IconLock size={13} />
                <span className="mono">{k.service}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="em-empty">列出本机所有 Claude Code 的 Keychain 条目。</div>
      )}
    </>
  );
}

function DangerSection({
  account,
  canRemove,
  busy,
  onRemove,
}: {
  account: Account;
  canRemove: boolean;
  busy: boolean;
  onRemove: (purge: boolean) => void;
}) {
  const [purge, setPurge] = useState(false);
  const [typed, setTyped] = useState("");
  const isHome = account.configDir === ".claude";
  const needType = purge;
  const ok = canRemove && (!needType || typed.trim() === account.label);

  return (
    <>
      <div className="em-card">
        <Row title="仅从列表移除" desc="磁盘目录保留，之后还能用「导入」加回来">
          <input type="radio" name="purge" checked={!purge} onChange={() => setPurge(false)} />
        </Row>
        <Row
          title="连磁盘目录一起删"
          desc={isHome ? "这是你原本的 ~/.claude，不能删目录" : `~/${account.configDir} 会被永久删除，凭据和记录全没了`}
        >
          <input type="radio" name="purge" checked={purge} disabled={isHome} onChange={() => setPurge(true)} />
        </Row>
      </div>

      {needType && (
        <div className="em-confirm">
          <span>输入环境名「{account.label}」确认永久删除</span>
          <input className="em-in" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={account.label} />
        </div>
      )}

      {!canRemove && <div className="em-note">这是最后一个环境，至少要留一个。</div>}

      <div className="em-acts">
        <button className="btn danger" disabled={!ok || busy} onClick={() => onRemove(purge)}>
          <IconTrash size={13} />
          {busy ? "处理中…" : purge ? "删除目录并移除" : "从列表移除"}
        </button>
      </div>
    </>
  );
}

function shortCwd(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

function fmtSize(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
