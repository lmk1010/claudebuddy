import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../lib/i18n";
import { askDetect } from "../lib/detect";
import type { ProxyNode, ProxyNodeInfo } from "../lib/bridge";
import type { Exit } from "../lib/model";
import Modal from "./Modal";
import ExitSubscribe from "./ExitSubscribe";
import { IconCheck, IconCopy, IconRefresh } from "./iconAliases";

/**
 * 新建出口。
 *
 * 结构上是**两步**，不是三个平铺的 tab：
 *
 *   第一步：谁来跑这个代理
 *     · App 托管   —— 我们自带内核，为选中的节点单起一个实例
 *     · 用我本机的 —— 复用用户已经装好的代理软件，或手填端口
 *   第二步：节点从哪来（随第一步变）
 *
 * 之前这里是把「用订阅 / 从代理软件选 / 手动填地址」三个 tab 平铺。
 * 问题不在选项多少，而在它们**不在同一个层级**：前一个是"我们自己跑"，
 * 后两个是"用你的"。平铺之后用户看不出该选哪条，只能挨个点开试。
 */

const KIND_LABEL: Record<ProxyNode["kind"], { zh: string; en: string }> = {
  residential: { zh: "住宅 IP", en: "Residential" },
  datacenter: { zh: "机房 IP", en: "Datacenter" },
  chained: { zh: "链式", en: "Chained" },
  other: { zh: "其他", en: "Other" },
};

const ORDER: ProxyNode["kind"][] = ["residential", "datacenter", "chained", "other"];

/**
 * 端口状态：一个点 + 一句话。
 *
 * 这个反馈必须在输入框旁边，因为它是"能不能建"的唯一条件 ——
 * 放到别处用户就得来回找。
 */
function PortState({ state, port }: { state: "unknown" | "checking" | "open" | "closed"; port: number }) {
  if (!port) return null;
  if (state === "checking") {
    return <span className="xp-ps s-wait">{tr("检测中…", "Checking…")}</span>;
  }
  if (state === "open") {
    return <span className="xp-ps s-ok">{tr("端口已开", "Port is open")}</span>;
  }
  if (state === "closed") {
    return <span className="xp-ps s-bad">{tr("端口没开", "Port is closed")}</span>;
  }
  return null;
}

export default function ExitPicker({
  onClose,
  onCreate,
  /** 建议端口起点，按已有出口数量错开 */
  nextPort = 7901,
  /** 从「代理方式」卡点进来时，直接落在选中的那条路上 */
  initialWho = "managed",
}: {
  onClose: () => void;
  /** id 可以由弹窗指定：托管出口要拿它当实例的目录名，必须和出口 id 一致 */
  onCreate: (exit: Omit<Exit, "id"> & { id?: string }) => void;
  nextPort?: number;
  initialWho?: "managed" | "local";
}) {
  /** 第一步：谁来跑这个代理。默认 App 托管 —— 那是唯一不用改用户配置的一条 */
  const [who, setWho] = useState<"managed" | "local">(initialWho);
  /** 第二步（仅本机代理）：从软件里选，还是手填 */
  const [localMode, setLocalMode] = useState<"app" | "manual">("app");

  const [subPick, setSubPick] = useState<{ subId: string; node: string; label: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);

  const [info, setInfo] = useState<ProxyNodeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [node, setNode] = useState<ProxyNode | null>(null);
  const [port, setPort] = useState(String(nextPort));
  const [mHost, setMHost] = useState("127.0.0.1");
  const [mPort, setMPort] = useState("");
  const [copied, setCopied] = useState(false);
  /**
   * 端口是否真的在监听。
   *
   * 这一步不能省：之前允许用户填一个还没配好的端口直接建出口，
   * 结果建出来就是坏的 —— 列表里显示"连不上"，用户以为功能坏了。
   * 实际上是他还没把 listeners 加进代理配置。先探活，再让他建。
   */
  const [portState, setPortState] = useState<"unknown" | "checking" | "open" | "closed">("unknown");

  const manual = who === "local" && localMode === "manual";

  const load = async () => {
    setLoading(true);
    try {
      const r = await window.claudeBuddy.proxyNodes();
      setInfo(r.info);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /** 端口变了就探一次；防抖 400ms，避免每敲一个数字都连 */
  const host = manual ? mHost.trim() : "127.0.0.1";
  const curPort = manual ? Number(mPort) : Number(port);
  useEffect(() => {
    if (!curPort) {
      setPortState("unknown");
      return;
    }
    setPortState("checking");
    const t = setTimeout(async () => {
      try {
        const r = await window.claudeBuddy.portOpen({ host, port: curPort });
        setPortState(r.open ? "open" : "closed");
      } catch {
        setPortState("unknown");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [host, curPort]);

  const snippet = node
    ? `listeners:
  - name: claude-${port}
    type: mixed
    port: ${port}
    proxy: "${node.name}"`
    : "";

  const groups = info
    ? ORDER.map((k) => ({ kind: k, items: info.nodes.filter((n) => n.kind === k) })).filter((g) => g.items.length > 0)
    : [];

  /** 地址填全了就能建（端口开不开是下一步的事） */
  const filled = manual ? Boolean(mHost.trim() && Number(mPort)) : Boolean(node && Number(port));

  /**
   * 能不能建。
   *
   * 本机代理这条：填了地址就行，端口没开也能建 —— 他本来就是来拿那段
   * listeners 去配端口的，卡着不让他建等于"要进门先有钥匙，要钥匙先进门"。
   * 建出来先标「待配置」，配好端口再实测即可。
   */
  const canCreate = who === "managed" ? Boolean(subPick) : filled;

  /**
   * 创建托管出口。
   *
   * 顺序很关键：**先把实例拉起来拿到真端口，再建出口**。
   * 反过来的话，出口建出来指向一个还没确定的端口，用户得再回来重测一次 ——
   * 那就又变成「先有鸡还是先有蛋」了。
   */
  const createManaged = async () => {
    if (!subPick) return;
    setStarting(true);
    setStartErr(null);
    // exitId 同时是实例目录名，和出口 id 用同一个，重启后才能认回来
    const exitId = `x-${Date.now().toString(36)}`;
    try {
      const r = await window.claudeBuddy.exitStart({
        exitId,
        subId: subPick.subId,
        node: subPick.node,
      });
      if (!r.ok || !r.port) {
        setStartErr(r.reason ?? tr("实例启动失败", "Failed to start the instance"));
        return;
      }
      onCreate({
        id: exitId,
        label: subPick.label,
        node: subPick.node,
        proxy: { protocol: "http", host: r.host ?? "127.0.0.1", port: r.port, noProxy: "localhost,127.0.0.1,::1" },
        managed: { subId: subPick.subId, node: subPick.node },
      });
      close();
    } finally {
      setStarting(false);
    }
  };

  /**
   * 创建时端口已经通了，就顺手测一次，把 IP 一起带进去。
   *
   * 不然会出现一个别扭的状态：端口明明是开的，出口却显示「待配置」，
   * 还要用户自己再点一次实测。能确定的就一次做完。
   */
  const createWithMeasure = async () => {
    const h = manual ? mHost.trim() : "127.0.0.1";
    const p = manual ? Number(mPort) : Number(port);
    let ip: string | undefined;
    if (portState === "open") {
      /** 同样先问再发 —— 这一下会向 ipify 报告这个端口的出口 IP */
      const allow = await askDetect({
        targets: ["api.ipify.org"],
        exposes: tr("这个端口的出口 IP 与请求时间。", "The exit IP of this port, plus the request time."),
        why: tr(
          "建出口时顺手测一次，省得建完还要再点一次。不测也能建，之后随时可测。",
          "Measuring now saves a click later. You can also create it first and measure any time.",
        ),
      });
      if (allow) {
        try {
          const r = await window.claudeBuddy.proxyTest({ host: h, port: p, protocol: "http" });
          if (r.ok && r.ip) ip = r.ip;
        } catch {
          /* 测不到就算了，出口照样建，回头还能再测 */
        }
      }
    }
    onCreate({
      label: manual ? `${h}:${p}` : node?.name ?? `${h}:${p}`,
      node: manual ? undefined : node?.name,
      app: manual ? undefined : info?.app,
      proxy: { protocol: "http", host: h, port: p, noProxy: "localhost,127.0.0.1,::1" },
      lastIp: ip,
    });
  };

  return createPortal(
    <Modal onClose={onClose} className="xp" label={tr("新建出口", "New exit")}>
      {(close) => (
        <>
          <div className="xp-head">
            <b>{tr("新建出口", "New exit")}</b>
            <small>
              {tr(
                "一个出口就是一个代理端口。多个环境可以共用，也可以各用各的。",
                "An exit is one proxy port. Environments can share it or each have their own.",
              )}
            </small>
          </div>

          {/* 第一步：谁来跑这个代理 */}
          <div className="xp-choose">
            <button
              className={who === "managed" ? "on" : ""}
              onClick={() => setWho("managed")}
              data-role="managed"
            >
              <span className="xp-choose-t">
                <b>{tr("App 托管", "Managed by app")}</b>
                <em>{tr("推荐", "Recommended")}</em>
              </span>
              <small>
                {tr(
                  "自带内核，为每个节点单开一个实例。不用改你的配置，也不用重启任何东西。",
                  "Bundled kernel; each node gets its own instance. Nothing to edit, nothing to restart.",
                )}
              </small>
            </button>
            <button className={who === "local" ? "on" : ""} onClick={() => setWho("local")} data-role="local">
              <span className="xp-choose-t">
                <b>{tr("用我本机的代理", "Use my own proxy")}</b>
              </span>
              <small>
                {tr(
                  "复用你已经装好的代理软件，或者手填一个端口。",
                  "Reuse the proxy app you already have, or type a port.",
                )}
              </small>
            </button>
          </div>

          {who === "managed" ? (
            <ExitSubscribe selected={subPick} onPick={setSubPick} />
          ) : (
            <>
              <div className="xp-tabs">
                <button className={localMode === "app" ? "on" : ""} onClick={() => setLocalMode("app")}>
                  {tr("从代理软件选", "Pick from proxy app")}
                </button>
                <button className={localMode === "manual" ? "on" : ""} onClick={() => setLocalMode("manual")}>
                  {tr("手动填地址", "Enter address")}
                </button>
              </div>

              {manual ? (
                <div className="xp-manual">
                  <p>
                    {tr(
                      "你已经有一个独立的代理端口（比如在代理软件里配好了第二个 listener），直接填进来。",
                      "You already have a separate proxy port (for example a second listener configured in your proxy app). Enter it here.",
                    )}
                  </p>
                  <div className="em-proxy">
                    <input
                      className="em-in"
                      value={mHost}
                      onChange={(e) => setMHost(e.target.value)}
                      placeholder="127.0.0.1"
                    />
                    <input
                      className="em-in em-port"
                      value={mPort}
                      onChange={(e) => setMPort(e.target.value.replace(/\D/g, ""))}
                      placeholder={tr("端口", "Port")}
                    />
                  </div>
                </div>
              ) : loading ? (
                <div className="xp-empty">{tr("正在读代理配置…", "Reading proxy config…")}</div>
              ) : !info ? (
                <div className="xp-empty">
                  {tr(
                    "没识别到代理软件。可以用「手动填地址」直接填端口。",
                    "No proxy app detected. Use “Enter address” to type a port.",
                  )}
                </div>
              ) : (
                <div className="xp-body">
                  <div className="xp-src">
                    <span>
                      <b>{info.app}</b>
                      <small className="mono">{tr(`${info.nodes.length} 个节点`, `${info.nodes.length} nodes`)}</small>
                    </span>
                    <button className="det-k" onClick={() => void load()}>
                      <IconRefresh size={11} />
                      {tr("重新读取", "Reload")}
                    </button>
                  </div>

                  <div className="xp-nodes">
                    {groups.map((g) => (
                      <div className="xp-group" key={g.kind}>
                        <div className="xp-ghead">
                          <span className={`pn-kind k-${g.kind}`}>
                            {tr(KIND_LABEL[g.kind].zh, KIND_LABEL[g.kind].en)}
                          </span>
                          <span className="pn-count">{g.items.length}</span>
                        </div>
                        {g.items.map((n) => (
                          <button
                            key={n.name}
                            className={`xp-node${node?.name === n.name ? " on" : ""}`}
                            onClick={() => setNode(node?.name === n.name ? null : n)}
                          >
                            <span className={`pn-radio${node?.name === n.name ? " on" : ""}`} />
                            <span className="pn-name">{n.name}</span>
                            <span className="pn-type mono">{n.type}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>

                  {node && (
                    <div className="xp-next">
                      <div className="xp-next-h">
                        <b>
                          {tr("给「", "Give “")}
                          {node.name}
                          {tr("」开一个独立端口", "” its own port")}
                        </b>
                      </div>
                      <p>
                        {tr(
                          "代理软件默认只有一个端口，所有节点共用它。要让这个节点单独出一个 IP，得在配置里加一段 listeners，然后重启代理。",
                          "Your proxy app opens one port by default and every node shares it. To give this node its own IP, add a listeners block and restart the app.",
                        )}
                      </p>
                      <div className="xp-port">
                        <span>{tr("端口", "Port")}</span>
                        <input
                          className="em-in em-port"
                          value={port}
                          onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                        />
                        <PortState state={portState} port={curPort} />
                      </div>
                      <div className="gx-code">
                        <div className="gx-code-h">
                          <span>{tr("加在你的代理配置里", "Add to your proxy config")}</span>
                          <button
                            className="det-k"
                            onClick={() => {
                              void navigator.clipboard.writeText(snippet);
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1500);
                            }}
                          >
                            <IconCopy size={11} />
                            {copied ? tr("已复制", "Copied") : tr("复制", "Copy")}
                          </button>
                        </div>
                        <pre>{snippet}</pre>
                      </div>
                      {portState === "closed" && (
                        <p className="xp-block">
                          {tr(
                            "这个端口还没开。可以直接创建，出口会先标成「待配置」；把上面的片段加进代理配置、重启代理之后，回来点「实测出口」就会变成可用。",
                            "This port is not open yet. You can still create it — the exit is marked Pending. Add the snippet to your proxy config, restart the app, then hit Measure exit to make it usable.",
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="xp-foot">
            <button className="btn ghost" onClick={close}>
              {tr("取消", "Cancel")}
            </button>
            {who === "local" && portState === "closed" && (
              <button
                className="btn"
                onClick={() => {
                  // 让用户配置完能立刻复检，不用关掉弹窗重来
                  setPortState("checking");
                  void window.claudeBuddy
                    .portOpen({ host, port: curPort })
                    .then((r) => setPortState(r.open ? "open" : "closed"))
                    .catch(() => setPortState("unknown"));
                }}
              >
                <IconRefresh size={11} />
                {tr("重新检测", "Re-check")}
              </button>
            )}
            {startErr && <span className="xp-err">{startErr}</span>}
            <button
              className="btn pri"
              disabled={!canCreate || starting}
              onClick={() => {
                if (who === "managed") {
                  void createManaged();
                  return;
                }
                void createWithMeasure();
                close();
              }}
            >
              <IconCheck size={11} />
              {starting ? tr("启动中…", "Starting…") : tr("创建出口", "Create exit")}
            </button>
          </div>
        </>
      )}
    </Modal>,
    document.body,
  );
}