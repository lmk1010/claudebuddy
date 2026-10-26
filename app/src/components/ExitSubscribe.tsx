import { useEffect, useState } from "react";
import type { Subscription, ProxyNode } from "../lib/bridge";
import { tr } from "../lib/i18n";
import { IconPlus, IconRefresh, IconWarning, IconFile } from "./iconAliases";

/**
 * 「App 托管」的节点来源 —— 订阅地址，或者一份本地 YAML。
 *
 * 两条来源共用同一套下游：存下来之后，节点列表、实例配置、单节点提取
 * 都走同一条路。所以这里只是入口不同，不会出现"导入的能看不能用"。
 *
 * 用户只做一件事：给个来源。之后选一个节点，App 自己拉一个 mihomo
 * 实例出来（独立目录、独立端口、只绑这个节点），不需要改任何配置、重启任何东西。
 */

const KIND_LABEL: Record<ProxyNode["kind"], { zh: string; en: string }> = {
  residential: { zh: "住宅 IP", en: "Residential" },
  datacenter: { zh: "机房 IP", en: "Datacenter" },
  chained: { zh: "链式", en: "Chained" },
  other: { zh: "其他", en: "Other" },
};

const ORDER: ProxyNode["kind"][] = ["residential", "datacenter", "chained", "other"];

export default function ExitSubscribe({
  selected,
  onPick,
}: {
  selected: { subId: string; node: string } | null;
  onPick: (v: { subId: string; node: string; label: string } | null) => void;
}) {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [kernelReady, setKernelReady] = useState<boolean | null>(null);

  const load = async (prefer?: string) => {
    const r = await window.claudeBuddy.subList();
    setSubs(r.list);
    const want = prefer ?? active;
    if (r.list.length && (!want || !r.list.some((s) => s.id === want))) setActive(r.list[0].id);
    else if (want) setActive(want);
  };

  useEffect(() => {
    void load();
    void window.claudeBuddy.kernelStatus().then((k) => setKernelReady(Boolean(k.ready)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    const u = url.trim();
    if (!u) return;
    setAdding(true);
    setErr(null);
    try {
      const r = await window.claudeBuddy.subAdd({ url: u });
      if (!r.ok) {
        setErr(r.reason ?? tr("订阅添加失败", "Failed to add subscription"));
        return;
      }
      setUrl("");
      onPick(null);
      await load(r.sub?.id);
    } finally {
      setAdding(false);
    }
  };

  const importYaml = async () => {
    setAdding(true);
    setErr(null);
    try {
      const r = await window.claudeBuddy.subImportYaml();
      if (r.canceled) return;
      if (!r.ok) {
        setErr(r.reason ?? tr("导入失败", "Import failed"));
        return;
      }
      onPick(null);
      await load(r.sub?.id);
    } finally {
      setAdding(false);
    }
  };

  const cur = subs?.find((s) => s.id === active) ?? null;
  const groups = cur
    ? ORDER.map((k) => ({ kind: k, items: cur.nodes.filter((n) => n.kind === k) })).filter((g) => g.items.length > 0)
    : [];

  if (subs === null) {
    return <div className="xp-empty">{tr("读取节点中…", "Loading nodes…")}</div>;
  }

  return (
    <div className="xp-body">
      {kernelReady === false && (
        <div className="xp-kinstall">
          <IconWarning size={14} />
          <span>
            {tr(
              "首次使用要下载一份 mihomo 内核（几十 MB），下载完由本机托管，不依赖你装的代理软件。",
              "First use downloads a mihomo kernel (tens of MB). After that it runs locally and does not depend on your proxy app.",
            )}
          </span>
          <button
            className="btn"
            onClick={() => {
              setErr(null);
              void window.claudeBuddy.kernelInstall().then((r) => {
                if (!r.ok) setErr(r.reason ?? tr("内核安装失败", "Kernel install failed"));
                else {
                  setKernelReady(true);
                  void load();
                }
              });
            }}
          >
            {tr("下载内核", "Download kernel")}
          </button>
        </div>
      )}

      <div className="xp-sub-add">
        <input
          className="em-in"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={tr("粘 Clash / Mihomo 订阅地址", "Paste a Clash / Mihomo subscription URL")}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <button className="btn pri" disabled={!url.trim() || adding} onClick={() => void add()}>
          <IconPlus size={11} />
          {adding ? tr("拉取中…", "Fetching…") : tr("添加", "Add")}
        </button>
      </div>

      {/* 没有订阅链接也不要紧 —— 手里那份本地配置直接导入 */}
      <div className="xp-or">
        <span>{tr("或者", "or")}</span>
        <button className="det-k" disabled={adding} onClick={() => void importYaml()}>
          <IconFile size={11} />
          {tr("导入本地 YAML 文件", "Import a local YAML file")}
        </button>
      </div>

      {err && <div className="xp-err">{err}</div>}

      {subs.length === 0 ? (
        <div className="xp-empty">
          {tr(
            "还没有节点来源。粘一个 Clash / Mihomo 订阅地址，或者导入一份本地 YAML 配置。",
            "No node source yet. Paste a Clash / Mihomo URL, or import a local YAML config.",
          )}
        </div>
      ) : (
        <>
          {subs.length > 1 && (
            <div className="xp-subs">
              {subs.map((s) => (
                <button
                  key={s.id}
                  className={`xp-sub${s.id === active ? " on" : ""}`}
                  onClick={() => {
                    setActive(s.id);
                    onPick(null);
                  }}
                >
                  <b>{s.label}</b>
                  <small>{s.count}</small>
                </button>
              ))}
            </div>
          )}

          <div className="xp-src">
            <span>
              <b>{cur?.label}</b>
              <small className="mono">
                {cur?.source === "file"
                  ? tr(`本地文件 · ${cur?.nodes.length ?? 0} 个节点`, `Local file · ${cur?.nodes.length ?? 0} nodes`)
                  : tr(`${cur?.nodes.length ?? 0} 个节点`, `${cur?.nodes.length ?? 0} nodes`)}
              </small>
            </span>
            {cur?.source === "file" ? (
              <button className="det-k" disabled={adding} onClick={() => void importYaml()}>
                <IconFile size={11} />
                {tr("重新导入", "Re-import")}
              </button>
            ) : (
              <button
                className="det-k"
                onClick={() => {
                  if (!cur) return;
                  void window.claudeBuddy.subRefresh({ id: cur.id }).then(async (r) => {
                    if (!r.ok) setErr(r.reason ?? tr("刷新失败", "Refresh failed"));
                    await load(cur.id);
                  });
                }}
              >
                <IconRefresh size={11} />
                {tr("刷新订阅", "Refresh")}
              </button>
            )}
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
                    className={`xp-node${selected?.node === n.name ? " on" : ""}`}
                    onClick={() =>
                      onPick(selected?.node === n.name ? null : { subId: cur!.id, node: n.name, label: n.name })
                    }
                  >
                    <span className={`pn-radio${selected?.node === n.name ? " on" : ""}`} />
                    <span className="pn-name">{n.name}</span>
                    <span className="pn-type mono">{n.type}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {selected && (
            <div className="xp-next">
              <div className="xp-next-h">
                <b>
                  {tr("「", "“")}
                  {selected.node}
                  {tr("」会成为一个独立出口", "” becomes its own exit")}
                </b>
              </div>
              <p>
                {tr(
                  "点创建之后，App 会为这个节点单独拉一个内核实例，只开一个端口，只绑这一个节点。它和本机跑着的代理软件没有关系，也不改你的系统代理。",
                  "When you create it, the app spins up a dedicated kernel instance for this node — one port, one node. It is independent of your proxy app and does not touch your system proxy.",
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}