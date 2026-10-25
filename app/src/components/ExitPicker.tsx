import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../lib/i18n";
import type { ProxyNode, ProxyNodeInfo } from "../lib/bridge";
import type { Exit } from "../lib/model";
import Modal from "./Modal";
import { IconCheck, IconCopy, IconRefresh } from "./iconAliases";

/**
 * 新建出口 —— 选一个节点，或者手动填地址。
 *
 * 单独一页而不是塞进网络设置里：一个订阅十几个节点，铺在设置页里既读不完，
 * 也把"我有几个出口"这个真问题淹掉。这里空间够，可以摊开讲清楚。
 *
 * 两条路径，因为现实就是两条：
 *   · 从代理软件选节点 —— 需要先给节点开一个 listener 端口，选完给片段
 *   · 手动填地址 —— 用户已经在别处配好了端口，直接填
 *
 * 不假装"选个节点就完事"：Sparkle 里选节点只是换了策略组的指向，
 * 端口还是那一个，出口还是同一个。
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
}: {
  onClose: () => void;
  onCreate: (exit: Omit<Exit, "id">) => void;
  nextPort?: number;
}) {
  const [info, setInfo] = useState<ProxyNodeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [node, setNode] = useState<ProxyNode | null>(null);
  const [port, setPort] = useState(String(nextPort));
  const [manual, setManual] = useState(false);
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
   * 能不能建：填了地址就行，端口没开也能建。
   *
   * 之前这里卡了 `portState === "open"`，结果是个死锁 ——
   * 用户来这个弹窗，本来就是为了拿到那段 listeners 去配端口；
   * 而端口没配好又不让他建，等于"要进门先有钥匙，要钥匙先进门"。
   *
   * 正确的做法是让他建，但把状态标清楚：这个出口现在是「待配置」，
   * 配好端口再点实测就会变成可用。列表里也能一眼看出哪个还没通。
   */
  const canCreate = filled;

  /**
   * 创建时端口已经通了，就顺手测一次，把 IP 一起带进去。
   *
   * 不然会出现一个别扭的状态：端口明明是开的，出口却显示「待配置」，
   * 还要用户自己再点一次实测。能确定的就一次做完。
   */
  const createWithMeasure = async () => {
    const host = manual ? mHost.trim() : "127.0.0.1";
    const p = manual ? Number(mPort) : Number(port);
    let ip: string | undefined;
    if (portState === "open") {
      try {
        const r = await window.claudeBuddy.proxyTest({ host, port: p, protocol: "http" });
        if (r.ok && r.ip) ip = r.ip;
      } catch {
        /* 测不到就算了，出口照样建，回头还能再测 */
      }
    }
    onCreate({
      label: manual ? `${host}:${p}` : node?.name ?? `${host}:${p}`,
      node: manual ? undefined : node?.name,
      app: manual ? undefined : info?.app,
      proxy: { protocol: "http", host, port: p, noProxy: "localhost,127.0.0.1,::1" },
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

          <div className="xp-tabs">
            <button className={manual ? "" : "on"} onClick={() => setManual(false)}>
              {tr("从代理软件选", "Pick from proxy app")}
            </button>
            <button className={manual ? "on" : ""} onClick={() => setManual(true)}>
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
                <input className="em-in" value={mHost} onChange={(e) => setMHost(e.target.value)} placeholder="127.0.0.1" />
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
                      <span className={`pn-kind k-${g.kind}`}>{tr(KIND_LABEL[g.kind].zh, KIND_LABEL[g.kind].en)}</span>
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

          <div className="xp-foot">
            <button className="btn ghost" onClick={close}>
              {tr("取消", "Cancel")}
            </button>
            {portState === "closed" && (
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
            <button className="btn pri" disabled={!canCreate} onClick={() => { void createWithMeasure(); close(); }}>
              <IconCheck size={11} />
              {tr("创建出口", "Create exit")}
            </button>
          </div>
        </>
      )}
    </Modal>,
    document.body,
  );
}
