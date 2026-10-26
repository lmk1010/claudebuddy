import { useEffect, useState } from "react";
import type { BuddyState as ShellState } from "../lib/model";
import { PROXY_MODES } from "../lib/model";
import type { Subscription } from "../lib/bridge";
import { tr } from "../lib/i18n";
import { IconPlus, IconRefresh, IconTrash, IconFile } from "./iconAliases";

/**
 * 设置 · 节点来源。
 *
 * 订阅和导入的 YAML 是**全局资源**，不属于任何一个环境 —— 所以它们归设置管，
 * 而不是藏进某个环境的抽屉里。放对了地方，用户才能理解"我有几个节点来源"
 * 和"某个环境现在走哪条"是两件事。
 *
 * 这里只管来源本身（有哪些、能不能刷新）。"哪个环境用哪个节点"在环境里。
 */
export default function SettingsNetwork({
  state,
  update,
}: {
  state: ShellState;
  update: (patch: Partial<ShellState>) => void;
}) {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await window.claudeBuddy.subList();
      setSubs(r.list);
    } catch {
      /* 主进程不可用就当没有来源，不打断设置页 */
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await window.claudeBuddy.subAdd({ url: u });
      if (!r.ok) {
        setErr(r.reason ?? tr("添加失败", "Failed to add"));
        return;
      }
      setUrl("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const importYaml = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await window.claudeBuddy.subImportYaml();
      if (r.canceled) return;
      if (!r.ok) {
        setErr(r.reason ?? tr("导入失败", "Import failed"));
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (id: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await window.claudeBuddy.subRefresh({ id });
      if (!r.ok) setErr(r.reason ?? tr("刷新失败", "Refresh failed"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await window.claudeBuddy.subRemove({ id });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const mode = state.defaultProxyMode ?? "managed";

  return (
    <>
      <h1>{tr("网络", "Network")}</h1>

      <div className="sr">
        <div style={{ minWidth: 0 }}>
          <b>{tr("新环境默认用哪种代理方式", "Default proxy mode for new environments")}</b>
          <small>
            {tr(
              "只决定新建环境时的起始值，建好之后各自独立 —— 改这里不会动到已有的环境。",
              "Only sets the starting value when you create an environment. Existing ones are untouched.",
            )}
          </small>
        </div>
        <div className="seg">
          {PROXY_MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => update({ defaultProxyMode: m.id })}>
              {tr(m.zh, m.en)}
            </button>
          ))}
        </div>
      </div>

      <div className="sr">
        <div style={{ minWidth: 0 }}>
          <b>{tr("节点来源", "Node sources")}</b>
          <small>
            {tr(
              "订阅地址或本地 YAML。这里是全局的，任何环境都能从中挑节点。",
              "A subscription URL or a local YAML. This list is global — any environment can pick nodes from it.",
            )}
          </small>
        </div>
      </div>

      <div className="src-add">
        <input
          className="em-in"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={tr("粘 Clash / Mihomo 订阅地址", "Paste a Clash / Mihomo subscription URL")}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <button className="btn pri" disabled={!url.trim() || busy} onClick={() => void add()}>
          <IconPlus size={11} />
          {tr("添加", "Add")}
        </button>
        <button className="btn" disabled={busy} onClick={() => void importYaml()}>
          <IconFile size={11} />
          {tr("导入 YAML", "Import YAML")}
        </button>
      </div>

      {err && <div className="src-err">{err}</div>}

      {subs.length === 0 ? (
        <div className="src-empty">
          {tr(
            "还没有节点来源。粘一个订阅地址，或者导入一份本地 YAML 配置。",
            "No node source yet. Paste a subscription URL, or import a local YAML config.",
          )}
        </div>
      ) : (
        <div className="src-list">
          {subs.map((s) => (
            <div className="src-row" key={s.id}>
              <span className="src-main">
                <b>{s.label}</b>
                <small className="mono">
                  {s.source === "file" ? tr("本地文件", "Local file") : s.host || tr("订阅", "Subscription")}
                  {" · "}
                  {tr(`${s.count} 个节点`, `${s.count} nodes`)}
                </small>
              </span>
              {s.source === "file" ? (
                <button className="det-k" disabled={busy} onClick={() => void importYaml()}>
                  <IconFile size={11} />
                  {tr("重新导入", "Re-import")}
                </button>
              ) : (
                <button className="det-k" disabled={busy} onClick={() => void refresh(s.id)}>
                  <IconRefresh size={11} />
                  {tr("刷新", "Refresh")}
                </button>
              )}
              <button className="det-k danger" disabled={busy} onClick={() => void remove(s.id)}>
                <IconTrash size={11} />
                {tr("移除", "Remove")}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}