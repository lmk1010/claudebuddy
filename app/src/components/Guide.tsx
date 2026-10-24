import { useEffect, useState, type ReactNode } from "react";
import StatusIcon, { type StatusTone } from "./StatusIcon";

/**
 * 使用教程 —— 一章一页，左右切换。
 *
 * 每一章固定讲四件事：它在哪、怎么配、每个结果 / 选项是什么意思、最省事的用法。
 * 结果说明直接用界面上的同款标签和颜色，用户对着屏幕就能认出来；
 * 每章底部「带我去」直接跳到那一页，看完就能动手。
 */

export type GuideTarget = "home" | "sessions" | "accounts" | "editNet" | "clean" | "net" | "keys" | "general";

type Tone = "ok" | "mid" | "bad" | "info" | "idle";
type Block =
  | { kind: "steps"; title?: string; items: ReactNode[] }
  | { kind: "legend"; title: string; rows: { tag: string; tone: Tone; text: ReactNode }[] }
  | { kind: "compare"; cols: { title: string; badge: string; items: string[] }[] }
  | { kind: "keys"; rows: [string, string][] }
  | { kind: "score"; rows: { label: string; tone: Tone; text: string }[] }
  | { kind: "note"; tone: Tone; text: ReactNode };

type Chapter = { id: string; short: string; kicker: string; title: string; lead: string; blocks: Block[]; go?: { label: string; to: GuideTarget } };

const CHAPTERS: Chapter[] = [
  {
    id: "start",
    short: "三分钟上手",
    kicker: "从零开始",
    title: "最快的配置：三步，三分钟",
    lead: "只有一个 Claude 账号、电脑上开着梯子？下面三步做完就能用，其他功能都可以以后再看。",
    blocks: [
      {
        kind: "steps",
        items: [
          <>左下角点账号行 →「编辑」→ 点 <b>登录</b>，浏览器里点授权，回来自动识别（不用复制粘贴任何东西）</>,
          <>还在编辑窗口，点左边 <b>网络出口</b> → <b>自动探测</b>，挑一个显示「能通」的点「用这个」。开的是全局 / TUN 模式就直接选 <b>直连</b></>,
          <>回首页，在输入框写一句话回车 —— 会话就在当前环境、当前目录里开起来了</>,
        ],
      },
      { kind: "note", tone: "info", text: "整个过程只需要点，不需要打开终端、不需要改任何配置文件。新手引导（设置 → 通用）走的就是这三步。" },
    ],
    go: { label: "去首页", to: "home" },
  },
  {
    id: "best",
    short: "最省事的配法",
    kicker: "长期使用",
    title: "最快 vs 最省事：两种配法怎么选",
    lead: "「最快」是今天就能用；「最省事」是多花五分钟，以后几个号长期并存也不会互相牵连、不用再操心。",
    blocks: [
      {
        kind: "compare",
        cols: [
          {
            title: "最快",
            badge: "3 分钟",
            items: ["只用「默认」环境", "出口选直连（靠梯子的全局 / TUN）", "适合：一个号、偶尔用"],
          },
          {
            title: "最省事（推荐）",
            badge: "8 分钟",
            items: [
              "一个账号建一个环境（环境页右上「新建环境」）",
              "每个环境用「自动探测」选各自的代理端口，出口互不相同",
              "出口体检里时区、语言点「对齐」",
              "以后开会话只要在首页点一下环境，其它全自动",
            ],
          },
        ],
      },
      { kind: "note", tone: "ok", text: "环境一旦配好就固定：登录、出口、指纹都跟着环境走，开会话时不用再选一遍。" },
    ],
    go: { label: "去环境页", to: "accounts" },
  },
  {
    id: "home",
    short: "首页",
    kicker: "开会话",
    title: "首页：选环境 → 写一句 → 回车",
    lead: "首页只做一件事：开新会话。上面选「在哪个环境开」，输入框下面三个按钮决定「在哪、怎么跑、走哪条线」。",
    blocks: [
      {
        kind: "legend",
        title: "环境切换条",
        rows: [
          { tag: "选中", tone: "ok", text: "新会话就开在这个环境里（登录、出口都用它的）" },
          { tag: "🔑 钥匙", tone: "mid", text: "这个环境还没登录，选中后输入框下面有「现在登录」" },
          { tag: "数字", tone: "info", text: "这个环境正在跑几个会话" },
        ],
      },
      {
        kind: "legend",
        title: "输入框下的三个按钮",
        rows: [
          { tag: "📁 目录", tone: "info", text: "点开是最近用过的目录，最下面「选择其他文件夹」" },
          { tag: "🛡 权限", tone: "info", text: "逐次确认（最稳）· 自动接受编辑（日常推荐）· 计划模式（只出方案不动手）· 全部放行（慎用）" },
          { tag: "🌐 出口", tone: "info", text: "当前环境的线路 + 信任分，比如「🇺🇸 100 纯净」，点开进网络出口" },
        ],
      },
      { kind: "note", tone: "info", text: "输入框可以留空直接回车 —— 只启动 Claude Code，不发第一句话。" },
    ],
    go: { label: "去首页", to: "home" },
  },
  {
    id: "sessions",
    short: "会话",
    kicker: "管会话",
    title: "会话：开着的、以前的，都在一页",
    lead: "「进行中」是现在开着终端的会话，「历史」是环境目录里留下的旧对话，点一下就在原目录接着干。",
    blocks: [
      {
        kind: "keys",
        rows: [
          ["单击", "切过去"],
          ["双击名字", "改名"],
          ["右键 / ⋯", "复制路径、在访达中打开、编辑所属环境、关闭这个环境全部会话"],
          ["中键页签", "关闭（会先确认）"],
          ["⌘T", "在当前环境 + 当前目录再开一个"],
          ["⌘W", "关闭当前会话"],
        ],
      },
      {
        kind: "legend",
        title: "行首图标",
        rows: [
          { tag: "橙色火花", tone: "info", text: "Claude Code 会话" },
          { tag: "终端图标", tone: "info", text: "普通终端（空白终端）" },
          { tag: "右下绿点", tone: "ok", text: "正在运行" },
          { tag: "时钟", tone: "idle", text: "历史会话，点一下接着开" },
        ],
      },
    ],
    go: { label: "去会话页", to: "sessions" },
  },
  {
    id: "env",
    short: "环境",
    kicker: "一个账号一个环境",
    title: "环境：登录、出口、指纹都跟着它",
    lead: "环境 = 一份独立的 Claude Code 配置目录。点环境页的一行打开编辑窗口，左边五项按顺序配就行。",
    blocks: [
      {
        kind: "legend",
        title: "编辑窗口的五项",
        rows: [
          { tag: "通用", tone: "info", text: "名字、标识色、登录 / 退出。顶部的「把这个环境配好」做完会自动消失" },
          { tag: "网络出口", tone: "info", text: "出口体检 + 选线路（下一章细讲）" },
          { tag: "设备指纹", tone: "info", text: "设备 ID、终端类型、语言、时区。新环境本来就各不相同，一般不用动" },
          { tag: "历史会话", tone: "info", text: "这个环境跑过的会话，点一条接着开" },
          { tag: "清理", tone: "mid", text: "这个环境在磁盘 / Keychain 的痕迹，以及删除环境" },
        ],
      },
      {
        kind: "legend",
        title: "登录状态",
        rows: [
          { tag: "已登录", tone: "ok", text: "凭据在 Keychain，可以直接开会话" },
          { tag: "未登录", tone: "idle", text: "从没登录过；或写着「上次登录的是 xxx」= 凭据丢了，点重新登录" },
          { tag: "挂起", tone: "bad", text: "账号被风控挂起，换本地凭据绕不过去" },
        ],
      },
    ],
    go: { label: "去环境页", to: "accounts" },
  },
  {
    id: "exit",
    short: "出口体检",
    kicker: "Claude 眼里的你",
    title: "出口体检：这个环境从哪出去、干不干净",
    lead: "进「网络出口」自动测，走的就是这个环境的线路，看到的 IP 跟真实会话一模一样。",
    blocks: [
      {
        kind: "score",
        rows: [
          { label: "75–100 纯净", tone: "ok", text: "放心用" },
          { label: "50–74 一般", tone: "mid", text: "能用，长期用建议换住宅线路" },
          { label: "0–49 高危", tone: "bad", text: "被标记成代理 / VPN，或风险分很高，尽快换出口" },
        ],
      },
      {
        kind: "legend",
        title: "三栏怎么看",
        rows: [
          { tag: "Claude 看到的", tone: "info", text: "地区是否在服务区、claude.ai 和 API 延迟、官方服务状态" },
          { tag: "IP 属性", tone: "info", text: "proxycheck 和 ip-api 两个来源各说各的，照实列出；住宅 / 移动最好，机房一般，代理标记最差" },
          { tag: "一致性", tone: "mid", text: "环境的时区、语言跟出口所在地对不上就显示「不一致」，点「对齐」一键改好" },
        ],
      },
      { kind: "note", tone: "info", text: "信任分是按公开数据估的，不是 Anthropic 的内部分数。要更细的评分，卡片右下「更多评分」跳第三方站点。" },
    ],
    go: { label: "去网络出口", to: "editNet" },
  },
  {
    id: "net",
    short: "网络测试",
    kicker: "线路本身",
    title: "网络测试：慢、断、连不上，卡在哪一段",
    lead: "设置 → 网络测试。选一条线路点开始，Claude Code 会连的 5 个域名逐个测，每段耗时拆开给你看。",
    blocks: [
      {
        kind: "legend",
        title: "耗时条的四段",
        rows: [
          { tag: "DNS", tone: "info", text: "域名查地址。几十毫秒以上说明 DNS 慢" },
          { tag: "TCP", tone: "info", text: "建立连接。接近 0 = 被本机代理（TUN）接管，正常" },
          { tag: "TLS", tone: "info", text: "加密握手，通常最长的一段，反映到代理节点的距离" },
          { tag: "首字节", tone: "info", text: "服务器开始回话。这段长 = 远端慢" },
        ],
      },
      {
        kind: "legend",
        title: "其他结果",
        rows: [
          { tag: "抖动", tone: "mid", text: "相邻两次的差。超过 ±400ms 流式输出会一顿一顿" },
          { tag: "失败率", tone: "bad", text: "大于 0 就是线路不稳，长任务容易中途断" },
          { tag: "HTTP 404", tone: "ok", text: "只看有没有到达服务器，API 根路径回 404 是正常的" },
          { tag: "fake-ip", tone: "ok", text: "代理软件的假地址，正常；「被劫持」（解析到内网）才有问题" },
          { tag: "IPv6 不一致", tone: "mid", text: "IPv6 从别处出去，可能绕开代理。代理里开 IPv6 接管或关掉系统 IPv6" },
        ],
      },
      { kind: "note", tone: "info", text: "页面最下面「403 卡在哪一层」：逐层查出口 → Cloudflare 挑战 → 账号 → 额度，哪层不通先处理哪层。" },
    ],
    go: { label: "去网络测试", to: "net" },
  },
  {
    id: "clean",
    short: "清理本机",
    kicker: "从零开始前",
    title: "清理本机：把旧登录痕迹清干净",
    lead: "设置 → 清理本机。列出这台电脑上所有 Claude Code 配置目录（包括别的工具建的）和没人认领的凭据。",
    blocks: [
      {
        kind: "legend",
        title: "状态",
        rows: [
          { tag: "空壳", tone: "bad", text: "没凭据也没对话，放心清" },
          { tag: "无人认领", tone: "mid", text: "Keychain 里有凭据但没目录用它，放心清" },
          { tag: "掉登录", tone: "mid", text: "凭据没了但对话还在，重新登录就能救回，别急着清" },
          { tag: "正常", tone: "ok", text: "登录着的号，清了会掉登录" },
          { tag: "有会话在跑", tone: "bad", text: "清它会让正在跑的会话立刻掉登录，先关会话" },
        ],
      },
      {
        kind: "steps",
        title: "最省事的清法",
        items: ["点上面「建议清理」筛选", "表头勾「全选」", "右上「清理所选」，确认框里会逐项写清后果"],
      },
      { kind: "note", tone: "info", text: "目录移到 ~/.claude-buddy-trash，清错了能捞回；Keychain 凭据删了不可恢复。默认目录 ~/.claude 永远不会被挪走，只能清它的凭据。" },
    ],
    go: { label: "去清理本机", to: "clean" },
  },
  {
    id: "keys",
    short: "快捷键",
    kicker: "顺手",
    title: "快捷键和小动作",
    lead: "常用操作都有键盘入口，⌘K 能搜到所有页面和环境。",
    blocks: [
      {
        kind: "keys",
        rows: [
          ["⌘K", "命令面板：搜会话、切环境、跳任意设置页"],
          ["⌘N", "回首页新建会话"],
          ["⌘T", "在当前环境和目录再开一个"],
          ["⌘W", "关闭当前会话"],
          ["⌘B", "展开 / 收起右栏"],
          ["⌘\\", "展开 / 收起侧栏"],
          ["⌘,", "进 / 出设置（Esc 也能退出）"],
          ["右键", "会话、页签、环境、侧栏最近会话都有右键菜单"],
        ],
      },
    ],
    go: { label: "看全部快捷键", to: "keys" },
  },
  {
    id: "ease",
    short: "好不好用",
    kicker: "实话实说",
    title: "现在用起来有多方便",
    lead: "按「从装好到开第一个会话」算，以及日常使用时要动几下。",
    blocks: [
      {
        kind: "legend",
        title: "已经做到的",
        rows: [
          { tag: "3 步", tone: "ok", text: "从装好到开第一个会话：登录 → 选出口 → 回车，全程不用碰终端和配置文件" },
          { tag: "1 下", tone: "ok", text: "日常开会话：首页点环境、回车。环境的登录、出口、指纹自动带上" },
          { tag: "自动", tone: "ok", text: "代理端口自动探测、出口自动体检、时区语言一键对齐、清理按状态自动建议" },
          { tag: "随处", tone: "ok", text: "右键菜单、⌘K、Esc 返回，几乎每个对象都能就地操作" },
        ],
      },
      {
        kind: "legend",
        title: "还需要你自己做的",
        rows: [
          { tag: "代理软件", tone: "mid", text: "我们只读取、测试代理，不替你买节点或切节点；换节点要回代理软件里操作" },
          { tag: "浏览器授权", tone: "mid", text: "登录必须在浏览器里点一次授权，这是 Claude 官方流程" },
          { tag: "IPv6", tone: "mid", text: "测出 IPv6 有问题时，要在代理软件或系统设置里改，我们只负责告诉你" },
        ],
      },
    ],
    go: { label: "回首页开始用", to: "home" },
  },
];

export default function Guide({ onGo }: { onGo: (to: GuideTarget) => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<"next" | "prev">("next");
  const ch = CHAPTERS[i];

  const to = (n: number) => {
    if (n < 0 || n >= CHAPTERS.length || n === i) return;
    setDir(n > i ? "next" : "prev");
    setI(n);
  };

  // 章节条放不下时，当前章自动滚进视野
  useEffect(() => {
    document.querySelector(".gd-tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [i]);

  // ← → 翻页；焦点在输入框里时不抢
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") to(i + 1);
      if (e.key === "ArrowLeft") to(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="gd">
      <div className="gd-h">
        <h1>使用教程</h1>
        <p>一章一页，← → 键或下面的按钮翻页。每章最后有「带我去」，看完直接动手。</p>
      </div>

      <div className="gd-tabs" role="tablist">
        {CHAPTERS.map((c, k) => (
          <button key={c.id} role="tab" aria-selected={k === i} className={`gd-tab${k === i ? " on" : ""}${k < i ? " done" : ""}`} onClick={() => to(k)}>
            <span className="gd-tab-n">{k + 1}</span>
            {c.short}
          </button>
        ))}
      </div>

      <article className="gd-card" key={ch.id} data-dir={dir}>
        <span className="gd-kicker">
          {i + 1} / {CHAPTERS.length} · {ch.kicker}
        </span>
        <h2>{ch.title}</h2>
        <p className="gd-lead">{ch.lead}</p>

        {ch.blocks.map((b, k) => (
          <BlockView key={k} b={b} />
        ))}
      </article>

      <div className="gd-nav">
        <button className="btn" onClick={() => to(i - 1)} disabled={i === 0}>
          ← 上一章
        </button>
        <div className="gd-dots">
          {CHAPTERS.map((c, k) => (
            <button key={c.id} className={k === i ? "on" : ""} onClick={() => to(k)} aria-label={c.short} />
          ))}
        </div>
        <div className="gd-nav-r">
          {ch.go && (
            <button className="btn" onClick={() => onGo(ch.go!.to)}>
              {ch.go.label} ↗
            </button>
          )}
          <button className="btn pri" onClick={() => to(i + 1)} disabled={i === CHAPTERS.length - 1}>
            下一章 →
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.kind === "steps")
    return (
      <div className="gd-blk">
        {b.title && <h3>{b.title}</h3>}
        <ol className="gd-steps">
          {b.items.map((it, k) => (
            <li key={k}>
              <span>{k + 1}</span>
              <div>{it}</div>
            </li>
          ))}
        </ol>
      </div>
    );
  if (b.kind === "legend")
    return (
      <div className="gd-blk">
        <h3>{b.title}</h3>
        <div className="gd-legend">
          {b.rows.map((r) => (
            <div key={r.tag} className="gd-lr">
              <span className={`nr-tag ${r.tone === "info" || r.tone === "idle" ? "" : r.tone} gd-tag`}>{r.tag}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  if (b.kind === "compare")
    return (
      <div className="gd-blk gd-cmp">
        {b.cols.map((c, k) => (
          <div key={c.title} className={`gd-col${k === 1 ? " rec" : ""}`}>
            <div className="gd-col-h">
              <b>{c.title}</b>
              <span className="nr-tag ok">{c.badge}</span>
            </div>
            <ul>
              {c.items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  if (b.kind === "keys")
    return (
      <div className="gd-blk gd-keys">
        {b.rows.map(([k, v]) => (
          <div key={k} className="gd-kr">
            <span className="kbd">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    );
  if (b.kind === "score")
    return (
      <div className="gd-blk gd-score">
        {b.rows.map((r) => (
          <div key={r.label} className={`gd-sc ${r.tone}`}>
            <StatusIcon tone={r.tone as StatusTone} size={22} />
            <b>{r.label}</b>
            <span>{r.text}</span>
          </div>
        ))}
      </div>
    );
  return (
    <div className={`gd-note ${b.tone}`}>
      <StatusIcon tone={b.tone as StatusTone} size={20} />
      <span>{b.text}</span>
    </div>
  );
}
