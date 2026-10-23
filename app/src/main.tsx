import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installBrowserFallback } from "./lib/browserFallback";
// 顺序要紧：tokens 必须先于 base —— base 里的 body 背景引用了 tokens 的变量，
// 反过来会在变量还没定义时就被解析成空值。
import "./styles/tokens.css";
import "./styles/base.css";
import "@xterm/xterm/css/xterm.css";

// 浏览器预览时安装降级桥；Electron 里 preload 已注入，这里直接返回。
installBrowserFallback();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
