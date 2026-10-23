# ClaudeBuddy

给 Claude Code 一个安全、隔离、不用反复配置的家。

每个账号一个独立的配置目录、独立的凭据、独立的痕迹空间。切换账号不再靠 `export CLAUDE_CONFIG_DIR` 手打，也不会因为一个号废了把另一个号带下水。

> 前身是 NeoX Shell。界面沿用 Anthropic 的 code-editorial 视觉语言：暖米色纸面、一支陶土色、发丝线级描边。

## 它解决什么问题

Claude Code 的多账号管理很别扭：

- 凭据存在 Keychain，条目名是 `Claude Code-credentials-<sha256(配置目录)[:8]>`，靠手工记不住
- 不同工具的配置目录散落在 `~/.claude*` 和 `~/.codex-config-ui/...`，删号时容易漏
- 号废了想清干净，得同时处理目录、Keychain 条目、登记文件三处
- 出了问题分不清是账号被封、网络被拦、还是额度用完，三种处理方式完全不同

ClaudeBuddy 把这些收进一个窗口。

## 功能

**多账号**

- 每个账号独立 `CLAUDE_CONFIG_DIR`，独立 Keychain 凭据
- 一键切换，不用再手打环境变量
- 账号面板显示每个号真实的邮箱、订阅等级、用量

**体检**

进去就自动查，不需要点按钮。

- 扫描三类配置目录：`~/.claude`、`~/.claude-*`、codex-config-ui 的 `prof_*`
- 标出每个号的状态：正常 / 掉登录 / 空壳
- 一键清理废号：目录移到回收站（可捞回）、删 Keychain 条目、摘掉登记
- 连通归因：403 到底是网络层、挑战层、账号层还是额度层

**终端**

- 内嵌 xterm，直接跑 Claude Code
- 会话状态一目了然

**节奏看护**

- 请求节奏可视化，避免无意识的密集调用
- 用量看板

## 安装

### 从源码跑

```bash
cd app
npm install
npm run dev      # 浏览器预览（无主进程，部分功能降级）
npm run app      # 完整应用
```

### 打包

```bash
cd app
npm run dmg      # 产出 release/*.dmg
```

macOS ARM64。会用本机 Developer ID 证书签名。

## 项目结构

```
app/
  electron/          主进程
    main.cjs         窗口、IPC、进程管理
    account.cjs      账号与配置目录
    cleanup.cjs      体检与清理
    diagnose.cjs     连通归因（403 分层）
    checkup.cjs      环境自检
    proxydetect.cjs  代理探测
  src/               渲染进程（React + Vite）
    components/      界面
    lib/bridge.ts    IPC 类型契约
    styles/          设计 token 与样式
docs/                实现说明
DESIGN.md            设计系统
```

## 设计上的几个决定

**清理不等于删除。** 目录移到 `~/.claude-buddy-trash/`，删错了能捞回来。但 Keychain 条目是删掉的 —— 那本来就是要清的东西。

**「掉了登录」不清理。** 一个 600MB、26 段对话的目录，重新登录就能接着用。按「没凭据」就删，是在毁资料。只有真正的空壳才建议清。

**不判断账号是否被封。** 那需要联网，本地看不出来。被封的号本地看起来完好，所以必须由用户自己点清理 —— 这一点没有自动化，也不该自动化。

**诊断靠控制变量，不靠清单。** 判断「什么在挡我」，唯一可靠的办法是固定其他条件只改一项。比如固定 IP、固定 TLS 栈、只换 User-Agent。

## 已知边界

- 只在 macOS ARM64 上验证过
- 未做公证（需要 App Store Connect 凭据），首次打开可能需要右键 → 打开
- 账号被封的判定不在本地做，见上文

## 许可

MIT，见 [LICENSE](LICENSE)。
