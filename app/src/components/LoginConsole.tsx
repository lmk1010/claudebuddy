import { useEffect, useRef, useState } from "react";
import { IconArrowRight, IconCheck } from "./iconAliases";
import { tr } from "../lib/i18n";

/**
 * 登录控制台 —— 登录这一步真正的闭环在这里。
 *
 * 实测 `claude auth login` 的行为：打印授权 URL 之后停在
 * `Paste code here if prompted >` 等输入。所以只把输出显示出来是不够的，
 * 用户拿到的授权码必须有地方贴回来，否则流程断在最后一步。
 *
 * 这里做三件事：
 *   1. 实时显示 CLI 输出（URL 就在里面，顺手做成可点）
 *   2. 提供一个输入框，回车把码写进同一个 PTY
 *   3. 登录成功后由上层轮询 account:status 判定，不在这里猜
 */
export default function LoginConsole({
  termId,
  signedIn,
  onCancel,
}: {
  termId: string;
  signedIn: boolean;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const boxRef = useRef<HTMLPreElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const off = window.claudeBuddy.onTermData((p) => {
      if (p.id !== termId) return;
      setText((prev) => (prev + p.data).slice(-12000));
    });
    return off;
  }, [termId]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [text]);

  // CLI 一停下来等输入，就把焦点放到码的输入框上
  useEffect(() => {
    if (text.includes("Paste code") && !signedIn) {
      inputRef.current?.focus();
    }
  }, [text, signedIn]);

  const clean = text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "");

  const url = clean.match(/https?:\/\/[^\s"'<>)]+/)?.[0] ?? null;
  const waitingForCode = /Paste code[^\n]*>/i.test(clean);

  // CLI 如果压根没起来（命令不存在、HOME 不对），输出会一直是空的。
  // 空等是最糟的体验：给一个明确的失败提示，别让人对着空白屏猜。
  const [silentTooLong, setSilentTooLong] = useState(false);
  useEffect(() => {
    if (clean || signedIn) {
      setSilentTooLong(false);
      return;
    }
    const t = setTimeout(() => setSilentTooLong(true), 6000);
    return () => clearTimeout(t);
  }, [clean, signedIn]);

  const submit = () => {
    const v = code.trim();
    if (!v) return;
    window.claudeBuddy.writeTerm(termId, v + "\r");
    setCode("");
    setSent(true);
  };

  return (
    <div className="login-console">
      <pre className="ob-term selectable" ref={boxRef}>
        {clean || (silentTooLong ? "" : tr("正在启动授权流程…", "Starting the authorization flow…"))}
      </pre>

      {silentTooLong && !clean && !signedIn && (
        <div className="det-warn">
          <span>
            {tr("CLI 没有任何输出。多半是 ", "The CLI produced no output. Most likely the ")}
            <code>claude</code>
            {tr(
              " 命令不在 PATH 上，或者这个环境的配置目录不可用。先在终端里手动跑一次 ",
              " command is not on PATH, or this environment's config folder is unavailable. Run ",
            )}
            <code>claude auth login</code>
            {tr(" 确认能起来。", " manually in a terminal to check that it starts.")}
          </span>
        </div>
      )}

      {url && !signedIn && (
        <div className="login-url-row">
          <button
            className="btn"
            onClick={() => {
              // 点开就真的在系统浏览器里打开 —— 复制只是附带的便利
              void navigator.clipboard.writeText(url).catch(() => {});
              window.claudeBuddy.openExternal?.(url);
            }}
            title={url}
          >
            {tr("在浏览器中打开授权页", "Open authorization page in browser")}
          </button>
          <span className="in-cap">{tr("登录后复制返回的授权码，贴到下面", "After signing in, copy the returned code and paste it below")}</span>
        </div>
      )}

      {waitingForCode && !signedIn && (
        <div className="login-code-row">
          <input
            ref={inputRef}
            className="ob-input"
            value={code}
            placeholder={tr("把授权码粘贴到这里，回车提交", "Paste the code here and press Enter")}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            className={code.trim() ? "btn pri" : "btn"}
            disabled={!code.trim()}
            onClick={submit}
          >
            {tr("提交", "Submit")}
            {code.trim() ? <IconArrowRight /> : null}
          </button>
        </div>
      )}

      {sent && !signedIn && (
        <div className="ob-wait" style={{ marginTop: 8 }}>
          <span className="spinner" />
          {tr("已提交，正在校验…", "Submitted, verifying…")}
        </div>
      )}

      {signedIn && (
        <div className="ob-ok" style={{ marginTop: 10, marginBottom: 0 }}>
          <IconCheck />
          <div>
            <b>{tr("登录成功", "Signed in")}</b>
            <small>{tr("凭据已写进这个环境自己的目录", "Credentials were saved to this environment's own folder")}</small>
          </div>
        </div>
      )}

      {!signedIn && onCancel && (
        <div style={{ marginTop: 2 }}>
          <button className="btn ghost" onClick={onCancel} style={{ height: 28, fontSize: 12 }}>
            {tr("取消登录", "Cancel sign in")}
          </button>
        </div>
      )}
    </div>
  );
}
