import { useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../lib/i18n";
import type { ProxyMode } from "../lib/model";
import Modal from "./Modal";
import { IconChevronDown, IconCopy } from "./iconAliases";

/**
 * 出口指导 —— 按**当前代理方式**给不同的教程。
 *
 * 之前这里只有一套：4 步教你去代理配置里加 listeners。那对「用你自己的代理」
 * 是对的，但对「App 托管」完全是误导 —— 托管已经自己起了实例、自己开了端口，
 * 用户点开指导却被教去改配置，等于让一个已经解决了问题的人再解决一遍。
 *
 * 所以按方式分流：
 *   managed → 讲清托管替你做了什么，你要做的只有"选个节点"
 *   own     → 保留 listeners 那套（那种确实要自己动手）
 *   direct  → 讲为什么该配出口
 */

type Art = "exit" | "port" | "listener" | "verify" | "managed";

type Step = {
  kicker: string;
  title: string;
  body: string;
  art: Art;
  code?: string;
  codeNote?: string;
};

/** 第一步所有方式共用：先讲清"出口"是什么 */
const STEP_WHAT_IS_EXIT: Step = {
  kicker: "1",
  title: tr("先弄清「出口」是什么", "First, what an exit is"),
  body: tr(
    "Claude 服务器看到的不是你的电脑，而是这条链路最后一跳的公网 IP，也就是「出口」。两个环境用同一个出口，在服务器看来就像同一台机器后面的两个身份。",
    "Claude's servers never see your machine — they see the public IP at the end of the chain, the exit. Two environments on one exit look like two identities behind the same machine.",
  ),
  art: "exit",
};

/** App 托管：3 步，重点讲"你不用做什么" */
const STEPS_MANAGED: Step[] = [
  STEP_WHAT_IS_EXIT,
  {
    kicker: "2",
    title: tr("托管替你做了什么", "What managed mode does for you"),
    body: tr(
      "App 自带一个 mihomo 内核。每选一个节点，它就在后台单起一个实例：独立目录、独立端口、只绑这一个节点。你的代理软件和系统代理都不受影响。",
      "The app bundles a mihomo kernel. For each node you pick, it starts a separate instance in the background — its own directory, its own port, bound to that one node. Your proxy app and system proxy are untouched.",
    ),
    art: "managed",
  },
  {
    kicker: "3",
    title: tr("你要做的只有选节点", "All you do is pick a node"),
    body: tr(
      "去「设置 · 网络」加一个订阅地址，或者导入一份本地 YAML。回到这里新建出口、选一个节点，实例起来后会自动测一次 IP 并显示「生效中」。没有配置要写，也没有东西要重启。",
      "Add a subscription URL in Settings → Network, or import a local YAML. Then create an exit here, pick a node, and once the instance is up it measures the IP automatically and shows Live. Nothing to write, nothing to restart.",
    ),
    art: "verify",
  },
];

/** 你自己的代理：4 步，保留 listeners 教程 */
const STEPS_OWN: Step[] = [
  STEP_WHAT_IS_EXIT,
  {
    kicker: "2",
    title: tr("一个端口，只有一个出口", "One port, one exit"),
    body: tr(
      "代理软件默认只开一个端口（比如 7890）。不管它后面挂了多少个节点，从这个端口出去的流量，最后都走同一个出口。所以两个环境填同一个端口，IP 必然相同。",
      "Your proxy opens a single port by default (7890, say). However many nodes sit behind it, traffic leaving that port ends up on the same exit. Two environments on one port always share an IP.",
    ),
    art: "port",
  },
  {
    kicker: "3",
    title: tr("给它开第二个端口", "Open a second port"),
    body: tr(
      "在代理配置里加一段 listeners，让它再监听一个端口，并绑定另一个节点或策略组。加完重启代理，两个端口就是两个出口。",
      "Add a listeners block to your proxy config so it listens on one more port, bound to a different node or group. Restart the proxy and the two ports become two exits.",
    ),
    art: "listener",
    code: `listeners:
  - name: claude-env-b
    type: mixed
    port: 7902
    proxy: "另一个节点名"`,
    codeNote: tr(
      "粘在配置文件的顶层（和 mixed-port 同级）；proxy 填你想用的节点名或策略组名",
      "Paste at the top level of the config (same level as mixed-port); proxy is the node or group name",
    ),
  },
  {
    kicker: "4",
    title: tr("填上端口，实测确认", "Point and verify"),
    body: tr(
      "回到这里，把新端口填给第二个环境，然后点「重新检测」。两个环境测出来是不同 IP，就成了；如果还是同一个，说明两个端口绑到了同一个节点。",
      "Come back, give the new port to the second environment, then hit Check again. Different IPs means it worked; the same IP means both ports are bound to one node.",
    ),
    art: "verify",
  },
];

/** 直连：讲清"为什么该配一个出口"，不教操作 */
const STEPS_DIRECT: Step[] = [
  STEP_WHAT_IS_EXIT,
  {
    kicker: "2",
    title: tr("直连意味着什么", "What direct means"),
    body: tr(
      "直连就是不过代理，用这台电脑当前的网络出去。能用，但所有环境共用同一个出口 IP —— 多个账号在服务器看来就是同一台机器。",
      "Direct means no proxy at all: this Mac's own network. It works, but every environment shares one exit IP — several accounts look like one machine.",
    ),
    art: "port",
  },
  {
    kicker: "3",
    title: tr("两条路，任选一条", "Two ways forward"),
    body: tr(
      "「App 托管」：加个订阅或导入 YAML，选节点就完事，不用碰你的配置。「你自己的代理」：你已经有独立端口的话，填进来就行。",
      "Managed: add a subscription or import a YAML, pick a node — nothing of yours to touch. Your own proxy: if you already have a separate port, just enter it.",
    ),
    art: "verify",
  },
];

function stepsFor(mode: ProxyMode): Step[] {
  if (mode === "managed") return STEPS_MANAGED;
  if (mode === "own") return STEPS_OWN;
  return STEPS_DIRECT;
}

/** 图示：纯 CSS 色块 + 文字，表达「流量最后去了哪」，不引图片 */
function Figure({ kind }: { kind: Art }) {
  if (kind === "exit") {
    return (
      <div className="gx-fig">
        <div className="gx-col">
          <span className="gx-pill">
            <i className="gx-dot a" />
            {tr("环境 A", "Env A")}
          </span>
          <span className="gx-pill">
            <i className="gx-dot b" />
            {tr("环境 B", "Env B")}
          </span>
        </div>
        <span className="gx-link" aria-hidden />
        <div className="gx-box">
          <b className="mono">185.x.x.x</b>
          <small>{tr("同一个出口", "Same exit")}</small>
        </div>
      </div>
    );
  }

  if (kind === "port") {
    return (
      <div className="gx-fig col">
        <div className="gx-box wide">
          <b className="mono">:7890</b>
          <small>{tr("唯一的入口", "The only entry")}</small>
        </div>
        <div className="gx-fan">
          <span>{tr("节点 1", "Node 1")}</span>
          <span>{tr("节点 2", "Node 2")}</span>
          <span>{tr("节点 3", "Node 3")}</span>
        </div>
        <small className="gx-note">{tr("节点再多，出口仍是同一个", "More nodes, still one exit")}</small>
      </div>
    );
  }

  if (kind === "listener") {
    return (
      <div className="gx-fig col">
        <div className="gx-pair">
          <div className="gx-box">
            <b className="mono">:7890</b>
            <small className="mono">185.x</small>
          </div>
          <div className="gx-box on">
            <b className="mono">:7902</b>
            <small className="mono">172.x</small>
          </div>
        </div>
        <small className="gx-note">{tr("两个端口 → 两个出口", "Two ports, two exits")}</small>
      </div>
    );
  }

  if (kind === "managed") {
    return (
      <div className="gx-fig col">
        <div className="gx-row">
          <i className="gx-dot ok" />
          <span>{tr("环境 A", "Env A")}</span>
          <b className="mono gx-ip">:7950</b>
        </div>
        <div className="gx-row">
          <i className="gx-dot ok" />
          <span>{tr("环境 B", "Env B")}</span>
          <b className="mono gx-ip">:7951</b>
        </div>
        <small className="gx-note">
          {tr("每个节点一个实例，端口由 App 分配", "One instance per node; ports assigned by the app")}
        </small>
      </div>
    );
  }

  return (
    <div className="gx-fig col">
      <div className="gx-row">
        <i className="gx-dot ok" />
        <span>{tr("环境 A", "Env A")}</span>
        <b className="mono gx-ip">185.x</b>
      </div>
      <div className="gx-row">
        <i className="gx-dot ok" />
        <span>{tr("环境 B", "Env B")}</span>
        <b className="mono gx-ip">172.x</b>
      </div>
      <small className="gx-note">{tr("两个不同 IP，成了", "Two IPs — done")}</small>
    </div>
  );
}

export default function ExitGuide({ onClose, mode = "own" }: { onClose: () => void; mode?: ProxyMode }) {
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  const steps = stepsFor(mode);
  const step = steps[i];
  const last = i === steps.length - 1;

  /**
   * 挂到 body 上，而不是留在调用它的位置。
   *
   * 这个弹窗是从「环境详情抽屉」里打开的，而抽屉自己也是一层 Modal：
   * 它的 .dlg 带着 animation ... both，动画结束后仍保留 transform，
   * 于是形成包含块 —— 里面任何 position:fixed 都只相对抽屉定位，
   * 遮罩盖不住整窗，抽屉还亮在外面，看着像"弹窗被框住了"。
   * portal 把它挪出那棵子树，fixed 才回到视口。
   */
  return createPortal(
    <Modal onClose={onClose} className="gx" label={tr("出口怎么配", "How exits work")}>
      {(close) => (
        <>
          <div className="gx-head">
            <span className="gx-kicker">
              {step.kicker} / {steps.length} · {tr("出口怎么配", "How exits work")}
            </span>
          </div>

          <div className="gx-body">
            <h3>{step.title}</h3>
            <p>{step.body}</p>

            <Figure kind={step.art} />

            {step.code && (
              <div className="gx-code">
                <div className="gx-code-h">
                  <span>{tr("加在你的代理配置里", "Add to your proxy config")}</span>
                  <button
                    className="det-k"
                    onClick={() => {
                      void navigator.clipboard.writeText(step.code ?? "");
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    <IconCopy size={11} />
                    {copied ? tr("已复制", "Copied") : tr("复制", "Copy")}
                  </button>
                </div>
                <pre>{step.code}</pre>
                {step.codeNote && <small>{step.codeNote}</small>}
              </div>
            )}
          </div>

          <div className="gx-foot">
            <span className="gx-dots">
              {steps.map((_, k) => (
                <button
                  key={k}
                  className={`gx-nav${k === i ? " on" : ""}`}
                  onClick={() => setI(k)}
                  aria-label={tr(`第 ${k + 1} 步`, `Step ${k + 1}`)}
                />
              ))}
            </span>
            <span className="gx-acts">
              {i > 0 && (
                <button className="btn ghost" onClick={() => setI(i - 1)}>
                  {tr("上一步", "Back")}
                </button>
              )}
              <button className="btn pri" onClick={() => (last ? close() : setI(i + 1))}>
                {last ? tr("知道了", "Got it") : tr("下一步", "Next")}
                {!last && <IconChevronDown size={11} className="gx-next" />}
              </button>
            </span>
          </div>
        </>
      )}
    </Modal>,
    document.body,
  );
}
