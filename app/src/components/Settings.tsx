import { useState } from "react";
import type { BuddyState as ShellState, ThemeMode } from "../lib/model";
import { RHYTHM_THRESHOLDS } from "../lib/model";
import {
  IconChevronDown,
  IconClose,
  IconPlus,
  IconSettings,
  IconSun,
  IconTerminal,
  IconAccounts,
  IconPulse,
  IconGrid,
  IconInfo,
  IconGlobe,
} from "./iconAliases";
import Art from "./Art";
import Diagnose from "./Diagnose";

interface Props {
  state: ShellState;
  update: (patch: Partial<ShellState>) => void;
  onClose: () => void;
  onAddAccount: () => void;
}

type Cat = "general" | "appearance" | "terminal" | "accounts" | "rhythm" | "diagnose" | "keys" | "about";

/** 每个分类一个图标：跟左侧主导航同一套「图标 + 名字」读法，
 *  这样从侧栏进来到设置里，眼睛不用重新学一遍怎么认项。 */
type CatItem = { id: Cat; label: string; icon: typeof IconSettings };

/**
 * 分组，不平铺。
 *
 * 八项平排一列时，人得从头读到尾才知道自己要的那项在哪；
 * 分组之后是先定位组、再定位项，扫视路径短一半。分组标题不设交互，
 * 只做视觉上的段落。
 */
const GROUPS: { title: string; items: CatItem[] }[] = [
  {
    title: "常规",
    items: [
      { id: "general", label: "通用", icon: IconSettings },
      { id: "appearance", label: "外观", icon: IconSun },
      { id: "terminal", label: "终端", icon: IconTerminal },
      { id: "keys", label: "快捷键", icon: IconGrid },
    ],
  },
  {
    title: "环境",
    items: [
      { id: "accounts", label: "环境", icon: IconAccounts },
      { id: "diagnose", label: "体检", icon: IconGlobe },
      { id: "rhythm", label: "节奏看护", icon: IconPulse },
    ],
  },
  {
    title: "其他",
    items: [{ id: "about", label: "关于", icon: IconInfo }],
  },
];

/**
 * 设置页 —— 设计稿 11 · settings（样机 768–796）。
 *
 * 左边分类、右边一行一项：名称和说明在左，控件在右，跟 Claude Desktop 同构。
 * 同一组靠 56px 行高分开，组之间一条发丝线 + 衬线小标题。
 * 开关打开是墨色 —— 这一屏没有主操作，陶土不出现。
 */
export default function Settings({ state, update, onClose, onAddAccount }: Props) {
  const [cat, setCat] = useState<Cat>("appearance");

  return (
    <>
      <div className="wh">
        {/* 顶栏左侧留标题，跟其它页面同一套 48px 顶栏 —— 之前这里只有一个
            孤零零的关闭按钮贴在右上角，跟别处的顶栏不是一回事。 */}
        <span className="tt">设置</span>
        <span className="acts">
          <button className="ib" title="关闭设置 ⌘," onClick={onClose}>
            <IconClose />
          </button>
        </span>
      </div>
      <div className="st">
        <nav className="st-nav">
          {GROUPS.map((g) => (
            <div className="st-grp" key={g.title}>
              <span className="st-grp-t">{g.title}</span>
              {g.items.map((c) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    className={cat === c.id ? "on" : ""}
                    onClick={() => setCat(c.id)}
                  >
                    <Icon size={15} />
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* key={cat} 让内容在切换时重新挂载，动画才有东西可播 */}
        <div className="st-body" key={cat}>
          {cat === "appearance" && (
            <>
              <h1>外观</h1>
              <Row title="主题" desc="终端跟着主题换成同色系纸面 / 暖炭">
                <div className="seg">
                  {(["light", "dark", "system"] as ThemeMode[]).map((t) => (
                    <button
                      key={t}
                      className={state.theme === t ? "on" : ""}
                      onClick={() => update({ theme: t })}
                    >
                      {t === "light" ? "浅色" : t === "dark" ? "深色" : "跟随系统"}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="界面字号" desc="只影响侧栏和面板，不影响终端">
                <div className="seg">
                  {[
                    { v: 0.92, l: "小" },
                    { v: 1, l: "中" },
                    { v: 1.08, l: "大" },
                  ].map((o) => (
                    <button
                      key={o.l}
                      className={Math.abs(state.uiScale - o.v) < 0.01 ? "on" : ""}
                      onClick={() => update({ uiScale: o.v })}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </Row>

              <h2>终端</h2>
              <Row title="字体" desc="等宽字体，含中文回退">
                <span className="chip">
                  <span className="mono">JetBrains Mono · {state.terminalFontSize}</span>
                  <IconChevronDown size={11} />
                </span>
              </Row>
              <Row title="光标样式">
                <div className="seg">
                  {[
                    { v: "block" as const, l: "方块" },
                    { v: "bar" as const, l: "竖线" },
                    { v: "underline" as const, l: "下划线" },
                  ].map((o) => (
                    <button
                      key={o.v}
                      className={state.cursorStyle === o.v ? "on" : ""}
                      onClick={() => update({ cursorStyle: o.v })}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="光标闪烁">
                <button
                  className={`tg${state.cursorBlink ? " on" : ""}`}
                  onClick={() => update({ cursorBlink: !state.cursorBlink })}
                  aria-pressed={state.cursorBlink}
                />
              </Row>
              <Row title="选中即复制" desc="跟 iTerm2 的习惯一致">
                <button
                  className={`tg${state.copyOnSelect ? " on" : ""}`}
                  onClick={() => update({ copyOnSelect: !state.copyOnSelect })}
                  aria-pressed={state.copyOnSelect}
                />
              </Row>

              <div className="tip">
                <Art name="rhythm" />
                <div>
                  <b>节奏看护在"节奏看护"分类里</b>
                  <p>请求太密时在状态栏提醒你，默认阈值 {RHYTHM_THRESHOLDS.perMinuteHot} 次/分。</p>
                </div>
              </div>
            </>
          )}

          {cat === "terminal" && (
            <>
              <h1>终端</h1>
              <Row title="字号" desc="只影响终端里的等宽文本">
                <div className="seg">
                  {[12, 13, 14, 15].map((s) => (
                    <button
                      key={s}
                      className={state.terminalFontSize === s ? "on" : ""}
                      onClick={() => update({ terminalFontSize: s })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="光标样式">
                <div className="seg">
                  {[
                    { v: "block" as const, l: "方块" },
                    { v: "bar" as const, l: "竖线" },
                    { v: "underline" as const, l: "下划线" },
                  ].map((o) => (
                    <button
                      key={o.v}
                      className={state.cursorStyle === o.v ? "on" : ""}
                      onClick={() => update({ cursorStyle: o.v })}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="选中即复制" desc="跟 iTerm2 的习惯一致">
                <button
                  className={`tg${state.copyOnSelect ? " on" : ""}`}
                  onClick={() => update({ copyOnSelect: !state.copyOnSelect })}
                  aria-pressed={state.copyOnSelect}
                />
              </Row>
            </>
          )}

          {cat === "rhythm" && (
            <>
              <h1>节奏看护</h1>
              <Row title="启用节奏看护" desc="观察请求速率，偏快时提示，不打断输入">
                <button
                  className={`tg${state.rhythmGuard ? " on" : ""}`}
                  onClick={() => update({ rhythmGuard: !state.rhythmGuard })}
                  aria-pressed={state.rhythmGuard}
                />
              </Row>
              <Row title="阈值" desc="每分钟请求数超过它就标为“偏快”">
                <div className="seg">
                  {[6, 12, 18].map((n) => (
                    <button
                      key={n}
                      className={state.rhythmThreshold === n ? "on" : ""}
                      onClick={() => update({ rhythmThreshold: n })}
                    >
                      {n} 次/分
                    </button>
                  ))}
                </div>
              </Row>
              <h2>为什么是这些数</h2>
              <p style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.75, paddingTop: 12 }}>
                一次导致封号的会话是 10.4 小时 / 1168 次请求 / 1781 次工具调用，间隔中位数 6.7 秒。
                这组阈值不是官方限制（它在服务端，客户端看不到），而是“看起来不像人类交互”的经验边界。
              </p>
            </>
          )}

          {cat === "diagnose" && <Diagnose />}

          {cat === "general" && (
            <>
              <h1>通用</h1>
              <Row title="启动时恢复上次的会话" desc="关掉后每次打开都回到首页">
                <button
                  className={`tg${state.restoreSessions ? " on" : ""}`}
                  aria-pressed={state.restoreSessions}
                  onClick={() => update({ restoreSessions: !state.restoreSessions })}
                />
              </Row>
              <Row title="新手引导" desc="检查电脑 → 建环境登录 → 配网络，三步。不会动已有的环境和会话，随时能返回">
                <button className="btn" onClick={() => update({ onboarded: false })}>
                  重新开始
                </button>
              </Row>
            </>
          )}

          {cat === "accounts" && (
            <>
              <h1>环境</h1>
              <p style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.75, marginBottom: 8 }}>
                每个环境对应一份独立的 <code>~/.claude-*</code> 配置目录。登录、代理、痕迹清理在侧栏「环境」里点一行编辑。
              </p>
              {state.accounts.map((a) => (
                <Row key={a.id} title={a.label} desc={`~/${a.configDir}`}>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--t4)" }}>
                    {a.email ?? ""}
                  </span>
                </Row>
              ))}
              <Row title="新建环境" desc="自动建一个新的配置目录，建好直接登录">
                <button className="btn" onClick={onAddAccount}>
                  <IconPlus />
                  新建环境
                </button>
              </Row>
            </>
          )}

          {cat === "keys" && (
            <>
              <h1>快捷键</h1>
              {[
                ["⌘ N", "新建会话"],
                ["⌘ T", "在最后一个目录新建会话"],
                ["⌘ W", "关闭当前会话"],
                ["⌘ B", "折叠 / 展开检查器"],
                ["⌘ K", "命令面板"],
                ["⌘ ,", "设置"],
                ["⌘ D", "查看本次改动"],
              ].map(([k, d]) => (
                <Row key={k} title={d}>
                  <span className="kbd">{k}</span>
                </Row>
              ))}
            </>
          )}

          {cat === "about" && (
            <>
              <h1>关于</h1>
              <div style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 0 20px" }}>
                <img
                  src="./assets/app-icon.png"
                  alt="ClaudeBuddy"
                  style={{ width: 56, height: 56, borderRadius: 14, display: "block" }}
                />
                <div>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 22, letterSpacing: "-0.015em" }}>
                    ClaudeBuddy
                  </div>
                  <div style={{ fontSize: 12, color: "var(--t3)" }}>给 Claude Code 一个安静的家</div>
                </div>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.75 }}>
                每个账号一个独立配置目录，每个项目一个干净的终端。
                设计系统见 <code>docs/design-system.html</code>。
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** 设计稿 298：一行一项，名称和说明在左，控件在右 */
function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sr">
      <div style={{ minWidth: 0 }}>
        <b>{title}</b>
        {desc ? <small>{desc}</small> : null}
      </div>
      {children}
    </div>
  );
}
