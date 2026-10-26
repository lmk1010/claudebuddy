/**
 * 检测确认闸门。
 *
 * 每一次「往外发请求」的检测都必须经过这里 —— 因为检测本身是有代价的：
 *
 *   · 它会把**当前出口 IP** 暴露给第三方站点（ip-api、proxycheck、ipify…），
 *     那些站点会记录来源地址。一个号在短时间里从多个站点被"探测"，
 *     本身就是一类可观测的活动。
 *   · 体检还会直接打 api.*，那是真正带着这个环境身份的请求。
 *   · 环境自检会连 cloudflare-dns / dns.google，也会留下查询记录。
 *
 * 所以这里不做"默认允许 + 可关掉"，而是反过来：**默认不检测，用户点头才发**。
 * 界面上的任何自动检测都必须去掉 —— 自动发请求和"确认后才知道"是矛盾的。
 *
 * 用法：
 *   if (!(await askDetect({ ... }))) return;   // 用户拒绝
 *
 * 由一个 <DetectGate /> 组件挂在根部渲染弹窗；这里只负责排队与解析 Promise。
 * 同一时刻只问一次：多个入口同时发起检测时合并成一个询问，
 * 要么都放行、要么都拒绝 —— 连着弹三次同一个问题只会让人乱点。
 */

export type DetectAsk = {
  /** 会访问的外部站点，逐条列出，不要笼统写"第三方接口" */
  targets: string[];
  /** 这次检测会暴露什么 */
  exposes: string;
  /** 为什么需要它 —— 让用户能判断值不值得 */
  why: string;
  /** 一次性的口令，同一次询问里多个调用方共享 */
  key?: string;
};

type Pending = {
  ask: DetectAsk;
  resolve: (v: boolean) => void;
};

/** 当前正在问的，以及后面排队的 */
let pending: Pending | null = null;
const queue: Pending[] = [];
const watchers = new Set<(a: DetectAsk | null) => void>();

function emit() {
  // 对外只给询问内容，不把 resolve 这种内部结构泄露给界面
  watchers.forEach((f) => f(pending ? pending.ask : null));
}

function next() {
  pending = queue.shift() ?? null;
  emit();
}

/**
 * 组件订阅当前待确认的询问。
 *
 * 一次只问一个。**不做合并** —— 合并会把两件不同的检测塞进同一个询问里，
 * 用户看到的可能只是其中一件，却把另一件也放行了。那这个确认就形同虚设。
 * 排队依次问，每件都看得清。
 */
export function subscribeDetect(f: (a: DetectAsk | null) => void) {
  watchers.add(f);
  f(pending ? pending.ask : null);
  return () => {
    watchers.delete(f);
  };
}

/** 用户做了选择（由弹窗调用） */
export function resolveDetect(allow: boolean) {
  const p = pending;
  if (!p) return;
  next();
  p.resolve(allow);
}

/**
 * 请求一次检测的许可。
 *
 * 返回 false 表示用户拒绝 —— 调用方**必须**直接返回，不能"那我还是测一下吧"。
 * 拒绝是明确的指令，不是建议。
 */
export function askDetect(ask: DetectAsk): Promise<boolean> {
  return new Promise((resolve) => {
    const item: Pending = { ask, resolve };
    if (pending) queue.push(item);
    else {
      pending = item;
      emit();
    }
  });
}

/** 主动撤回所有等待（比如窗口关了）—— 一律按拒绝处理，安全的那一边 */
export function cancelAllDetect() {
  const p = pending;
  const rest = queue.splice(0);
  pending = null;
  emit();
  p?.resolve(false);
  rest.forEach((r) => r.resolve(false));
}
