/**
 * 中英文切换。
 *
 * 用法：界面文字一律写成 tr("中文", "English")，两种语言挨着写，改一处就能看见另一处。
 * 不用 key 表 —— 一个小应用里 key 表只会让人在两个文件之间来回跳。
 *
 * 当前语言是模块级变量：App 每次渲染前先 setLang，子组件渲染时 tr 就读到新语言。
 * 所以**模块顶层的常量里不能直接调 tr**（那只在加载时算一次），要包成函数或 getter。
 */
export type Lang = "zh" | "en";

let cur: Lang = "zh";

export function setLang(l: Lang) {
  if (cur === l) return;
  cur = l;
  document.documentElement.lang = l === "en" ? "en" : "zh-CN";
  // 主进程里也有给人看的文字（诊断说明、清理原因……），同步一份过去
  void window.claudeBuddy?.setLang?.(l);
}

export function getLang(): Lang {
  return cur;
}

export function tr(zh: string, en: string): string {
  return cur === "en" ? en : zh;
}

/** 第一次启动：跟系统语言走 */
export function systemLang(): Lang {
  return /^zh/i.test(navigator.language) ? "zh" : "en";
}
