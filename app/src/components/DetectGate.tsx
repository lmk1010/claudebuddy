import { useEffect, useRef, useState } from "react";
import { tr } from "../lib/i18n";
import { resolveDetect, subscribeDetect, type DetectAsk } from "../lib/detect";
import Modal from "./Modal";
import { IconWarning } from "./iconAliases";

/**
 * 检测确认弹窗 —— 挂在根部，全应用共用一个。
 *
 * 每个会往外发请求的检测在发之前都会走到这里。弹窗要把三件事说清，
 * 否则"确认"就只是走过场：
 *
 *   ① 会连哪些站点（逐条列，不写"第三方接口"）
 *   ② 会暴露什么（出口 IP、归属，那些站点会记录来源地址）
 *   ③ 为什么要测（不测的后果是什么）
 *
 * 默认焦点在**取消**上：这个弹窗存在的意义是让人多想一想，
 * 不是催人快点同意。回车 = 取消。
 */
export default function DetectGate() {
  const [ask, setAsk] = useState<DetectAsk | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeDetect(setAsk), []);

  useEffect(() => {
    if (ask) cancelRef.current?.focus();
  }, [ask]);

  if (!ask) return null;

  return (
    <Modal
      onClose={() => resolveDetect(false)}
      className="dgate"
      label={tr("确认这次检测", "Confirm this check")}
      onEnter={() => resolveDetect(false)}
    >
      {(close) => (
        <>
          <div className="dgate-h">
            <IconWarning size={15} />
            <b>{tr("这次检测会往外发请求", "This check sends requests out")}</b>
          </div>

          <p className="dgate-why">{ask.why}</p>

          <div className="dgate-sec">
            <span>{tr("会连这些站点", "It contacts")}</span>
            <div className="dgate-targets">
              {ask.targets.map((t) => (
                <code key={t} className="mono">
                  {t}
                </code>
              ))}
            </div>
          </div>

          <div className="dgate-sec">
            <span>{tr("会暴露", "It reveals")}</span>
            <p className="dgate-expose">{ask.exposes}</p>
          </div>

          <div className="dgate-foot">
            <span className="dgate-note">
              {tr(
                "不检测不会有任何请求发出，也不影响会话正常使用。",
                "If you skip it, nothing is sent and sessions keep working.",
              )}
            </span>
            <button ref={cancelRef} className="btn ghost" onClick={() => resolveDetect(false)}>
              {tr("取消", "Cancel")}
            </button>
            <button
              className="btn"
              onClick={() => {
                resolveDetect(true);
                close();
              }}
            >
              {tr("开始检测", "Run the check")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}