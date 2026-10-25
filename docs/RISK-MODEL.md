# ClaudeBuddy 隔离模型

> 依据：对客户端遥测行为的实测（含 331 条字段实证），以及 macOS seatbelt profile 的对照。
> 本文只写"软件真的做了什么"，以及"为什么做不到的就不假装做到"。

---

## 一、风控到底靠什么认人

报告里最有决定性的一条：**`userID` 就是遥测上报的 `device_id`，331/331 实测相等。**

但这不等于"换掉 userID 就安全"。真正把两个账号关联起来的线有四条：

| 关联线 | 能不能换 | 依据 |
|---|---|---|
| 账号 UUID / 邮箱 / orgUuid | **换不掉** | 存在 `oauthAccount` 里，风控支点；`account_on_hold` 在 API 请求、OAuth 回调、Token 刷新三处判定 |
| `userID` / `machineID` | **能换** | `crypto.randomBytes(32).toString("hex")`，纯软件随机，与硬件无关 |
| 出口 IP / `cf_ray` | **能换** | Claude Code 读 `HTTPS_PROXY`，遥测里上报 `https_proxy` |
| uname 画像（OS/内核/arch/shell/终端） | **换不掉** | 客户端主动跑 `uname -s/-r/-m` 采集 |
| git remote 的 SHA-256 前 16 位 | **能变，但变了也没用** | 同一仓库在不同机器得到同一哈希，跨设备可关联 |

结论：**本软件能控的是后三条里的两条（身份、出口）**，账号 UUID 和 uname 画像不是客户端能解决的。
所以界面上不写"已完全隔离"，只写每一层各自做到了什么。

### 命名：叫「暂时风控」，不叫「封号」

客户端能看到的只有一个事实：请求被 `account_on_hold` 拒了。它看不到这个状态是临时的还是永久的，
也看不到风控因为什么判的。所以界面上的标签是**暂时风控**：描述看到的状态，
不替服务端下「这个号死了」的结论。用户因此不会因为一句「已封号」就提前把还能救的号清掉。

---

## 二、四层隔离，逐层对应实现

### 1. 配置隔离（硬隔离，100% 有效）

一个账号 = 一个 `CLAUDE_CONFIG_DIR`。Claude Code 认这个变量，凭据、projects、
file-history、telemetry、stats、uploads 全在目录里。

实现位置：`electron/account.cjs` → `envForAccount()`

```js
env.CLAUDE_CONFIG_DIR = path.join(HOME, account.configDir)
```

**路径只由主进程产生。** 渲染层传进来的是账号 id，不是路径；
主进程再用 `/^\.claude(-[a-z0-9-]+)?$/` 白名单卡一道。
这样即使 UI 有 bug 或注入，也不可能把两个账号指到同一个目录。

同时清掉所有会破坏隔离的继承变量：

```js
delete env.ANTHROPIC_API_KEY       // 父进程带的 key 会把账号指错
delete env.ANTHROPIC_AUTH_TOKEN
delete env.CLAUDE_CODE_OAUTH_TOKEN
delete env.HTTPS_PROXY             // 上一层的代理不能漏进来
```

### 2. 网络隔离（有效，取决于代理质量）

`HTTPS_PROXY` 和 `https_proxy` 都设 —— 源码里两种写法都读。

```js
env.HTTPS_PROXY = env.https_proxy = url
env.NO_PROXY = env.no_proxy = "localhost,127.0.0.1,::1"
```

**一个账号固定一个出口。** 出口 IP 频繁跳变本身就是信号，
所以界面会记住"上次测到的 IP"，变了就明确告警：

> IP 跳变了：1.2.3.4 → 5.6.7.8。同一个账号频繁换出口本身就是信号。

出口检测走**和 Claude Code 完全相同的代理环境变量**，
否则测出来的数没有意义，比不测更糟。测不到就显示 `—`，不填假数。

### 3. 身份隔离（有效，但有边界）

轮换 `~/.claude.json` 里的 `userID` 和 `machineID`：

- 只改这两个，**不动 `oauthAccount`** —— 那是账号身份，删了等于掉登录
- 顺手删掉 `summonSidKey` / `remoteControlMachineId`，让它们按需重新生成
- 改前自动备份 `.bak-<时间戳>`
- **账号还有活着的终端时拒绝轮换** —— 否则运行中的进程会把旧值写回去

界面上写清楚它解决什么：

> 轮换它能重置"这台机器"的画像，但换不掉账号 UUID、uname 画像、仓库哈希和 IP —— 那四条线还在。

### 4. 环境画像（只读，改不掉）

`uname` 三连 + shell + 终端类型。报告说得很清楚这是换不掉的，
所以软件**只采集、只展示，不假装能改**。

---

## 三、登录闭环（实测行为，不是猜的）

`claude auth login` 的真实行为（本机 2.1.308 实测）：

1. 打印一个 OAuth URL（`https://claude.com/cai/oauth/authorize?...`）
2. 停在 `Paste code here if prompted >` 等输入
3. 用户贴码后才写凭据

所以只"显示输出"是不够的 —— 用户拿到的码没地方贴，流程就断在最后一步。
`components/LoginConsole.tsx` 解决的就是这个：

- 从输出里认出 URL，提供"在浏览器中打开授权页"
- 认出 `Paste code` 提示，弹出输入框，回车写进同一个 PTY
- 登录成功与否**只认 `claude auth status --json`**，不解析输出去猜

成功判据是 CLI 自己写下的凭据，不是我们看到的某行文字。

### 终端不会永远挂着

`claude` 退出后 shell 会回到提示符而不是结束 —— 这意味着
"等 PTY 退出"永远等不到。所以：

- 盯 CLI 输出，看到成功/失败关键词就立刻收掉终端
- 10 分钟兜底超时
- 成功登出、取消登录、窗口卸载，都会显式关掉登录终端

以前这里有个真实 bug：登录终端永不关闭，界面一直显示"等待 CLI 输出"。
现在三个出口都堵上了。

---

## 四、退出与痕迹

### 登出

走 `claude auth logout`，保证 Keychain 也跟着清，不在本地猜。

### Keychain 的坑

报告里的关键发现：**主条目 + 每个配置目录一个 8 位 hex 后缀条目**。
所以清理必须按前缀枚举，硬编码服务名会漏掉旧 token。

```js
svce.startsWith("Claude Code-credentials")   // 不是 ===
```

界面提供只读列举，让人先看清有什么，再决定清不清。

### 痕迹清单

按报告里的"清理工具目标面"逐项 stat，不是估算：

对话记录 / 文件历史 / 输入历史 / 遥测 / 行为画像 / 身份文件 / 登录凭据 /
上传文件 / 粘贴缓存 / 配置备份 / shell 快照 / 插件

每条都有真实体积，标出哪几条是 critical。

---

## 五、"每个窗口用什么环境"是怎么保证的

会话创建时，渲染层只传 `{ accountId, cwd }`。
主进程 `term:spawn` 里：

```js
const resolved = resolveAccount(account)   // id → 完整账号
acct.ensureConfigDir(resolved)
const env = acct.envForAccount(resolved)   // 目录 + 代理全在这
pty.spawn(shell, args, { env })
```

所以一个窗口用哪个目录、哪个出口、哪个身份，**在进程启动那一刻就固定了**，
中途不可能改。右栏会把这些如实展示出来：

- 账号（邮箱）
- 出口（代理地址）
- 目录
- 分支

---

## 六、已知边界（不装）

| 做不到 | 原因 |
|---|---|
| 换掉账号 UUID | 服务端主键，客户端无法改 |
| 改 uname 画像 | 客户端主动采集真实内核信息 |
| 内核级隔离 | 未使用容器/虚拟机；文件系统仍是同一个用户 |
| 绕过 `account_on_hold` | 服务端在三个环节判定，本地凭据无效 |
| 保证代理真的换了 IP | 取决于代理本身；软件只能如实检测并告警 |

这些全部写在界面上对应的位置，而不是藏在文档里。

---

## 七、改动这一块时必须守住的三条

1. **路径只从主进程出**。渲染层永远只传 id。
2. **状态只从 CLI 读**。登录态、身份、凭据有效性与否，一律问 CLI 或读它写的文件，不在渲染层缓存结论。
3. **做不到的就写 `—`**。测不到 IP、读不到用量、未登录没有邮箱 —— 显示空缺，不填看起来合理的数。
