import { useEffect, useState } from "react";
import type { ProxyNode, ProxyNodeInfo } from "../lib/bridge";
import { tr } from "../lib/i18n";

/**
 * 节点清单 —— 把代理软件里的节点列出来，让人给这个环境挑一个出口。
 *
 * 为什么要这一屏：
 * 一个 mihomo 实例默认只有一个 `mixed-port`，几十个节点全挤在它后面。
 * 用户以为「配了代理就有独立 IP」，其实两个环境填同一个端口，出口就是同一个。
 * 要分开必须给节点各开一个入口（listeners），而开之前得先让人看清有哪些节点。
 *
 * 交互原则（人机协同，不自动）：
 *   · 节点按类别分组，住宅 IP 排最前 —— 那才是适合分环境的
 *   · 选哪个由用户定，我们不替他决定
 *   · 选完不立刻改配置，先让他看清"会发生什么"
 */

const KIND_LABEL: Record<ProxyNode["kind"], { zh: string; en: string; hint: { zh: string; en: string } }> = {
  residential: {
    zh: "住宅 IP",
    en: "Residential",
    hint: { zh: "最适合当独立出口，每个环境一个", en: "Best for separate exits, one per environment" },
  },
  datacenter: {
    zh: "机房 IP",
    en: "Datacenter",
    hint: { zh: "能用，但机房段容易被识别", en: "Usable, but datacenter ranges are easy to spot" },
  },
  chained: {
    zh: "链式",
    en: "Chained",
    hint: { zh: "多跳中转，延迟更高", en: "Multi-hop, higher latency" },
  },
  other: {
    zh: "其他",
    en: "Other",
    hint: { zh: "名字里看不出类型", en: "Type unclear from the name" },
  },
};

const ORDER: ProxyNode["kind"][] = ["residential", "datacenter", "chained", "other"];

export default function ProxyNodes({
  currentExitIp,
  slot,
}: {
  currentExitIp: string | null;
  /** 这个环境占第几个出口（从 1 开始），决定生成哪个端口 */
  slot: number;
}) {
  const [info, setInfo] = useState<ProxyNodeInfo | null>(null);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [showSnippet, setShowSnippet] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await window.claudeBuddy.proxyNodes();
      setInfo(r.info);
      setSummary(r.summary);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="em-card">
        <div className="em-empty" style={{ border: 0 }}>
          {tr("正在读代理配置…", "Reading proxy config…")}
        </div>
      </div>
    );
  }

  // 没识别到代理软件：不摆一堆空框，直接说清下一步
  if (!info) {
    return (
      <div className="em-card">
        <div className="em-empty" style={{ border: 0 }}>
          {summary || tr("没识别到代理软件。", "No proxy app detected.")}
        </div>
      </div>
    );
  }

  const groups = ORDER.map((k) => ({
    kind: k,
    items: info.nodes.filter((n) => n.kind === k),
  })).filter((g) => g.items.length > 0);

  // 已经开了几个独立入口 —— 这是"能分出几个出口"的上限
  const exits = 1 + info.listeners.length;
  const pickedNode = info.nodes.find((n) => n.name === picked) ?? null;

  /**
   * 给这个环境分配的入口端口。
   * 从 7901 起，避开 7890（主力端口）和常见代理端口，
   * 并按 slot 错开 —— 两个环境不会拿到同一个端口。
   */
  const port = 7900 + slot;
  const snippet = pickedNode
    ? [
        "listeners:",
        `  - name: claude-env-${slot}`,
        "    type: mixed",
        `    port: ${port}`,
        `    proxy: "${pickedNode.name}"`,
      ].join("\n")
    : "";

  return (
    <>
      {/* 一句话说清现状：识别到什么、有几个入口 */}
      <div className="em-sub">
        <span>{tr("节点", "Nodes")}</span>
        <button className="det-k" onClick={() => void load()} disabled={loading}>
          {tr("重新读取", "Reload")}
        </button>
      </div>

      <div className="em-card">
        <div className="pn-sum">
          <b>{info.app}</b>
          <span className="pn-meta">
            {tr(`${info.nodes.length} 节点 · ${exits} 个入口`, `${info.nodes.length} nodes · ${exits} exits`)}
          </span>
          <small>{summary}</small>
        </div>

        {groups.map((g) => (
          <div className="pn-group" key={g.kind}>
            <div className="pn-ghead">
              <span className={`pn-kind k-${g.kind}`}>{tr(KIND_LABEL[g.kind].zh, KIND_LABEL[g.kind].en)}</span>
              <span className="pn-count">{g.items.length}</span>
              <span className="pn-hint">{tr(KIND_LABEL[g.kind].hint.zh, KIND_LABEL[g.kind].hint.en)}</span>
            </div>
            {g.items.map((n) => {
              const on = picked === n.name;
              return (
                <button
                  key={n.name}
                  className={`pn-row${on ? " on" : ""}`}
                  onClick={() => setPicked(on ? null : n.name)}
                >
                  <span className={`pn-radio${on ? " on" : ""}`} />
                  <span className="pn-name">{n.name}</span>
                  <span className="pn-type mono">{n.type}</span>
                  <span className="pn-server mono">{n.server}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* 选完先说清会发生什么，再给出要粘贴的片段 —— 不直接改人家的配置 */}
      {pickedNode && (
        <div className="em-card pn-plan">
          <div className="pn-plan-h">
            <b>
              {tr("把「", "Use ")}
              {pickedNode.name}
              {tr("」作为这个环境的出口", " as this environment's exit")}
            </b>
          </div>
          <p>
            {tr(
              `现在所有环境都走同一个端口 ${info.ports.mixed || "—"}，出口是同一个 IP。要用这个节点，得先给它开一个独立入口端口，再把本环境指向那个端口。`,
              `Every environment currently goes through port ${info.ports.mixed || "—"} and shares one exit IP. To use this node, give it its own listener port, then point this environment at it.`,
            )}
          </p>

          {showSnippet ? (
            <>
              <div className="pn-snip">
                <div className="pn-snip-h">
                  <span>{tr("粘到代理配置的顶层（和 mixed-port 同级）", "Paste at the top level of your proxy config")}</span>
                  <button
                    className="det-k"
                    onClick={() => {
                      void navigator.clipboard.writeText(snippet);
                    }}
                  >
                    {tr("复制", "Copy")}
                  </button>
                </div>
                <pre className="pn-code">{snippet}</pre>
              </div>
              <p className="pn-plan-warn">
                {tr(
                  `重启代理后，这个环境就填 127.0.0.1:${port}，它只会走「${pickedNode.name}」，不影响别的程序。`,
                  `After restarting your proxy, set this environment to 127.0.0.1:${port}. Only this node is used, and other apps are unaffected.`,
                )}
              </p>
            </>
          ) : (
            <p className="pn-plan-warn">
              {tr(
                "这一步要改代理软件的配置。我们先只生成片段给你确认，不替你改文件。",
                "This edits your proxy app's config. We only generate the snippet for you to review; we do not touch your files.",
              )}
            </p>
          )}

          <div className="pn-plan-actions">
            {showSnippet ? (
              <button className="btn ghost" onClick={() => setShowSnippet(false)}>
                {tr("收起", "Hide")}
              </button>
            ) : (
              <button className="btn" onClick={() => setShowSnippet(true)}>
                {tr("生成配置片段", "Generate snippet")}
              </button>
            )}
            <button className="btn ghost" onClick={() => { setPicked(null); setShowSnippet(false); }}>
              {tr("取消", "Cancel")}
            </button>
          </div>
          {currentExitIp && (
            <p className="pn-plan-cur">
              {tr("当前出口：", "Current exit: ")}
              <span className="mono">{currentExitIp}</span>
            </p>
          )}
        </div>
      )}
    </>
  );
}
