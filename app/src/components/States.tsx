import Art from "./Art";
import { tr } from "../lib/i18n";
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
        <h1>{tr("还没有会话", "No sessions yet")}</h1>
        <p>
          {tr(
            "选一个项目目录，ClaudeBuddy 会在那里启动 Claude Code，并把这次会话收进左边的列表。",
            "Choose a project folder. ClaudeBuddy starts Claude Code there and adds the session to the list on the left.",
          )}
        </p>
        <div className="ob-acts">
          <button className="btn pri" onClick={onNew}>
            <IconPlus />
            {tr("新建会话", "New session")}
          </button>
          <button className="btn ghost" onClick={onOpenFolder}>
            <IconFolder />
            {tr("打开文件夹", "Open folder")}
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
        <h1>{tr("欢迎使用 ClaudeBuddy", "Welcome to ClaudeBuddy")}</h1>
        <p>
          {tr(
            "给 Claude Code 一个安静的家。每个账号一个独立配置目录，每个项目一个干净的终端。",
            "A quiet home for Claude Code. One config folder per environment, one clean terminal per project.",
          )}
        </p>
        <ol className="steps">
          <li>
            <span>1</span>
            <div>
              <b>{tr("选一个项目目录", "Choose a project folder")}</b>
              <small>
                {tr("终端会在这里启动", "The terminal starts")} <code>claude</code>{tr("", " here")}
              </small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <b>{tr("绑定账号", "Pick an environment")}</b>
              <small>
                {tr("自动建", "Creates")} <code>{tr("~/.claude-<名字>", "~/.claude-<name>")}</code>
                {tr("，互不串号", " automatically, so accounts never mix")}
              </small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <b>{tr("开始会话", "Start a session")}</b>
              <small>{tr("节奏看护默认开启，请求太密会提醒你", "Pace guard is on by default and warns you when requests come too fast")}</small>
            </div>
          </li>
        </ol>
        <div className="ob-acts">
          <button className="btn pri" onClick={onPickFolder}>
            <IconFolder />
            {tr("选择第一个目录", "Choose your first folder")}
          </button>
          <button className="btn ghost" onClick={onSkip}>
            {tr("稍后再说", "Not now")}
          </button>
        </div>
        <div className="ob-foot">
          <span className="kbd">⌘</span>
          <span className="kbd">O</span> {tr("也可以直接拖一个文件夹进来", "or drag a folder in")}
        </div>
      </div>
    </div>
  );
}
