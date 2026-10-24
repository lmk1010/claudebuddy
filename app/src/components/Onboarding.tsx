import { useEffect, useState } from "react";
import type { Account, AccountStatusSnapshot } from "../lib/model";
import type { CheckupResult, ProxyCandidate, ScannedDir } from "../lib/bridge";
import LoginConsole from "./LoginConsole";
import LoginButton from "./LoginButton";
import Art from "./Art";
import IpBadge from "./IpBadge";
import { IconCopy, IconRefresh } from "./iconAliases";
import { tr } from "../lib/i18n";

/**
 * 首次引导 —— 三步。
 *
 *   1 检查电脑    装没装 Claude Code
 *   2 建环境 + 登录  设备码、终端画像由软件自动分配，用户只需要起名字、点登录
 *   3 网络出口    默认自动探测本机代理；手动配置收进一个二级入口
 *
 * 设计原则：
 *   · 用户不需要理解 TERM/LANG/TZ、userID/machineID —— 这些软件自己生成
 *   · 需要用户决策的只有两件：叫什么名字、用哪个代理
 *   · 一屏只做一件事，长的、可选的、进阶的都收起来
 */

const TITLE: Record<number, string> = {
  get 1() {
    return tr("先检查一下", "Quick check");
  },
  get 2() {
    return tr("建环境并登录", "Create an environment and sign in");
  },
  get 3() {
    return tr("设置网络出口", "Set up network exit");
  },
};

const STEP_NAME: Record<number, string> = {
  get 1() {
    return tr("检查电脑", "Check your Mac");
  },
  get 2() {
    return tr("建环境 + 登录", "Environment + sign in");
  },
  get 3() {
    return tr("网络出口", "Network exit");
  },
};

interface Props {
  checkup: CheckupResult | null;
  checkingUp: boolean;
  installLog: string;
  installing: boolean;
  accounts: Account[];
  status: Record<string, AccountStatusSnapshot>;
  activeAccount: Account | null;
  loginTermId: string | null;
  busy: boolean;
  proxyCandidates: ProxyCandidate[] | null;
  directIp: string | null;
  scanningProxy: boolean;
  exitIp: Record<string, string | null>;
  onRunCheckup: () => void;
  onInstall: () => void;
  onCopyCmd: (cmd: string) => void;
  onOpenFolderScan: () => Promise<ScannedDir[]>;
  onImportDir: (configDir: string, label: string) => void;
  onCreateAccount: (label: string) => Account;
  onSelectAccount: (id: string) => void;
  onLogin: (id: string, browser?: string) => void;
  onScanProxy: () => void;
  onSetProxy: (id: string, proxy: Account["proxy"]) => void;
  onCheckExit: (id: string) => void;
  onFinish: () => void;
  /** 有值时显示「返回应用」—— 重新进引导的老用户用 */
  onExit?: () => void;
}

export default function Onboarding(p: Props) {
  const [step, setStep] = useState(1);
  const [showInstall, setShowInstall] = useState(false);
  const [showManualProxy, setShowManualProxy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [scanned, setScanned] = useState<ScannedDir[] | null>(null);
  const [openScan, setOpenScan] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [manual, setManual] = useState({ host: "", port: "" });

  const st = p.activeAccount ? p.status[p.activeAccount.id] : undefined;
  const loggedIn = st?.auth === "signedIn";
  const px = p.activeAccount?.proxy;
  const hasProxy = Boolean(px && px.protocol !== "none");
  const ip = p.activeAccount ? p.exitIp[p.activeAccount.id] : null;
  const blocked = !p.checkup?.ok;

  // 装好之后自动回到检查屏
  useEffect(() => {
    if (showInstall && !blocked && p.checkup) setShowInstall(false);
  }, [showInstall, blocked, p.checkup]);

  // 进第 3 步自动扫一次代理 —— 大多数人什么都不用填
  useEffect(() => {
    if (step === 3 && !p.proxyCandidates && !p.scanningProxy) {
      const t = setTimeout(() => p.onScanProxy(), 250);
      return () => clearTimeout(t);
    }
  }, [step, p.proxyCandidates, p.scanningProxy, p.onScanProxy]);

  // ── 安装屏（只讲安装） ──
  if (showInstall) {
    return (
      <div className="ob">
        <div className="ob-copy ob-alone">
          <button className="ob-back" onClick={() => setShowInstall(false)}>
            {tr("← 返回检查", "← Back to check")}
          </button>
          <h1 style={{ fontSize: 30 }}>{tr("安装 Claude Code", "Install Claude Code")}</h1>
          <p>{tr("装好这一样，剩下的都在这里点。", "Install this one thing and do the rest right here.")}</p>

          <div className="inst-opts">
            <div className="inst-opt">
              <div className="inst-opt-t">
                <b>{tr("让我来装", "Install it for me")}</b>
                <span className="inst-tag">{tr("推荐", "Recommended")}</span>
              </div>
              <small>{tr("运行官方命令，不用开终端", "Runs the official command, no Terminal needed")}</small>
              <button
                className="btn pri"
                onClick={() => {
                  setInstalling(true);
                  p.onInstall();
                }}
                disabled={installing || p.installing}
              >
                {installing || p.installing ? tr("正在安装…", "Installing…") : tr("一键安装", "Install")}
              </button>
            </div>

            <div className="inst-opt">
              <div className="inst-opt-t">
                <b>{tr("或者自己在终端跑", "Or run it in Terminal")}</b>
              </div>
              <small>{tr("装完回来点「重新检查」", "When done, come back and click “Check again”")}</small>
              <div className="inst-cmd">
                <code className="selectable">npm install -g @anthropic-ai/claude-code</code>
                <button
                  className="inst-copy"
                  title={tr("复制", "Copy")}
                  onClick={() => p.onCopyCmd("npm install -g @anthropic-ai/claude-code")}
                >
                  <IconCopy size={12} />
                </button>
              </div>
            </div>
          </div>

          {(installing || p.installing) && (
            <div className="inst-progress">
              <span className="spinner" />
              <span>{tr("正在下载，网速慢要等一两分钟", "Downloading. This can take a minute or two on a slow connection")}</span>
            </div>
          )}

          {p.installLog && (
            <pre className="ob-term selectable inst-log">{p.installLog.slice(-900)}</pre>
          )}

          <div className="ob-acts" style={{ marginTop: 18 }}>
            <button className="btn" onClick={p.onRunCheckup} disabled={p.checkingUp}>
              {tr("装好了，重新检查", "Installed, check again")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ob">
      {/* 从设置里重新打开引导的人，随时能回去，不用硬走完三步 */}
      {p.onExit && (
        <button className="ob-exit" onClick={p.onExit}>
          {tr("返回应用", "Back to app")}
        </button>
      )}
      <div className="ob-art">
        <Art name="welcome" />
      </div>

      <div className="ob-copy">
        <img className="ob-icon" src="./assets/app-icon.png" alt="" />
        <h1>{TITLE[step]}</h1>

        <div className="ob-steps">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`ob-dot${step === n ? " on" : ""}${step > n ? " done" : ""}`}>
              {step > n ? <Tick /> : n}
            </span>
          ))}
          <span className="ob-step-name">{STEP_NAME[step]}</span>
        </div>

        {/* ═══ 1 检查电脑 ═══ */}
        {step === 1 && (
          <>
            <p>{p.checkingUp ? tr("正在检查…", "Checking…") : blocked ? tr("还差一样东西。", "One thing is missing.") : tr("都没问题。", "All good.")}</p>

            <div className="ck">
              {(p.checkup?.items ?? []).map((item) => (
                <div key={item.key} className={`ck-item ${item.status}`}>
                  <span className="ck-icon">
                    {item.status === "ok" ? <Tick /> : item.status === "warn" ? <Bang /> : <Cross />}
                  </span>
                  <span className="ck-name">{item.label}</span>
                  <span
                    className="ck-val"
                    title={`${item.title}${item.detail ? ` · ${item.detail}` : ""}`}
                  >
                    {item.title}
                  </span>
                </div>
              ))}
              {!p.checkup && !p.checkingUp && (
                <div className="ck-item">
                  <span className="ck-name">{tr("还没检查", "Not checked yet")}</span>
                  <button className="btn" style={{ marginLeft: "auto" }} onClick={p.onRunCheckup}>
                    <IconRefresh />
                    {tr("重新检查", "Check again")}
                  </button>
                </div>
              )}
            </div>

            {blocked && (
              <button className="inst-entry" onClick={() => setShowInstall(true)}>
                <span className="inst-entry-icon">
                  <Cross />
                </span>
                <span className="inst-entry-body">
                  <b>{tr("还差 Claude Code", "Claude Code is missing")}</b>
                  <small>{tr("点这里去安装，装完自动回来", "Click to install. You'll return here automatically")}</small>
                </span>
                <span className="inst-entry-go">→</span>
              </button>
            )}
          </>
        )}

        {/* ═══ 2 建环境 + 登录 ═══ */}
        {step === 2 && (
          <>
            <p>
              {tr(
                "起个名字就行 —— 设备码、终端画像这些软件自己分配好，每个环境互不重样。",
                "Just pick a name. Device IDs and terminal profiles are assigned for you, and each environment gets its own.",
              )}
            </p>

            <div className="ob-row">
              <input
                className="ob-input"
                value={newLabel}
                placeholder={tr("给这个环境起个名字", "Name this environment")}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newLabel.trim()) {
                    const a = p.onCreateAccount(newLabel.trim());
                    p.onSelectAccount(a.id);
                    setNewLabel("");
                  }
                }}
              />
              <button
                className="btn pri"
                disabled={!newLabel.trim()}
                onClick={() => {
                  const a = p.onCreateAccount(newLabel.trim());
                  p.onSelectAccount(a.id);
                  setNewLabel("");
                }}
              >
                {tr("新建", "Create")}
              </button>
            </div>

            <button
              className="ob-alt"
              onClick={async () => {
                setOpenScan((v) => !v);
                if (!scanned) setScanned(await p.onOpenFolderScan());
              }}
            >
              <span>{tr("或者，用电脑上已有的", "Or use one already on this Mac")}</span>
              <span className="ob-alt-go">{openScan ? tr("收起", "Hide") : tr("查看 →", "View →")}</span>
            </button>

            {openScan && (
              <div className="ob-scan">
                {!scanned ? (
                  <div className="in-cap">{tr("扫描中…", "Scanning…")}</div>
                ) : scanned.length === 0 ? (
                  <div className="in-cap">{tr("没找到已有环境。", "No existing environments found.")}</div>
                ) : (
                  scanned.map((d) => (
                    <button
                      key={d.configDir}
                      className="ob-item"
                      onClick={() => {
                        p.onImportDir(d.configDir, d.configDir.replace(/^\.claude-?/, "") || tr("导入", "Imported"));
                        setScanned(null);
                        setOpenScan(false);
                      }}
                    >
                      <span className="ob-item-main">
                        <b>~/{d.configDir}</b>
                        <small>
                          {d.email ?? tr("没登录过", "Never signed in")} · {tr(`${d.sessions} 个对话`, `${d.sessions} sessions`)}
                        </small>
                      </span>
                      <span className="ob-item-add">{tr("用它", "Use")}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {p.accounts.length > 0 && (
              <>
                <div className="ob-label">{tr("选中的环境", "Selected environment")}</div>
                <div className="ob-pick">
                  {p.accounts.map((a) => (
                    <button
                      key={a.id}
                      className={`ob-item${p.activeAccount?.id === a.id ? " on" : ""}`}
                      onClick={() => p.onSelectAccount(a.id)}
                    >
                      <span className="av" style={{ background: a.tint }}>
                        {a.label.slice(0, 1)}
                      </span>
                      <span className="ob-item-main">
                        <b>{a.label}</b>
                        <small>
                          ~/{a.configDir} · {a.terminal?.term ?? ""}
                        </small>
                      </span>
                      {p.activeAccount?.id === a.id && <span className="ob-item-add">{tr("已选", "Selected")}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}

            {p.activeAccount && (
              <>
                {loggedIn ? (
                  <div className="ob-ok">
                    <span className="ob-ok-icon">
                      <Tick />
                    </span>
                    <div>
                      <b>{tr("已登录", "Signed in")}</b>
                      <small>{st?.email ?? ""}</small>
                    </div>
                  </div>
                ) : (
                  <div className="ob-acts" style={{ marginTop: 14 }}>
                    <LoginButton
                      account={p.activeAccount!}
                      busy={p.busy}
                      waiting={Boolean(p.loginTermId)}
                      label={tr("登录 Claude", "Sign in to Claude")}
                      onLogin={(b: string) => p.onLogin(p.activeAccount!.id, b)}
                    />
                  </div>
                )}

                {p.loginTermId && <LoginConsole termId={p.loginTermId} signedIn={loggedIn} />}
              </>
            )}
          </>
        )}

        {/* ═══ 3 网络出口 ═══ */}
        {step === 3 && p.activeAccount && (
          <>
            <p>
              {tr(
                "已经自动找过本机代理了。选一个用，或者保持直连。",
                "Local proxies have been detected. Pick one, or stay on a direct connection.",
              )}
            </p>

            {p.scanningProxy && !p.proxyCandidates ? (
              <div className="ob-wait" style={{ marginTop: 8 }}>
                <span className="spinner" />
                {tr("正在检测本机代理…", "Detecting local proxies…")}
              </div>
            ) : (
              <div className="proxy-list">
                {/* 直连始终是一个选项 */}
                <button
                  className={`proxy-item${!hasProxy ? " used" : ""}`}
                  onClick={() => p.onSetProxy(p.activeAccount!.id, { protocol: "none", host: "", port: 0 })}
                >
                  <span className="proxy-dot ok" />
                  <span className="proxy-item-main">
                    <b>{tr("不用代理", "No proxy")}</b>
                    <small>
                      {tr("本机出口", "Local exit")} {p.directIp ?? tr("读不到", "Unavailable")}
                    </small>
                    {p.directIp && (
                      <small>
                        <IpBadge ip={p.directIp} compact />
                      </small>
                    )}
                  </span>
                  {!hasProxy ? <span className="proxy-used">{tr("使用中", "In use")}</span> : null}
                </button>

                {(p.proxyCandidates ?? [])
                  .filter((c) => c.ok)
                  .map((c) => {
                    const used = hasProxy && px!.host === c.host && px!.port === c.port;
                    return (
                      <button
                        key={`${c.host}:${c.port}`}
                        className={`proxy-item${used ? " used" : ""}`}
                        onClick={() =>
                          p.onSetProxy(p.activeAccount!.id, {
                            protocol: c.protocol,
                            host: c.host,
                            port: c.port,
                            noProxy: "localhost,127.0.0.1,::1",
                          })
                        }
                      >
                        <span className="proxy-dot ok" />
                        <span className="proxy-item-main">
                          <b className="mono">
                            {c.protocol}://{c.host}:{c.port}
                          </b>
                          <small>
                            {c.label}
                            {c.ip ? tr(` · 出口 ${c.ip}`, ` · Exit ${c.ip}`) : ""}
                          </small>
                          {c.ip && (
                            <small>
                              <IpBadge ip={c.ip} compact />
                            </small>
                          )}
                        </span>
                        {used ? <span className="proxy-used">{tr("使用中", "In use")}</span> : null}
                      </button>
                    );
                  })}

                {(p.proxyCandidates ?? []).filter((c) => c.ok).length === 0 && !p.scanningProxy && (
                  <div className="in-cap" style={{ padding: "8px 2px" }}>
                    {tr(
                      "没找到能用的代理。如果有代理地址，点下面手动填。",
                      "No working proxy found. If you have a proxy address, enter it manually below.",
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 手动配置收进二级，不占主界面 */}
            {!showManualProxy ? (
              <button className="ob-alt" onClick={() => setShowManualProxy(true)}>
                <span>{tr("手动填代理地址", "Enter proxy address manually")}</span>
                <span className="ob-alt-go">→</span>
              </button>
            ) : (
              <div className="manual-proxy">
                <div className="ob-row">
                  <input
                    className="ob-input"
                    placeholder="127.0.0.1"
                    value={manual.host}
                    onChange={(e) => setManual({ ...manual, host: e.target.value })}
                  />
                  <input
                    className="ob-input ob-port"
                    placeholder={tr("端口", "Port")}
                    value={manual.port}
                    onChange={(e) =>
                      setManual({ ...manual, port: e.target.value.replace(/\D/g, "") })
                    }
                  />
                  <button
                    className="btn"
                    disabled={!manual.host || !manual.port}
                    onClick={() => {
                      p.onSetProxy(p.activeAccount!.id, {
                        protocol: "http",
                        host: manual.host.trim(),
                        port: Number(manual.port),
                        noProxy: "localhost,127.0.0.1,::1",
                      });
                      setManual({ host: "", port: "" });
                      setShowManualProxy(false);
                    }}
                  >
                    {tr("用这个", "Use this")}
                  </button>
                </div>
                <div className="in-cap">
                  {tr(
                    "端口不知道的话，在代理软件设置里看「HTTP 代理端口」。",
                    "Not sure about the port? Check “HTTP proxy port” in your proxy app's settings.",
                  )}
                </div>
              </div>
            )}

            <div className="proxy-current">
              <span>{tr("这个环境的出口", "This environment's exit")}</span>
              <b className="mono">
                {hasProxy ? `${px!.protocol}://${px!.host}:${px!.port}` : tr("直连", "Direct")}
              </b>
              {ip ? (
                <span className="proxy-ip">
                  <Tick /> {ip}
                  <IpBadge ip={ip} compact />
                </span>
              ) : (
                <button className="proxy-check" onClick={() => p.onCheckExit(p.activeAccount!.id)}>
                  {tr("测一下", "Test")}
                </button>
              )}
            </div>
          </>
        )}

        {/* 底部导航 */}
        <div className="ob-acts" style={{ marginTop: 24 }}>
          {step > 1 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              {tr("上一步", "Back")}
            </button>
          )}

          {step === 1 && (
            <button
              className={blocked ? "btn" : "btn pri"}
              disabled={blocked || p.checkingUp}
              onClick={() => setStep(2)}
              title={blocked ? tr("先把上面的问题解决", "Fix the issue above first") : undefined}
            >
              {blocked ? tr("先装 Claude Code", "Install Claude Code first") : tr("下一步", "Continue")}
            </button>
          )}

          {step === 2 && (
            <button
              className={loggedIn ? "btn pri" : "btn"}
              disabled={!p.activeAccount}
              onClick={() => setStep(3)}
              title={!loggedIn ? tr("可以先跳过，之后再登录", "You can skip and sign in later") : undefined}
            >
              {loggedIn ? tr("下一步", "Continue") : p.activeAccount ? tr("跳过登录", "Skip sign-in") : tr("先建环境", "Create an environment first")}
            </button>
          )}

          {step === 3 && (
            <button className="btn pri" onClick={p.onFinish}>
              <Tick />
              {tr("开始使用", "Get started")}
            </button>
          )}
        </div>

        <div className="ob-foot">
          {step === 1 && tr("只检查本机环境，不上传任何东西", "Only checks this Mac. Nothing is uploaded")}
          {step === 2 && tr("每个环境的凭证、对话、设备码都是分开的", "Each environment keeps its own credentials, sessions and device ID")}
          {step === 3 && tr("以后在「环境」里随时能改", "You can change this anytime in Environments")}
        </div>
      </div>
    </div>
  );
}

/* ── 小尺寸状态图标：库里的 i-check 是"圆圈+勾"合成字形，缩小后糊成 G ── */

function Glyph({ d }: { d: string }) {
  return (
    <svg
      width={9}
      height={9}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

function Tick() {
  return <Glyph d="M3.4 8.6 L6.6 11.6 L12.8 4.6" />;
}
function Cross() {
  return <Glyph d="M4.4 4.4 L11.6 11.6 M11.6 4.4 L4.4 11.6" />;
}
function Bang() {
  return <Glyph d="M8 3.6 L8 9.2 M8 12.4 L8 12.6" />;
}
