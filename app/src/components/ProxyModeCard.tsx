import { tr } from "../lib/i18n";
import type { Exit, ProxyMode } from "../lib/model";
import { PROXY_MODES } from "../lib/model";

/**
 * 代理方式 —— 一行，不是三张大卡片。
 *
 * 上一版把三种方式做成三张带说明文字的卡片，首屏被它占掉一大半，
 * 真正要操作的出口列表被挤到下面，每次都得滚下去。
 *
 * 方式只是出口的一个属性（出口自己就标着"App 托管 / 你自己的"），
 * 一行 segmented 足够说清，"当前是哪种"由选中态表达，不再重复一遍。
 * 描述文字挪进 title，鼠标停上去才出现，不占版面。
 */
export default function ProxyModeCard({
  mode,
  onPick,
  exits,
  busy,
}: {
  mode: ProxyMode;
  onPick: (m: ProxyMode) => void;
  exits: Exit[];
  /** 正在启动托管实例之类，禁用避免连点 */
  busy?: boolean;
}) {
  /** 这种方式下已经配好的出口有几个 —— 数字直接标在按钮上，省一句"还没有" */
  const countOf = (m: ProxyMode) =>
    m === "direct" ? 0 : exits.filter((e) => (m === "managed" ? Boolean(e.managed) : !e.managed)).length;

  return (
    <div className="pm">
      <span className="pm-k">{tr("代理方式", "Proxy mode")}</span>
      <div className="seg pm-seg">
        {PROXY_MODES.map((m) => {
          const n = countOf(m.id);
          return (
            <button
              key={m.id}
              className={mode === m.id ? "on" : ""}
              disabled={busy}
              onClick={() => onPick(m.id)}
              title={tr(m.dzh, m.den)}
            >
              {tr(m.zh, m.en)}
              {m.id !== "direct" && n > 0 && <small>{n}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}