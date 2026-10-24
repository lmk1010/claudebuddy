/**
 * 首页写的第一句话：建窗口时先放这里，终端真正启动 Claude Code 时取走一次，作为启动参数传进去。
 *
 * 不放进持久化的 state —— 否则下次打开应用恢复会话时，会把这句话再发一遍。
 */
const pending = new Map<string, string>();

export function setPendingPrompt(windowId: string, text: string) {
  if (text.trim()) pending.set(windowId, text.trim());
}

export function takePendingPrompt(windowId: string): string | undefined {
  const t = pending.get(windowId);
  pending.delete(windowId);
  return t;
}
