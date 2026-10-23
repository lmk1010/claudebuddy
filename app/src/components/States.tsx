import Art from "./Art";
import { IconFolder, IconPlus } from "./iconAliases";

/** 空状态 —— 设计稿 12 · empty。空不是错误，告诉用户下一步。 */
export function EmptyState({
  onNew,
  onOpenFolder,
}: {
  onNew: () => void;
  onOpenFolder: () => void;
}) {
  return (
    <>
      <div className="wh" />
      <div className="empty">
        <Art name="empty" />
        <h1>还没有会话</h1>
        <p>
          选一个项目目录，ClaudeBuddy 会在那里启动 Claude Code，并把这次会话收进左边的列表。
        </p>
        <div className="ob-acts">
          <button className="btn pri" onClick={onNew}>
            <IconPlus />
            新建会话
          </button>
          <button className="btn ghost" onClick={onOpenFolder}>
            <IconFolder />
            打开文件夹
          </button>
        </div>
        <div className="ob-foot">
          <span className="kbd">⌘</span>
          <span className="kbd">N</span>
        </div>
      </div>
    </>
  );
}

/** 首次启动 —— 设计稿 06 · first run。插画占左半，右半是唯一的陶土按钮。 */
export function Onboarding({
  onPickFolder,
  onSkip,
}: {
  onPickFolder: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="ob">
      <div className="ob-art">
        <Art name="welcome" />
      </div>
      <div className="ob-copy">
        <img className="ob-icon" src="./assets/app-icon.png" alt="" />
        <h1>欢迎使用 ClaudeBuddy</h1>
        <p>
          给 Claude Code 一个安静的家。每个账号一个独立配置目录，每个项目一个干净的终端。
        </p>
        <ol className="steps">
          <li>
            <span>1</span>
            <div>
              <b>选一个项目目录</b>
              <small>
                终端会在这里启动 <code>claude</code>
              </small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <b>绑定账号</b>
              <small>
                自动建 <code>~/.claude-&lt;名字&gt;</code>，互不串号
              </small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <b>开始会话</b>
              <small>节奏看护默认开启，请求太密会提醒你</small>
            </div>
          </li>
        </ol>
        <div className="ob-acts">
          <button className="btn pri" onClick={onPickFolder}>
            <IconFolder />
            选择第一个目录
          </button>
          <button className="btn ghost" onClick={onSkip}>
            稍后再说
          </button>
        </div>
        <div className="ob-foot">
          <span className="kbd">⌘</span>
          <span className="kbd">O</span> 也可以直接拖一个文件夹进来
        </div>
      </div>
    </div>
  );
}
