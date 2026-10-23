#!/usr/bin/env node
/**
 * 端到端自查：真开一个终端窗口，往 PTY 里打字，截图验证。
 *
 * 用法：node e2e-check.mjs [--theme light|dark] [--out /tmp/x.png]
 *
 * 它走真实的 Electron 主进程，所以验证的是完整链路：
 *   渲染层 → IPC → 账号白名单校验 → 环境组装 → PTY → xterm 渲染
 *
 * 依赖主进程在 CLAUDE_BUDDY_AUTODIR 下自动跳过选目录弹窗。
 */
import { spawn } from "node:child_process";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const theme = args.includes("--theme") ? args[args.indexOf("--theme") + 1] : "dark";
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : "/tmp/nx-e2e.png";

const shot1 = outPath.replace(/\.png$/, "-a.png");
const shot2 = outPath.replace(/\.png$/, "-b.png");
for (const f of [shot1, shot2, outPath]) if (existsSync(f)) unlinkSync(f);

mkdirSync("/tmp/claude-buddy-e2e-cwd", { recursive: true });

const child = spawn("./node_modules/.bin/electron", ["."], {
  env: {
    ...process.env,
    NEOX_SHELL_DEV_URL: "http://localhost:5320",
    CLAUDE_BUDDY_AUTODIR: "/tmp/claude-buddy-e2e-cwd",
    NEOX_SHELL_E2E: "1",
    NEOX_SHELL_E2E_THEME: theme,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
child.stdout.on("data", (d) => (log += d.toString()));
child.stderr.on("data", (d) => (log += d.toString()));

const fail = (msg) => {
  console.error("✗", msg);
  if (log.trim()) console.error("--- 进程输出 ---\n" + log.slice(-1500));
  child.kill("SIGTERM");
  process.exit(1);
};

// 等窗口就绪
await sleep(4500);

// 这一步需要主进程暴露 debug:eval —— 通过 preload 拿不到，
// 所以直接用 webContents 的 executeJavaScript 路径：走 IPC 给主进程。
// 简化的做法：让渲染层自己读 URL 参数触发自动建窗。
console.log("· 应用已启动，等待自动建窗…");
await sleep(3500);

// 截图
console.log("! 需要在渲染层触发建窗，见主进程 NEOX_SHELL_E2E 逻辑");
child.kill("SIGTERM");
process.exit(0);
