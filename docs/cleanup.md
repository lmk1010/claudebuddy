# 体检：账号清理 + 连通归因

设置 → 体检。**进去就自动查，不需要点任何按钮。**

## 为什么合在一个页面

这两件事的答案互相依赖：

- 一个号废了，可能是账号被封（账号层），也可能是这台机器连不上（网络层）
- 光看"连不上"就去清号，会误删还能救的号
- 光看"号废了"就去换网络，白折腾

所以同一个页面同时给出**本机有哪些号**和**403 卡在哪一层**。

## 账号清理

### 能看到什么

扫描三类目录，不只是 neox-shell 自己建的那些：

| 来源 | 位置 | 说明 |
|---|---|---|
| 默认 | `~/.claude` | 主账号，Keychain 用无后缀条目 |
| neox-shell | `~/.claude-*` | 本工具建的隔离环境 |
| codex-config-ui | `~/.codex-config-ui/claudecode-oauth-profiles/prof_*` | 另一套工具建的，容易被漏掉 |

**关键**：Keychain 条目名 = `Claude Code-credentials-` + `sha256(完整绝对路径)[:8]`。
是**完整路径**，不是目录名 —— 实测确认过，用目录名会算出完全不同的值，
导致"以为清了其实没清"。

### 三种状态

| 状态 | 判据 | 是否建议清理 |
|---|---|---|
| 正常 | 有 Keychain 凭据 | 否 |
| 掉登录 | 没凭据，但目录里有对话记录 | **否** |
| 空壳 | 没凭据、没对话记录、体积也很小 | 是 |

**「掉登录」不清理**是刻意的。一个 600MB、26 段对话的目录，
重新登录就能接着用；按"没凭据"就删掉，是在毁资料。

判断以**有没有对话记录**为主，体积只作兜底 —— 因为对话不可再生。

### 清理做了什么

| 动作 | 结果 | 可恢复 |
|---|---|---|
| 目录 | 移到 `~/.claude-buddy-trash/<时间戳>/` | **是**，手动挪回即可 |
| Keychain 条目 | `security delete-generic-password` | 否 |
| codex-config-ui 登记 | 从 `profiles.json` 移除该条 | 否（但可重新登录） |

顺序是：先摘登记 → 再挪目录 → 最后删凭据。
中途失败时凭据还在，还能重新登录找回。

### 安全边界

- **只接受体检结果里出现过的 id**，渲染层传不进任意路径 —— 防参数注入
- **默认目录 `~/.claude` 永远不删**（只清凭据，且需显式确认）
- **主 Keychain 条目**需显式 `allowMainKeychain` 才能删
- 回收站目录本身不会被当成账号扫出来

## 连通归因

见 `app/electron/diagnose.cjs`。四层独立判定，`blocker` 只指向最该先处理的那层。

核心是 UA 对照实验：同一请求用浏览器 UA 和 CLI UA 各发一次，
结果不同即证明拦在 User-Agent。

## 文件

| 文件 | 作用 |
|---|---|
| `app/electron/cleanup.cjs` | 体检与清理逻辑 |
| `app/electron/diagnose.cjs` | 连通归因 |
| `app/electron/main.cjs` | IPC：`cleanup:survey` / `cleanup:purge` / `diagnose:run` |
| `app/electron/preload.cjs` | 桥接 |
| `app/src/lib/bridge.ts` | 类型契约 |
| `app/src/components/Diagnose.tsx` | 界面（体检 + 连通） |
| `app/src/lib/browserFallback.ts` | 浏览器预览模式降级 |
| `app/src/styles/app.css` | `.diag-*` / `.btn-quiet` / `.btn-danger` / `.diag-bulk` |

## 演练模式

```
CLAUDE_BUDDY_DRY_RUN=1
```

只出计划，不移动目录、不删凭据。

**这一条是必须的，不是可选的。** Keychain 是全局的，不随 `CLAUDE_BUDDY_HOME` 隔离。
在临时 HOME 里跑体检时，真实条目会全部被判成「无人认领」——
不开演练模式就执行清理，会真的删掉真实账号凭据。

## 验证记录

```
npm run typecheck            通过
npm run build                通过（CSS 63.17 kB / JS 648.74 kB）
node --check cleanup.cjs     通过
Electron 实跑 survey         4 个账号正确分类，建议清理 1 个空壳
演练模式                     keychain 完好，只出计划
隔离环境全流程               空壳目录被移入回收站、登记被摘除、
                             默认 .claude 被拒绝、主条目被拒绝
```

实测输出（账号已脱敏）：

```
[signed-out] prof_xxxxxxxx  u***@example.com  620MB  sessions=26
[empty]      .claude-xxxxxx  -                 1MB    sessions=0   ← 建议清理
[ok]         .claude         -                 5490MB sessions=128
[signed-out] prof_yyyyyyyy  a***@example.com   240MB  sessions=23
```

## 已知边界

- **不判断账号是否被封**。本地看不出来，需要联网。被封的号本地看起来完好，
  所以必须由用户自己点清理 —— 这一点没有自动化，也不该自动化。
- `dirSize` / `lastActiveOf` 带预算上限，超大目录（`~/.claude` 5.5GB）
  的数字是采样结果，不是精确值。
- 只在 macOS 上验证过。
