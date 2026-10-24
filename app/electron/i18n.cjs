/**
 * 主进程这边的中英文：诊断说明、清理原因、浏览器选项名这类会显示到界面上的文字。
 * 写法跟渲染层一样：L("中文", "English")。语言由渲染层通过 app:setLang 同步过来。
 */
let cur = "zh";

function setLang(l) {
  cur = l === "en" ? "en" : "zh";
}

function L(zh, en) {
  return cur === "en" ? en : zh;
}

module.exports = { setLang, L, getLang: () => cur };
