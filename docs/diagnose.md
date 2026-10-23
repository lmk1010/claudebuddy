# 连通诊断能力 —— 接入说明

`neox-shell` 里的一个实测能力：**403 到底是哪一层挡的**。

## 一句话

四层（网络 / 挑战 / 账号 / 用量）的处理方式毫无交集。这个模块真发请求、
按响应头与响应体判定，给出「卡在哪层、该做什么」，并明确标出**没测到的推断**。

## 为什么做这个

排查某个账号的授权 403 时，最初的三次判断都是错的：

1. 以为账号被封 → 实际 refresh token 返回 200
2. 以为 TLS 指纹 → 实际 headless 与真 Chrome 同指纹、结果却不同
3. 以为 `cf_clearance` → 实际不带 cookie 也能过

最后靠**控制变量**才定位到真正原因：**User-Agent**。
同一台机器、同一条网络、同一套 TLS 栈，只改 UA 头，结果从 403 变成 200。

靠列清单猜是猜不出来的，所以把这个对照实验固化下来。

## 文件

| 文件 | 作用 |
|---|---|
| `app/electron/diagnose.cjs` | 探测与归因逻辑（主进程） |
| `app/electron/main.cjs` | 注册 `diagnose:run` IPC |
| `app/electron/preload.cjs` | 暴露 `diagnoseRun()` |
| `app/src/lib/bridge.ts` | 类型契约 `DiagnoseResult` / `DiagnoseLayer` |
| `app/src/lib/browserFallback.ts` | 浏览器预览模式的降级（如实返回「没测」） |
| `app/src/components/Diagnose.tsx` | 设置 · 连通诊断 界面 |
| `app/src/components/Settings.tsx` | 新增「连通诊断」分类 |
| `app/src/styles/app.css` | `.diag-*` 样式 |

## 它测什么

四层并行发请求，每层一条结论：

| 层 | 探测 | 判定依据 |
|---|---|---|
| 网络出口 | `ip-api.com` 查 IP / ASN / ISP / hosting 标记 | ASN 或 ISP 名带 hosting/cloud → warn |
| Bot 挑战 | 对照组 `cloudflare.com/cdn-cgi/trace` + Claude 各域名 | `cf-mitigated: challenge` 或 `Just a moment` |
| 账号状态 | `api.anthropic.com/v1/messages` | `account_on_hold` / `account_disabled` |
| 用量额度 | 同上 + token 端点 | `429` / `rate_limit_error` / `usage limit` |

### 核心：UA 对照实验

```
GET https://claude.ai/api/bootstrap
  UA = Chrome 131  → 200
  UA = claude-cli  → 403 challenge
```

同一个请求、同一个 IP、同一套 TLS，**只换 UA**。结果不同即证明拦截点在 UA。

这条是模块里最硬的证据，界面上单独一块展示。

## 它不测什么（重要）

返回值里的 `unverified` 字段会把这些原样传给界面，避免把推断当结论：

- 不读 JA3/JA4，也不判断服务端是否在用 TLS 指纹
- 不探测 Canvas / WebGL / 字体 / 鼠标轨迹是否被采集
- 账号内部判定逻辑不可见，只能从错误码反推
- 本地 TLS 栈与真实 Chrome 不同，结论**不能**等同于「Chrome 会被怎样判定」

## 验证记录

```
npm run typecheck   通过
npm run build       通过（CSS 62.18 kB / JS 645.06 kB）
node --check        三个 .cjs 全部通过
Electron 实跑        diagnose.cjs 在 Electron 运行时下返回正确结论
界面                设置 → 连通诊断 正常渲染，浏览器预览模式如实降级
```

实测输出：

```
headline: 主因是 User-Agent 判定：CLI 自己的 UA 被 Claude 的 bot 规则挑战，浏览器 UA 则放行。
blocker : challenge
ua      : 同一请求，浏览器 UA 通过、CLI UA 被挑战 —— 拦截点在 User-Agent。
layers  : 网络出口=warn | Bot 挑战=warn | 账号状态=ok | 用量额度=ok
```

## 已知边界

- 用的是 Node 的 https 栈，不是 Chrome 的。所以它能测出「UA 敏感」，
  但测不出「Chrome 会不会被指纹拦住」。
- `ip-api.com` 有免费额度限制（约 45 次/分钟），频繁点「重测」可能被临时限流。
- 只在 macOS 上验证过。
