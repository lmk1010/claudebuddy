---
version: alpha
name: NeoX Shell — Design System
description: >
  A desktop terminal for Claude Code, inheriting Anthropic's code-editorial visual language.
  Warm cream paper (never pure white, never cool gray), one terracotta coral as scarce voltage,
  hairline ink elevation (never heavy shadow), EB Garamond for display + Inter for body +
  JetBrains Mono for chrome and code on a warm-navy terminal surface. Sentence-case display.
  The unit is the app window, not the frame — this is a static desktop UI, so cqw becomes px
  against a 1440×900 reference window.
unit: the app window — 1440×900 reference; scales to 1280×800 and 1920×1200
principle: atoms are sacred · layout is free · every number visible to the user is real

colors:
  ink: "#141413"
  ink-2: "#3D3B36"        # secondary text
  ink-3: "#6B6862"        # muted text, placeholder
  ink-4: "#9A968C"        # disabled, hairline labels
  cream: "#FAF9F5"        # app ground (light)
  paper: "#FFFFFF"        # raised card on cream
  tile: "#EFE9DE"         # half-step warm surface
  tile-strong: "#ECE3D4"  # selected / pressed
  coral: "#CC785C"        # THE accent. one moment per screen
  coral-soft: "#F5E4DD"   # callout ground only
  navy: "#181715"         # terminal ground, dark app ground
  navy-soft: "#1F1E1B"    # dark sidebar
  navy-elev: "#252320"    # dark raised card
  teal: "#5DB8A6"         # syntax: strings, success alt
  amber: "#E8A55A"        # syntax: numbers, warning
  success: "#5DB872"
  danger: "#C64545"

borders:
  hairline: "1px solid ink@10%"
  hairline-strong: "1px solid ink@18%"
  dark: "1px solid cream@12%"

shadows:
  card: "0 1px 2px ink@6%, 0 3px 12px ink@4%"
  popover: "0 4px 12px ink@8%, 0 1px 3px ink@6%"
  none: "none"

typography:
  # reading + chrome ramp (px against 1440 reference)
  body:        { fontFamily: "Inter", px: 13, weight: 400, lineHeight: 1.55 }
  body-sm:     { fontFamily: "Inter", px: 12, weight: 400, lineHeight: 1.5 }
  lead:        { fontFamily: "Inter", px: 15, weight: 400, lineHeight: 1.6 }
  card-title:  { fontFamily: "Inter", px: 13, weight: 500, lineHeight: 1.3, tracking: "-0.005em" }
  button:      { fontFamily: "Inter", px: 12.5, weight: 500, lineHeight: 1.0 }
  tag-upper:   { fontFamily: "Inter", px: 10.5, weight: 500, tracking: "0.14em", upper: true }
  kicker:      { fontFamily: "JetBrains Mono", px: 10.5, weight: 500, tracking: "0.14em", upper: true }
  mono-label:  { fontFamily: "JetBrains Mono", px: 11, weight: 500, tracking: "0.01em" }
  code:        { fontFamily: "JetBrains Mono", px: 12.5, weight: 400, lineHeight: 1.6 }
  # display ramp — EB Garamond 400, sentence case, negative tracking
  headline:    { fontFamily: "EB Garamond", px: 26, weight: 400, lineHeight: 1.12, tracking: "-0.018em" }
  display:     { fontFamily: "EB Garamond", px: 32, weight: 400, lineHeight: 1.06, tracking: "-0.022em" }
  number-hero: { fontFamily: "EB Garamond", px: 34, weight: 400, lineHeight: 1.0, tracking: "-0.025em" }
  number-unit: { fontFamily: "JetBrains Mono", px: 11, weight: 500, lineHeight: 1.0 }

spacing:
  pad-xs: 4
  pad-sm: 8
  pad-md: 12
  pad-lg: 16
  pad-xl: 24
  gap-xs: 4
  gap-sm: 8
  gap-md: 12
  gap-lg: 20
  radius-sm: 6
  radius-md: 8
  radius-lg: 12
  radius-pill: 9999
  sidebar-w: 264
  panel-w: 296
  titlebar-h: 44
  statusbar-h: 26
  row-h: 30

components:
  card-hairline:
    backgroundColor: "{colors.paper} (light) / {colors.navy-elev} (dark)"
    border: "{borders.hairline}"
    rounded: "{spacing.radius-lg}"
    shadow: "{shadows.card}"
    description: "Every content card. Elevation is hairline + ONE soft warm shadow. Never heavy drop, glow, or gradient."
  kicker-spike:
    typography: "{typography.kicker}"
    mark: "✱ coral prefix"
    description: "Section eyebrow — mono uppercase, 2-5 words, coral ✱ prefix. Never a sentence."
  coral-callout:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.cream}"
    rounded: "{spacing.radius-md}"
    description: "The ONE voltage moment per screen — primary action or the live risk alert. Never two corals visible at once."
  number-lockup:
    typography: "{typography.number-hero} figure + {typography.number-unit} unit"
    description: "The rate meter: serif figure + mono unit. Figure serif, unit ALWAYS mono."
  section-rule:
    rule: "1px solid ink@10% / cream@12%"
    description: "The only separator. Never 2px+, never a heavy divider."
  code-surface:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.cream}"
    border: "{borders.dark}"
    rounded: "{spacing.radius-md}"
    description: "The terminal. Warm navy, not black. This is the app's focal surface — everything else recedes."
  row-item:
    height: "{spacing.row-h}"
    rounded: "{spacing.radius-sm}"
    hover: "ink@5%"
    description: "List rows. 30px tall, 6px radius, hover is a 5% ink wash — no borders, no dividers between rows."
---

# NeoX Shell — Design System

一个为 Claude Code 打造的桌面终端。它的视觉语言直接继承 Anthropic 的
**code-editorial**：暖纸色、单一陶土橙、发丝级边框、衬线标题、等宽代码面。

这份文档是**规范层**：所有颜色、字号、间距都是确定的数值，实现必须逐字引用，
不得自创、不得四舍五入。正文是**语境层**：解释为什么这样定，以及什么情况算违反。

---

## 一条主线：这台应用只有一个视觉焦点

整个界面里，**终端是唯一的深色面**，其余全是暖纸色。

这不是配色偏好，是信息架构：用户 95% 的时间盯着终端，其余 UI 是它的取景框。
所以侧栏、标题栏、状态栏、右栏全部退到一个很浅的暖灰里，靠**留白**和**发丝线**分隔，
不靠阴影、不靠卡片堆叠、不靠彩色区块。

反过来，终端是一块**暖黑**（`#181715`，不是纯黑），像一张深色纸嵌在浅色桌面里。

```
┌──────────┬──────────────────────────────┬──────────┐
│ 侧栏      │ 标题栏                        │ 右栏      │
│ navy-soft│ cream                        │ navy-soft│
│          ├──────────────────────────────┤          │
│ 窗口列表  │ ┌──────────────────────────┐ │ 节奏      │
│          │ │  终端 navy #181715        │ │ 环境      │
│          │ │  唯一深色面 = 唯一焦点      │ │ 目录      │
│          │ └──────────────────────────┘ │          │
├──────────┴──────────────────────────────┴──────────┤
│ 状态栏 cream，26px，只有 mono 小字                    │
└─────────────────────────────────────────────────────┘
```

---

## 颜色

**四个基础面**，用它们的**暖度**做层次，不用深浅对比：

| token | 值 | 用在哪 |
|---|---|---|
| `cream` | `#FAF9F5` | 应用底、主区背景 |
| `paper` | `#FFFFFF` | 浮起的卡片（极少用） |
| `tile` | `#EFE9DE` | 半档暖面：分段控件底、空状态卡 |
| `tile-strong` | `#ECE3D4` | 选中态 |

**深色面**：

| token | 值 | 用在哪 |
|---|---|---|
| `navy` | `#181715` | 终端本体 |
| `navy-soft` | `#1F1E1B` | 深色模式侧栏 |
| `navy-elev` | `#252320` | 深色模式卡片 |

**文字梯度**是四级，不是三级：

```
ink      #141413   主文字
ink-2    #3D3B36   次要文字（列表项未选中）
ink-3    #6B6862   弱化文字（说明、占位）
ink-4    #9A968C   禁用、发丝标签
```

### 珊瑚色是电压，不是填充色

`coral #CC785C` **一屏只能出现一次**。它是这一屏里唯一的"亮起来"的东西：

- ✅ 主按钮、当前风险告警、品牌标记（logo 的暖色部分）
- ❌ 正文文字、卡片背景、多个元素同时用、装饰性色块

这条规则比看起来重要。一旦珊瑚色出现两次，界面就从"克制"变成"花哨"，
整个 code-editorial 的气质就没了。

### 语法色固定，不可挪用

终端里的语法高亮是**装饰**，不属于品牌色板：

```
关键字   coral    #CC785C
字符串   teal     #5DB8A6
数字     amber    #E8A55A
成功     #5DB872
危险     #C64545
```

### 禁止

- ❌ 冷灰（`#888`、`#ccc` 这种中性灰）—— 一定是**暖**灰
- ❌ 纯白 `#FFF` 做大面积底（只允许做 `paper` 卡片）
- ❌ 纯黑 `#000` —— 最深是 `navy #181715`
- ❌ 渐变、光晕、霓虹

---

## 排版

**两套字阶，各司其职**，绝不混用：

### 阅读 + 界面（Inter）

| 用途 | 字号 | 字重 | 行高 |
|---|---|---|---|
| 正文 | 13 | 400 | 1.55 |
| 小正文 | 12 | 400 | 1.5 |
| 引导段 | 15 | 400 | 1.6 |
| 卡片标题 | 13 | 500 | 1.3 |
| 按钮 | 12.5 | 500 | 1.0 |
| 全大写标签 | 10.5 | 500 | `0.14em` 字距 |

### 展示（EB Garamond 400）

**只用于标题和数字**。永远 400 字重、**句首大写**（不是 Title Case，不是全大写）、
**负字距**。这是整套设计里"高级感"的主要来源。

| 用途 | 字号 | 字距 |
|---|---|---|
| 空状态大标题 | 26 | `-0.018em` |
| 展示标题 | 32 | `-0.022em` |
| 英雄数字 | 34 | `-0.025em` |

### 界面 + 代码（JetBrains Mono）

全大写、`0.14em` 字距的 **kicker** 用于分区小标题，前面加珊瑚色 `✱`。
数字、路径、配置目录、代码全部用它。

### 数字锁合（number-lockup）

**这是本设计系统里最独特的一个组件**，出自 Claude 的 code-editorial：

> 数字用**衬线体**，单位用**等宽体**，永远不能都是同一种。

```
  12  次 / 分钟        6.7s
  ↑衬线  ↑等宽         ↑等宽
```

用在节奏仪表、会话计数、请求量。它比"统一无衬线"高级的地方在于：
衬线数字有字重变化，等宽单位有机械感，两者并置产生对比。

### 禁止

- ❌ 无衬线做大标题（必须是 EB Garamond）
- ❌ 衬线做正文或标签
- ❌ 全大写衬线
- ❌ 任何字体替换（没有 Garamond 就用 Georgia，但要在报告里声明）

---

## 深度

**发丝线抬升**，这是硬规则：

- **1px 边框，ink@10%** —— 主要的层次手段。深色面上用 cream@12%。
- **一个极淡的暖阴影** —— `0 1px 2px ink@6%, 0 3px 12px ink@4%`。**很少用**。
- **半档面色** —— `tile` 放在 `cream` 上自然浮起，靠暖度差，不靠投影。

**天花板**：不允许重投影、不允许光晕、不允许内容渐变、不允许倾斜。
这个系统没有"光"，它靠**暖度**和**发丝线**读层级。

> 这条直接对应最初的批评"线条太明显"。解决方式不是把线加粗，而是：
> 线只有 1px 且只有 10% 不透明度；同时**减少线出现的次数** ——
> 列表项之间不画分隔线，靠行高和 hover 底色分隔。

---

## 形状

```
6px    小控件（按钮、行、标签）
8px    卡片、终端面
12px   大卡片、面板
9999px 真正的胶囊（分段控件、状态药丸）
```

没有直角，也不会圆得很重。编辑气质是**轻圆**，不是硬角，也不是大圆角。

---

## 组件

### row-item —— 列表行

30px 高、6px 圆角、hover 是 `ink@5%` 的淡洗。**行与行之间不画线**。

选中态用 `tile-strong` 底色 + 文字从 `ink-2` 升到 `ink` + 字重升到 500。
三个信号同时变，但不引入任何新颜色。

### card-hairline —— 内容卡

`paper` 或 `tile` 底 + 1px `ink@10%` 边 + 一个极淡阴影。仅此。

### kicker-spike —— 分区标题

```html
<div class="kicker"><span class="spike">✱</span> 节奏</div>
```

全大写等宽 10.5px、`0.14em` 字距、`✱` 用珊瑚色。**绝不能是一句话**，2-5 个词。

### coral-callout —— 唯一的电压时刻

一屏一个。要么是主操作按钮，要么是实时风险告警，不能两者同时。

### code-surface —— 终端

`navy #181715` 底、`cream` 文字、1px `cream@12%` 边、8px 圆角。
它是整个应用的**焦点面**，其余一切都必须比它安静。

---

## 布局

参考窗口 1440×900，三栏：

| 区域 | 宽度 | 底色 |
|---|---|---|
| 侧栏 | 264（可拖 220–380） | `navy-soft`（深）/ `cream`（浅） |
| 主区 | 自适应 | `cream` |
| 右栏 | 296（可折叠 ⌘B） | `navy-soft` / `cream` |

垂直方向：

| 条 | 高度 |
|---|---|
| 标题栏 | 44 |
| 状态栏 | 26 |

**间距一律用 `pad-*` / `gap-*` 的数值**，不随手写 `margin: 13px`。
密度目标是**中偏松**：行高 30、组间距 20、面板分区间 16。

---

## 交互状态

| 状态 | 表现 |
|---|---|
| hover | `ink@5%` 底色，无边框变化 |
| active/选中 | `tile-strong` 底 + 文字升一级 + 字重 500 |
| focus | 2px `coral` 外环，`outline-offset: 2px`，**只在键盘导航时出现** |
| disabled | 文字 `ink-4`，不降透明度（暖色系统里降透明度会脏） |

过渡统一 `120ms cubic-bezier(0.32, 0.72, 0, 1)` —— 快、无回弹。
不做弹跳、不做长动画。

---

## 明暗两套

**暗色不是亮色反相**，是另一套暖黑：

| | 亮 | 暗 |
|---|---|---|
| 应用底 | `cream #FAF9F5` | `navy-soft #1F1E1B` |
| 侧栏 | `cream` | `#1A1917` |
| 卡片 | `paper #FFFFFF` | `navy-elev #252320` |
| 主文字 | `ink #141413` | `cream #FAF9F5` |
| 边框 | `ink@10%` | `cream@12%` |

**终端在两种模式下都是深色** —— 它是焦点面，不该跟着主题变。
这条很关键：如果浅色模式下终端也变白，焦点就消失了。

---

## 自检清单

实现完成后逐条核对，违反一项就必须改：

- [ ] 屏幕上的珊瑚色只出现一次
- [ ] 没有冷灰；所有灰都偏暖
- [ ] 没有纯黑 `#000`、没有大面积纯白
- [ ] 标题全部是 EB Garamond 400、句首大写、负字距
- [ ] 正文/标签里没有衬线
- [ ] 数字锁合 = 衬线数字 + 等宽单位
- [ ] 所有边框都是 1px、不透明度 ≤ 20%
- [ ] 没有重投影、光晕、渐变
- [ ] 列表行之间没有分隔线
- [ ] 圆角只用 6 / 8 / 12 / 9999
- [ ] 间距值都来自 `pad-*` / `gap-*`
- [ ] 终端是深色面，且在两种主题下都是
- [ ] 所有显示给用户的数字都是真实读出来的，不是编的
