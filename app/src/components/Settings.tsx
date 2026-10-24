import type { ReactNode } from "react";
import type { BuddyState as ShellState, ThemeMode } from "../lib/model";
import {
  IconSettings,
  IconSun,
  IconTerminal,
  IconGrid,
  IconInfo,
  IconTrash,
  IconFile,
  IconRefresh,
} from "./iconAliases";
import Help from "./Help";
import About from "./About";
import UpdatePage from "./UpdatePage";
import { systemLang, tr } from "../lib/i18n";

interface Props {
  state: ShellState;
  update: (patch: Partial<ShellState>) => void;
  /** 分类在左侧边栏里选（跟 Claude Desktop 一样整窗换成设置），这里只画内容 */
  cat: SettingsCat;
}

export type SettingsCat = "general" | "appearance" | "terminal" | "keys" | "clean" | "guide" | "update" | "about";

export type CatItem = { id: SettingsCat; label: string; icon: typeof IconSettings };

/**
 * 设置只放「跟环境无关」的东西 —— 这台电脑、这个应用怎么用。
 *
 * 跟某个环境有关的（登录、出口、指纹、这个环境的痕迹）一律在「环境」里点开编辑，
 * 这里不再复制一份环境列表：两处都能改同一件事，用户就不知道该去哪改。
 *
 *   常规：通用（启动、节奏看护、引导）· 外观 · 终端 · 快捷键
 *   本机：清理本机（所有 Claude Code 配置目录和 Keychain 凭据）· 网络测试
 */
export const SETTINGS_GROUPS: { title: string; items: CatItem[] }[] = [
  {
    get title() { return tr("常规", "General"); },
    items: [
      { id: "general", get label() { return tr("通用", "General"); }, icon: IconSettings },
      { id: "appearance", get label() { return tr("外观", "Appearance"); }, icon: IconSun },
      { id: "terminal", get label() { return tr("终端", "Terminal"); }, icon: IconTerminal },
      { id: "keys", get label() { return tr("快捷键", "Shortcuts"); }, icon: IconGrid },
    ],
  },
  {
    get title() { return tr("本机", "This Mac"); },
    items: [
      { id: "clean", get label() { return tr("清理本机", "Clean up this Mac"); }, icon: IconTrash },
    ],
  },
  {
    get title() { return tr("其他", "Other"); },
    items: [
      { id: "guide", get label() { return tr("使用教程", "Guide"); }, icon: IconFile },
      { id: "update", get label() { return tr("更新", "Updates"); }, icon: IconRefresh },
      { id: "about", get label() { return tr("关于", "About"); }, icon: IconInfo },
    ],
  },
];

/**
 * 设置页 —— 左边分类、右边一行一项：名称和说明在左，控件在右，跟 Claude Desktop 同构。
 * 开关打开是墨色 —— 这一屏没有主操作，陶土不出现。
 */
export default function Settings({ state, update, cat }: Props) {
  return (
    <>
      <div className="wh" />
      <div className="st st-solo">
        {/* key={cat} 让内容在切换时重新挂载，动画才有东西可播 */}
        <div className="st-body" key={cat}>
          {cat === "general" && (
            <>
              <h1>{tr("通用", "General")}</h1>
              <Row title="语言 / Language" desc={tr("界面文字的语言，立即生效", "Interface language, applies instantly")}>
                <Seg
                  value={state.lang ?? systemLang()}
                  options={[
                    { v: "zh" as const, l: "中文" },
                    { v: "en" as const, l: "English" },
                  ]}
                  onChange={(v) => update({ lang: v })}
                />
              </Row>
              <Row title={tr("启动时恢复上次的会话", "Restore last sessions on launch")} desc={tr("关掉后每次打开都回到首页", "When off, the app always opens on the home page")}>
                <Toggle on={state.restoreSessions} onChange={(v) => update({ restoreSessions: v })} />
              </Row>
              <Row
                title={tr("节奏看护", "Pace guard")}
                desc={tr("请求太密时在状态栏提醒你，不打断输入", "Warns in the status bar when requests come too fast, without interrupting typing")}
                tip={
                  <Help title={tr("为什么要看节奏？", "Why watch the pace?")}>
                    <p>{tr("一次导致封号的会话是 10.4 小时 / 1168 次请求，间隔中位数 6.7 秒。", "One session that led to a ban ran 10.4 hours with 1168 requests, a median gap of 6.7 seconds.")}</p>
                    <p>{tr("阈值不是官方限制（那在服务端，看不到），而是「看起来不像人在用」的经验边界。", "The threshold is not an official limit (that lives on the server and is invisible to us). It is a rule of thumb for what looks unlike a human.")}</p>
                  </Help>
                }
              >
                <Toggle on={state.rhythmGuard} onChange={(v) => update({ rhythmGuard: v })} />
              </Row>
              {state.rhythmGuard && (
                <Row title={tr("提醒阈值", "Alert threshold")} desc={tr("每分钟请求数超过它就标为「偏快」", "Requests per minute above this are flagged as too fast")}>
                  <Seg
                    value={state.rhythmThreshold}
                    options={[6, 12, 18].map((n) => ({ v: n, l: tr(`${n} 次/分`, `${n}/min`) }))}
                    onChange={(v) => update({ rhythmThreshold: v })}
                  />
                </Row>
              )}
              <Row title={tr("新手引导", "Onboarding")} desc={tr("检查电脑 → 建环境登录 → 配网络。不会动已有的环境和会话，随时能返回", "Check your Mac, create an environment and sign in, set up the network. Existing environments and sessions are untouched, and you can leave anytime")}>
                <button className="btn" onClick={() => update({ onboarded: false })}>
                  {tr("重新开始", "Start over")}
                </button>
              </Row>
            </>
          )}

          {cat === "appearance" && (
            <>
              <h1>{tr("外观", "Appearance")}</h1>
              <Row title={tr("主题", "Theme")} desc={tr("终端跟着主题换成同色系纸面 / 暖炭", "The terminal follows the theme, using a matching paper or warm charcoal palette")}>
                <Seg
                  value={state.theme}
                  options={(["light", "dark", "system"] as ThemeMode[]).map((t) => ({
                    v: t,
                    l: t === "light" ? tr("浅色", "Light") : t === "dark" ? tr("深色", "Dark") : tr("跟随系统", "System"),
                  }))}
                  onChange={(v) => update({ theme: v })}
                />
              </Row>
              <Row title={tr("界面字号", "Interface font size")} desc={tr("只影响侧栏和面板，不影响终端", "Affects the sidebar and panels, not the terminal")}>
                <Seg
                  value={[0.92, 1, 1.08].find((v) => Math.abs(state.uiScale - v) < 0.01) ?? 1}
                  options={[
                    { v: 0.92, l: tr("小", "Small") },
                    { v: 1, l: tr("中", "Medium") },
                    { v: 1.08, l: tr("大", "Large") },
                  ]}
                  onChange={(v) => update({ uiScale: v })}
                />
              </Row>
            </>
          )}

          {cat === "terminal" && (
            <>
              <h1>{tr("终端", "Terminal")}</h1>
              <Row title={tr("字号", "Font size")} desc={tr("只影响终端里的等宽文本", "Affects monospaced text in the terminal only")}>
                <Seg
                  value={state.terminalFontSize}
                  options={[12, 13, 14, 15].map((s) => ({ v: s, l: String(s) }))}
                  onChange={(v) => update({ terminalFontSize: v })}
                />
              </Row>
              <Row title={tr("光标样式", "Cursor style")}>
                <Seg
                  value={state.cursorStyle}
                  options={[
                    { v: "block" as const, l: tr("方块", "Block") },
                    { v: "bar" as const, l: tr("竖线", "Bar") },
                    { v: "underline" as const, l: tr("下划线", "Underline") },
                  ]}
                  onChange={(v) => update({ cursorStyle: v })}
                />
              </Row>
              <Row title={tr("光标闪烁", "Cursor blink")}>
                <Toggle on={state.cursorBlink} onChange={(v) => update({ cursorBlink: v })} />
              </Row>
              <Row title={tr("选中即复制", "Copy on select")} desc={tr("跟 iTerm2 的习惯一致", "Matches iTerm2 behavior")}>
                <Toggle on={state.copyOnSelect} onChange={(v) => update({ copyOnSelect: v })} />
              </Row>
              <Row title={tr("配色、字体、行高、边距", "Colors, font, line height, padding")} desc={tr("在会话顶栏右上角的「Aa」里改，边改边看效果", "Change them under \"Aa\" at the top right of a session, with a live preview")}>
                <span className="kbd">Aa</span>
              </Row>
            </>
          )}

          {cat === "keys" && (
            <>
              <h1>{tr("快捷键", "Shortcuts")}</h1>
              {[
                ["⌘ N", tr("回首页新建会话", "New session from the home page")],
                ["⌘ T", tr("在当前环境和目录再开一个", "Open another in the current environment and folder")],
                ["⌘ W", tr("关闭当前会话", "Close current session")],
                ["⌘ B", tr("展开 / 收起右栏", "Show / hide right panel")],
                ["⌘ K", tr("命令面板", "Command palette")],
                ["⌘ ,", tr("设置", "Settings")],
                ["⌘ D", tr("查看本次改动", "View changes in this session")],
              ].map(([k, d]) => (
                <Row key={k} title={d}>
                  <span className="kbd">{k}</span>
                </Row>
              ))}
            </>
          )}


          {cat === "update" && <UpdatePage />}
          {cat === "about" && <About />}
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
