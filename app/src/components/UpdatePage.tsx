import { useEffect, useState } from "react";
import type { AppInfo, UpdateState } from "../lib/bridge";
import { tr } from "../lib/i18n";
import Help from "./Help";

/**
 * 更新页。
 *
 * 单独一页，不在「关于」里塞卡片 —— 关于页的职责是"这台机器跑的是什么"，
 * 更新是一个有状态、会持续几十秒的动作，两者不该挤在一起。
 *
 * 版式上刻意跟其它设置页不同：别的页是「一行一项」的清单，这一页只有一件事，
 * 所以做成一张对外的名片 —— 左边是应用本体，右边是它的版本和状态。
 *
 * 三个细节是刻意做的：
 *   · 点了先自己转够 0.9 秒。检查命中 CDN 缓存时 100ms 就回来了，
 *     不这么做就是"点了一下什么都没发生"。
 *   · 进度条分确定/不确定两种。下载时按百分比走，检查时来回滑 ——
 *     检查没有进度可言，给一条会滑的比给一个假的百分比诚实。
 *   · 版本号取 info().version 而不是更新状态里的 current：
 *     开发态和没有发布源的包里 current 是空的，会显示成一个破折号。
 */
export default function UpdatePage() {
  const [upd, setUpd] = useState<UpdateState | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  /** 本地"正在检查"—— 保证点击一定有可见反馈 */
  const [spin, setSpin] = useState(false);

  useEffect(() => {
    void window.claudeBuddy.info().then(setInfo);
    void window.claudeBuddy.updateState().then(setUpd);
    return window.claudeBuddy.onUpdateState(setUpd);
  }, []);

  const check = () => {
    setSpin(true);
    void window.claudeBuddy.updateCheck();
    setTimeout(() => setSpin(false), 900);
  };

  const cur = info?.version ?? upd?.current ?? "—";
  const st = spin || upd?.state === "checking" ? "checking" : (upd?.state ?? "idle");
  const mb = (n?: number) => (n ? `${(n / 1048576).toFixed(0)} MB` : "");

  const view = (() => {
    switch (st) {
      case "checking":
        return { title: tr("正在和发布源核对", "Talking to the update feed"), sub: tr("检查完会告诉你有没有新版", "We'll tell you if there's a newer build"), bar: "indet" as const, btn: null };
      case "available":
        return {
          title: tr(`发现新版 ${upd?.latest ?? ""}`, `${upd?.latest ?? ""} is available`),
          sub: tr("下载完选择重启即可换上，会话不受影响", "Download, then restart — sessions are not affected"),
          bar: null,
          btn: { label: tr("下载更新", "Download"), pri: true, run: () => void window.claudeBuddy.updateDownload() },
        };
      case "downloading":
        return {
          title: tr(`正在下载 ${upd?.latest ?? ""}`, `Downloading ${upd?.latest ?? ""}`),
          sub: upd?.total ? `${upd.percent}% · ${mb(upd.transferred)} / ${mb(upd.total)}` : `${upd?.percent ?? 0}%`,
          bar: { pct: upd?.percent ?? 0 },
          btn: null,
        };
      case "ready":
        return {
          title: tr(`${upd?.latest ?? ""} 已下载`, `${upd?.latest ?? ""} downloaded`),
          sub: tr("重启后生效，会话会保留", "Takes effect after restart; sessions are kept"),
          bar: { pct: 100 },
          btn: { label: tr("重启并安装", "Restart and install"), pri: true, run: () => void window.claudeBuddy.updateInstall() },
        };
      case "error":
        return {
          title: tr("没查成功", "Check failed"),
          sub: (upd?.error || "").split("\n")[0].slice(0, 120),
          bar: null,
          btn: { label: tr("重试", "Retry"), pri: false, run: check },
        };
      case "latest":
        return {
          title: tr("已是最新版本", "You're up to date"),
          sub: tr("有新版本时这里会出现「下载」", "A Download button appears here when there is one"),
          bar: null,
          btn: { label: tr("再查一次", "Check again"), pri: false, run: check },
        };
      default:
        return {
          title: tr("自动更新", "Automatic updates"),
          sub: upd?.enabled === false ? tr("这个包没有发布源，无法检查更新", "This build has no update feed") : tr("点一下检查有没有新版", "Check for a newer build"),
          bar: null,
          btn: { label: tr("检查更新", "Check for updates"), pri: false, run: check, disabled: upd?.enabled === false },
        };
    }
  })();

  const pill =
    st === "latest"
      ? { cls: " ok", text: tr("最新", "Latest") }
      : st === "available" || st === "downloading" || st === "ready"
        ? { cls: " new", text: tr("有新版", "New") }
        : st === "error"
          ? { cls: " bad", text: tr("失败", "Failed") }
          : { cls: "", text: tr("检查中", "Checking") };

  const facts: { k: string; v: string; mono?: boolean }[] = [
    { k: tr("发布渠道", "Channel"), v: "dl.mkstore.life/claudebuddy", mono: true },
    { k: tr("安装包", "Artifacts"), v: tr("DMG · ZIP（原地更新用 ZIP）", "DMG · ZIP (in-place updates use the zip)") },
    { k: tr("检查方式", "Check"), v: tr("手动，不会在后台偷偷查", "Manual — never checked behind your back") },
  ];

  return (
    <>
      <div className="wh" />
      <div className="sv">
        <div className="sv-h">
          <div>
            <h1>{tr("更新", "Updates")}</h1>
            <p>{tr("检查、下载、重启安装，都在这一页", "Check, download and install from here")}</p>
          </div>
          <div className="pg-acts">
            <Help title={tr("怎么更新的？", "How updates work")} wide>
              <p>
                {tr(
                  "macOS 的原地更新用的是 zip，不是 DMG：DMG 是给人拖进 Applications 的，替换不了正在运行的应用。所以每次发版都会同时出 dmg 和 zip。",
                  "In-place updates on macOS use the zip, not the DMG: the DMG is for dragging into Applications and cannot replace a running app. So every release ships both.",
                )}
              </p>
              <p>
                {tr(
                  "下载是你点的，不会偷偷下。装完会话不受影响 —— 重启只换程序本身。",
                  "Downloads only start when you ask. Installing does not affect sessions; the restart only swaps the app.",
                )}
              </p>
            </Help>
          </div>
        </div>

        <div className="upd">
          <div className="upd-hero">
            <div className="upd-art">
              <img src="./assets/app-icon.png" alt="" />
            </div>
            <div className="upd-main">
              <div className="upd-top">
                <span className="upd-ver">{cur}</span>
                <span className={`upd-pill${pill.cls}`}>{pill.text}</span>
              </div>
              <div className="upd-t">{view.title}</div>
              {view.sub && <div className="upd-s">{view.sub}</div>}

              {view.bar && (
                <div className="upd-bar-wrap">
                  <div className={`upd-bar${view.bar === "indet" ? " indet" : ""}`}>
                    <i style={view.bar !== "indet" ? { width: `${view.bar.pct}%` } : undefined} />
                  </div>
                </div>
              )}

              <div className="upd-acts">
                {view.btn && (
                  <button className={`btn${view.btn.pri ? " pri" : ""}`} onClick={view.btn.run} disabled={Boolean(view.btn.disabled)}>
                    {view.btn.label}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="upd-facts">
            {facts.map((f) => (
              <div className="upd-fact" key={f.k}>
                <span className="upd-fk">{f.k}</span>
                <span className={`upd-fv${f.mono ? " mono" : ""}`}>{f.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
