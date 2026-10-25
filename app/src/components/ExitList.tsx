import { useEffect, useState } from "react";
import { tr } from "../lib/i18n";
import type { Account, Exit } from "../lib/model";
import { exitKey } from "../lib/model";
import type { ExitVerify, TunProbe } from "../lib/bridge";
import { IconCopy, IconPlus, IconWarning } from "./iconAliases";
import Modal from "./Modal";
import ExitPicker from "./ExitPicker";

/**
 * 出口列表 —— 这台机器配了几个出口，各自是什么 IP，谁在用。
 *
 * 设计上刻意只做三件事：
 *   1. 列出来（名字、IP、谁在用）
 *   2. 切换（点一个，当前环境就换过去）
 *   3. 新建（弹窗里选节点，不在这页铺开）
 *
 * 为什么不在这页列节点：一个订阅动辄十几个节点，铺在这里既读不完，
 * 也把「我有几个出口」这个真正的问题淹掉了。节点属于"新建出口"那一步。
 */
export default function ExitList({
  exits,
  accounts,
  currentExitId,
  onUse,
  onCreate,
  onRename,
  onDelete,
  onMeasure,
}: {
  exits: Exit[];
  accounts: Account[];
  /** 当前环境用的出口；undefined = 直连 */
  currentExitId?: string;
  onUse: (exitId: string | undefined) => void;
  /** 新建：传回调，由父层弹窗 */
  onCreate: (exit: Omit<Exit, "id">) => void;
  onRename?: (id: string, label: string) => void;
  onDelete?: (id: string) => void;
  /** 实测到一个出口的真实 IP 后，写回这个出口 */
  onMeasure?: (id: string, ip: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [copiedCfg, setCopiedCfg] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [tun, setTun] = useState<TunProbe | null>(null);
  /** 正在测的出口 id 集合 */
  const [testing, setTesting] = useState<Set<string>>(new Set());
  /** 刚测到的结果，key 是出口 id；优先于存档里的旧值 */
  const [fresh, setFresh] = useState<Record<string, { ip: string | null; reason?: string | null }>>({});
  /** 核验结果（国家/城市/ISP，两个来源交叉验证） */
  const [verify, setVerify] = useState<Record<string, ExitVerify>>({});
  /** 正在确认删除的出口 id（只对被占用的出口需要确认） */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** 正在查看「怎么配」的出口 id */
  const [configFor, setConfigFor] = useState<string | null>(null);

  /**
   * TUN 检测。
   *
   * 这一条必须放在最上面：TUN 开着的时候，下面这些"环境走哪个端口"
   * 全都不作数 —— 进程级代理变量被整机透明代理绕过了。
   * 不说清楚的话，用户会以为配好了，实际三个环境还是同一个出口。
   */
  useEffect(() => {
    void window.claudeBuddy.tunProbe().then(setTun, () => setTun(null));
  }, []);

  /**
   * 通过出口自己的端口量 IP。
   *
   * 这是唯一可信的测法。之前那版直接用「环境上次测到的 IP」当出口 IP，
   * 但那个值是环境在别的线路上测出来的 —— 换个端口它不会变，
   * 于是界面显示的和实际走的是两回事。
   */
  const measure = async (e: Exit) => {
    setTesting((s) => new Set(s).add(e.id));
    try {
      const r = await window.claudeBuddy.proxyTest({
        host: e.proxy.host,
        port: e.proxy.port,
        protocol: e.proxy.protocol === "socks5" ? "socks5" : "http",
      });
      setFresh((m) => ({ ...m, [e.id]: { ip: r.ok ? r.ip : null, reason: r.reason } }));
      onMeasure?.(e.id, r.ok ? r.ip : null);

      /**
       * IP 拿到了再核验归属。
       *
       * 分两步而不是一步：端口通不通是一回事，这个 IP 属于哪是另一回事。
       * 后者要走两个外部服务交叉验证，慢一些，失败也不该影响"端口是通的"
       * 这个已经确定的事实。
       */
      if (r.ok) {
        try {
          const v = await window.claudeBuddy.exitVerify(`${e.proxy.host}:${e.proxy.port}`);
          setVerify((m) => ({ ...m, [e.id]: v }));
        } catch {
          /* 核验失败就留空，不编造 */
        }
      }
    } catch (err) {
      setFresh((m) => ({ ...m, [e.id]: { ip: null, reason: (err as Error)?.message } }));
    } finally {
      setTesting((s) => {
        const n = new Set(s);
        n.delete(e.id);
        return n;
      });
    }
  };

  const measureAll = async () => {
    await Promise.all(exits.map(measure));
  };

  /** 谁在用这个出口 —— 用 exitKey 比，和迁移时同一套规则 */
  const usersOf = (e: Exit) =>
    accounts.filter((a) => a.exitId === e.id || (!a.exitId && exitKey(a.proxy) === exitKey(e.proxy)));

  const anyTesting = testing.size > 0;

  return (
    <>
      {tun?.active && (
        <div className="tun-warn">
          <IconWarning size={14} />
          <span>
            <b>{tr("当前是 TUN 模式，多出口不生效", "TUN mode is on, so multiple exits do not work")}</b>
            {tun.reason}
          </span>
        </div>
      )}
      {tun?.partial && (
        <div className="tun-note">
          <span>{tun.reason}</span>
        </div>
      )}
      <div className="em-sub">
        <span>{tr("出口", "Exits")}</span>
        <span className="ex-head-acts">
          {exits.length > 0 && (
            <button className="det-k" onClick={() => void measureAll()} disabled={anyTesting}>
              {anyTesting ? tr("测量中…", "Measuring…") : tr("全部实测", "Measure all")}
            </button>
          )}
          <button className="det-k" onClick={() => setPicking(true)}>
            <IconPlus size={11} />
            {tr("新建出口", "New exit")}
          </button>
        </span>
      </div>

      <div className="em-card">
        {/* 直连也是一行：它是"没有出口"这个选择，不该只藏在别处 */}
        <button
          className={`ex-item${currentExitId ? "" : " on"}`}
          onClick={() => onUse(undefined)}
        >
          <span className="ex-radio" />
          <span className="ex-main">
            <b>{tr("直连", "Direct")}</b>
            <small>{tr("用这台电脑当前的网络，不经过代理", "This Mac's own network, no proxy")}</small>
          </span>
          <span className="ex-ip mono">
            {accounts.find((a) => !a.exitId)?.lastExitIp ?? tr("未测", "—")}
          </span>
        </button>

        {exits.map((e) => {
          const users = usersOf(e);
          /**
           * 只认「通过这个端口实测到的」IP。
           *
           * 之前这里回退到 `users[0].lastExitIp`，那是环境在**别的线路**上
           * 测出来的值 —— 换个端口它不会变，于是界面显示 185.x，
           * 实际这条端口走的可能是 172.x。宁可显示「未测」也不显示错的值。
           */
          const f = fresh[e.id];
          const ip = f ? f.ip : e.lastIp ?? null;
          const failed = f && !f.ip;
          const on = currentExitId === e.id;
          const shared = users.length > 1;
          const busy = testing.has(e.id);
          /**
           * 待配置：建了但从来没测通过。
           *
           * 这跟"测了但连不上"不同 —— 前者是还没配端口，后者是配了但不通。
           * 两种都要显示出来，但用户要采取的动作不一样：一个是去配置，
           * 一个是去查线路。
           */
          const pending = !ip && !failed;
          /**
           * TUN 模式下，测出来的 IP 不代表这个出口。
           *
           * 整机流量被 utun 接管时，curl 走 HTTPS_PROXY 出去的请求
           * 会被透明代理重新路由 —— 量到的是 TUN 的出口，不是这个端口的。
           * 这时候把数字标出来会误导人，必须标明「这个值不可信」。
           */
          const tainted = Boolean(ip) && Boolean(tun?.active);
          return (
            <div className={`ex-item-wrap${on ? " on" : ""}`} key={e.id}>
              <button className={`ex-item${on ? " on" : ""}`} onClick={() => onUse(e.id)}>
                <span className="ex-radio" />
                <span className="ex-main">
                  {editing === e.id ? (
                    <input
                      className="em-in ex-rename"
                      autoFocus
                      value={draft}
                      onChange={(ev) => setDraft(ev.target.value)}
                      onBlur={() => {
                        if (draft.trim()) onRename?.(e.id, draft.trim());
                        setEditing(null);
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                        if (ev.key === "Escape") setEditing(null);
                      }}
                      onClick={(ev) => ev.stopPropagation()}
                    />
                  ) : (
                    <b>{e.label}</b>
                  )}
                  <small>
                    {e.proxy.protocol}://{e.proxy.host}:{e.proxy.port}
                    {users.length > 0 && (
                      <>
                        {" · "}
                        {tr(
                          `${users.map((u) => u.label).join("、")} 在用`,
                          `used by ${users.map((u) => u.label).join(", ")}`,
                        )}
                      </>
                    )}
                  </small>
                </span>
                <span className={`ex-ip mono${shared ? " bad" : ip ? (tainted ? " unk" : " ok") : failed ? " fail" : pending ? " pend" : ""}`}>
                  {busy ? tr("测量中", "…") : ip ?? (failed ? tr("连不上", "Failed") : tr("待配置", "Pending"))}
                </span>
              </button>
              {/* 测失败要说清为什么：端口没开、代理没跑、还是线路挂了 */}
              {failed && f?.reason && <div className="ex-fail">{f.reason}</div>}
              {/* TUN 开着时，测到的 IP 是 TUN 的，不是这个端口的 —— 必须说明 */}
              {tainted && (
                <div className="ex-fail">
                  {tr(
                    "这个数字不可信：TUN 模式下所有流量都走同一个出口，测到的不是这个端口自己的 IP。关掉 TUN 再测。",
                    "This number is unreliable: under TUN all traffic uses one exit, so this is not this port's own IP. Turn TUN off and measure again.",
                  )}
                </div>
              )}
              {/**
               * 归属核验：国家 · 城市 · ISP。
               *
               * 只有两个服务都对上才用中性色显示；对不上或只有一个来源时
               * 用告警色并附一句说明 —— 宁可让用户看到"不确定"，
               * 也不要让他以为配好了。
               */}
              {ip && verify[e.id] && (
                <div className={`ex-geo v-${verify[e.id].consistent === true ? "ok" : verify[e.id].consistent === false ? "bad" : "unk"}`}>
                  <span className="ex-geo-main">
                    {verify[e.id].primary && (
                      <>
                        <b>{verify[e.id].primary!.country || "?"}</b>
                        {verify[e.id].primary!.city && <span>{verify[e.id].primary!.city}</span>}
                        {verify[e.id].primary!.isp && <small>{verify[e.id].primary!.isp}</small>}
                      </>
                    )}
                    <span className="ex-geo-tag">
                      {verify[e.id].consistent === true
                        ? tr("两源一致", "2 sources agree")
                        : verify[e.id].consistent === false
                          ? tr("两源不一致", "Sources disagree")
                          : tr("单源，未核验", "Single source")}
                    </span>
                  </span>
                  {verify[e.id].consistent !== true && verify[e.id].reason && (
                    <small className="ex-geo-why">{verify[e.id].reason}</small>
                  )}
                </div>
              )}
              {shared && (
                <div className="ex-warn">
                  {tr(
                    `这个出口被 ${users.length} 个环境共用，在服务端看来是同一台机器。`,
                    `${users.length} environments share this exit, so they look like one machine.`,
                  )}
                </div>
              )}
              {editing !== e.id && (
                <div className="ex-acts">
                  {/**
                   * 待配置的出口，第一个动作就是「怎么配」。
                   *
                   * 之前建完只显示「待配置」，然后什么都没有 —— 用户卡在这里，
                   * 不知道下一步做什么。这一条是断掉的业务链上最关键的一环：
                   * 明确告诉他这段 YAML 要贴到哪、贴完怎么回来。
                   */}
                  {pending && (
                    <button className="det-k pri" onClick={() => setConfigFor(e.id)}>
                      {tr("怎么配", "How to set up")}
                    </button>
                  )}
                  {/* 实测：通过这个端口真发一次请求，量它自己的出口 IP */}
                  <button className="det-k" onClick={() => void measure(e)} disabled={busy}>
                    {busy ? tr("测量中…", "Measuring…") : tr("实测出口", "Measure exit")}
                  </button>
                  <button
                    className="det-k"
                    onClick={() => {
                      setEditing(e.id);
                      setDraft(e.label);
                    }}
                  >
                    {tr("重命名", "Rename")}
                  </button>
                  {/**
                   * 删除始终可用 —— 包括正在被使用的出口。
                   *
                   * 之前这里卡了 `users.length === 0`，结果是：配错了一个
                   * 连不上的出口，偏偏它又被某个环境指着，于是永远删不掉，
                   * 只能看着它坏在那里。坏掉的配置必须能清掉。
                   *
                   * 有人用时删掉要二次确认，并把受影响的环境说清楚 ——
                   * 删完之后那些环境会回到「直连」，不能悄悄发生。
                   */}
                  {onDelete && (
                    <button
                      className="det-k danger"
                      onClick={() => {
                        if (users.length === 0) {
                          onDelete(e.id);
                          return;
                        }
                        setConfirmDelete(e.id);
                      }}
                    >
                      {tr("删除", "Delete")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {picking && (
        <ExitPicker
          onClose={() => setPicking(false)}
          onCreate={(exit) => {
            onCreate(exit);
            setPicking(false);
          }}
        />
      )}

      {/* 删除被占用的出口：说清谁会受影响，再让用户决定 */}
      {confirmDelete &&
        (() => {
          const e = exits.find((x) => x.id === confirmDelete);
          if (!e) return null;
          const users = usersOf(e);
          return (
            <Modal onClose={() => setConfirmDelete(null)} className="dlg-sm" label={tr("删除出口", "Delete exit")}>
              {(close) => (
                <>
                  <h3>{tr("删除这个出口？", "Delete this exit?")}</h3>
                  <p>
                    {tr(
                      `「${e.label}」正在被 ${users.map((u) => u.label).join("、")} 使用。删掉之后，这些环境会回到「直连」，用这台电脑当前的网络出去。`,
                      `“${e.label}” is used by ${users.map((u) => u.label).join(", ")}. After deleting, they fall back to Direct and use this Mac's own network.`,
                    )}
                  </p>
                  <div className="dlg-foot">
                    <button className="btn ghost" onClick={close}>
                      {tr("取消", "Cancel")}
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => {
                        onDelete?.(e.id);
                        setConfirmDelete(null);
                      }}
                    >
                      {tr("删除", "Delete")}
                    </button>
                  </div>
                </>
              )}
            </Modal>
          );
        })()}

      {/**
       * 「怎么配」—— 待配置出口的下一步。
       *
       * 这一段是把业务链接起来的关键：用户建完出口看到「待配置」，
       * 必须知道三件事：贴什么、贴到哪、贴完怎么验证。
       * 少任何一件，他就会卡在这里。
       */}
      {configFor &&
        (() => {
          const e = exits.find((x) => x.id === configFor);
          if (!e) return null;
          const snippet = `listeners:
  - name: claude-${e.proxy.port}
    type: mixed
    port: ${e.proxy.port}
    proxy: "${e.node ?? "节点名"}"`;
          return (
            <Modal onClose={() => setConfigFor(null)} className="dlg-md" label={tr("怎么配", "How to set up")}>
              {(close) => (
                <>
                  <h3>{tr("把这段加进代理配置", "Add this to your proxy config")}</h3>
                  <p className="cfg-lead">
                    {tr(
                      `「${e.label}」用的是 ${e.proxy.host}:${e.proxy.port}，但这个端口还没开。让代理软件多开一个端口，就能单独给这个环境用。`,
                      `“${e.label}” uses ${e.proxy.host}:${e.proxy.port}, but that port is not open yet. Have your proxy app listen on one more port so this environment can use it alone.`,
                    )}
                  </p>

                  <div className="gx-code">
                    <div className="gx-code-h">
                      <span>{tr("粘在配置文件的顶层", "Paste at the top level of the config")}</span>
                      <button
                        className="det-k"
                        onClick={() => {
                          void navigator.clipboard.writeText(snippet);
                          setCopiedCfg(true);
                          setTimeout(() => setCopiedCfg(false), 1500);
                        }}
                      >
                        <IconCopy size={11} />
                        {copiedCfg ? tr("已复制", "Copied") : tr("复制", "Copy")}
                      </button>
                    </div>
                    <pre>{snippet}</pre>
                  </div>

                  <ol className="cfg-steps">
                    <li>
                      {tr(
                        "和 mixed-port 同级，加在配置文件最外层（不是缩进到别的段落里）",
                        "Same level as mixed-port, at the outermost level of the file",
                      )}
                    </li>
                    <li>
                      {tr(
                        `proxy 填你想让这个出口走的节点名。不确定就先用当前在用的那个。`,
                        `Set proxy to the node this exit should use. If unsure, use the one currently active.`,
                      )}
                    </li>
                    <li>{tr("保存后重启代理软件，让它读新配置。", "Save and restart your proxy app so it picks up the change.")}</li>
                    <li>
                      {tr(
                        "回到这里点「实测出口」；通了就会从「待配置」变成具体 IP。",
                        "Come back and hit Measure exit. Once it responds, Pending turns into a real IP.",
                      )}
                    </li>
                  </ol>

                  <div className="dlg-foot">
                    <button className="btn ghost" onClick={close}>
                      {tr("知道了", "Got it")}
                    </button>
                    <button
                      className="btn pri"
                      onClick={() => {
                        close();
                        void measure(e);
                      }}
                    >
                      {tr("我现在去配好了，重测", "I've done it — re-measure")}
                    </button>
                  </div>
                </>
              )}
            </Modal>
          );
        })()}
    </>
  );
}
