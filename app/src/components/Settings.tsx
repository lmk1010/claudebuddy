import { useState, type ReactNode } from "react";
import type { BuddyState as ShellState, ThemeMode } from "../lib/model";
import {
  IconClose,
  IconSettings,
  IconSun,
  IconTerminal,
  IconGrid,
  IconInfo,
  IconGlobe,
  IconTrash,
} from "./iconAliases";
import Diagnose from "./Diagnose";
import Help from "./Help";

interface Props {
  state: ShellState;
  update: (patch: Partial<ShellState>) => void;
  onClose: () => void;
  initialCat?: SettingsCat;
}

export type SettingsCat = "general" | "appearance" | "terminal" | "keys" | "clean" | "net" | "about";

type CatItem = { id: SettingsCat; label: string; icon: typeof IconSettings };

/**
 * 设置只放「跟环境无关」的东西 —— 这台电脑、这个应用怎么用。
 *
 * 跟某个环境有关的（登录、出口、指纹、这个环境的痕迹）一律在「环境」里点开编辑，
 * 这里不再复制一份环境列表：两处都能改同一件事，用户就不知道该去哪改。
 *
 *   常规：通用（启动、节奏看护、引导）· 外观 · 终端 · 快捷键
 *   本机：清理本机（所有 Claude Code 配置目录和 Keychain 凭据）· 连通诊断
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
    title: "本机",
    items: [
      { id: "clean", label: "清理本机", icon: IconTrash },
      { id: "net", label: "连通诊断", icon: IconGlobe },
    ],
  },
  {
    title: "其他",
    items: [{ id: "about", label: "关于", icon: IconInfo }],
  },
];

/**
 * 设置页 —— 左边分类、右边一行一项：名称和说明在左，控件在右，跟 Claude Desktop 同构。
 * 开关打开是墨色 —— 这一屏没有主操作，陶土不出现。
 */
export default function Settings({ state, update, onClose, initialCat }: Props) {
  const [cat, setCat] = useState<SettingsCat>(initialCat ?? "general");

  return (
    <>
      <div className="wh">
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
                  <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)}>
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
          {cat === "general" && (
            <>
              <h1>通用</h1>
              <Row title="启动时恢复上次的会话" desc="关掉后每次打开都回到首页">
                <Toggle on={state.restoreSessions} onChange={(v) => update({ restoreSessions: v })} />
              </Row>
              <Row
                title="节奏看护"
                desc="请求太密时在状态栏提醒你，不打断输入"
                tip={
                  <Help title="为什么要看节奏？">
                    <p>一次导致封号的会话是 10.4 小时 / 1168 次请求，间隔中位数 6.7 秒。</p>
                    <p>阈值不是官方限制（那在服务端，看不到），而是「看起来不像人在用」的经验边界。</p>
                  </Help>
                }
              >
                <Toggle on={state.rhythmGuard} onChange={(v) => update({ rhythmGuard: v })} />
              </Row>
              {state.rhythmGuard && (
                <Row title="提醒阈值" desc="每分钟请求数超过它就标为「偏快」">
                  <Seg
                    value={state.rhythmThreshold}
                    options={[6, 12, 18].map((n) => ({ v: n, l: `${n} 次/分` }))}
                    onChange={(v) => update({ rhythmThreshold: v })}
                  />
                </Row>
              )}
              <Row title="新手引导" desc="检查电脑 → 建环境登录 → 配网络。不会动已有的环境和会话，随时能返回">
                <button className="btn" onClick={() => update({ onboarded: false })}>
                  重新开始
                </button>
              </Row>
            </>
          )}

          {cat === "appearance" && (
            <>
              <h1>外观</h1>
              <Row title="主题" desc="终端跟着主题换成同色系纸面 / 暖炭">
                <Seg
                  value={state.theme}
                  options={(["light", "dark", "system"] as ThemeMode[]).map((t) => ({
                    v: t,
                    l: t === "light" ? "浅色" : t === "dark" ? "深色" : "跟随系统",
                  }))}
                  onChange={(v) => update({ theme: v })}
                />
              </Row>
              <Row title="界面字号" desc="只影响侧栏和面板，不影响终端">
                <Seg
                  value={[0.92, 1, 1.08].find((v) => Math.abs(state.uiScale - v) < 0.01) ?? 1}
                  options={[
                    { v: 0.92, l: "小" },
                    { v: 1, l: "中" },
                    { v: 1.08, l: "大" },
                  ]}
                  onChange={(v) => update({ uiScale: v })}
                />
              </Row>
            </>
          )}

          {cat === "terminal" && (
            <>
              <h1>终端</h1>
              <Row title="字号" desc="只影响终端里的等宽文本">
                <Seg
                  value={state.terminalFontSize}
                  options={[12, 13, 14, 15].map((s) => ({ v: s, l: String(s) }))}
                  onChange={(v) => update({ terminalFontSize: v })}
                />
              </Row>
              <Row title="光标样式">
                <Seg
                  value={state.cursorStyle}
                  options={[
                    { v: "block" as const, l: "方块" },
                    { v: "bar" as const, l: "竖线" },
                    { v: "underline" as const, l: "下划线" },
                  ]}
                  onChange={(v) => update({ cursorStyle: v })}
                />
              </Row>
              <Row title="光标闪烁">
                <Toggle on={state.cursorBlink} onChange={(v) => update({ cursorBlink: v })} />
              </Row>
              <Row title="选中即复制" desc="跟 iTerm2 的习惯一致">
                <Toggle on={state.copyOnSelect} onChange={(v) => update({ copyOnSelect: v })} />
              </Row>
            </>
          )}

          {cat === "keys" && (
            <>
              <h1>快捷键</h1>
              {[
                ["⌘ N", "回首页新建会话"],
                ["⌘ T", "在当前环境和目录再开一个"],
                ["⌘ W", "关闭当前会话"],
                ["⌘ B", "展开 / 收起右栏"],
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

          {cat === "clean" && <Diagnose part="clean" />}
          {cat === "net" && <Diagnose part="net" />}

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
                  <div style={{ fontFamily: "var(--serif)", fontSize: 22, letterSpacing: "-0.015em" }}>ClaudeBuddy</div>
                  <div style={{ fontSize: 12, color: "var(--t3)" }}>给 Claude Code 一个安静的家</div>
                </div>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.75 }}>
                每个账号一个独立环境，每个项目一个干净的终端。
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ title, desc, tip, children }: { title: string; desc?: string; tip?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sr">
      <div style={{ minWidth: 0 }}>
        <b>
          {title}
          {tip}
        </b>
        {desc ? <small>{desc}</small> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`tg${on ? " on" : ""}`} aria-pressed={on} onClick={() => onChange(!on)} />;
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; l: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}
