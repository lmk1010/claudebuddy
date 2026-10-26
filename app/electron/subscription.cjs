/*
 * 订阅 —— 拉下来、存起来、把节点列出来。
 *
 * 三条硬规矩（和 proxynodes.cjs 一致，但这里更严，因为订阅是我们自己存的）：
 *   1. **凭据不出主进程**。节点列表返回给界面的只有 name/type/server/kind，
 *      password / uuid / 私钥这类字段在解析时就丢掉，不往 IPC 上传。
 *   2. 订阅原文存到 userData 下，权限 0600 —— 它包含订阅地址背后的全部凭据。
 *   3. 只读。不帮用户改他别的代理软件的配置，两边互不干扰。
 *
 * 支持的格式：Clash / mihomo 的 YAML 订阅。这是主流机场的通用格式，
 * 也是 mihomo 能直接吃的格式 —— 存下来就能直接用，不需要格式转换。
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const http = require("node:http");
const zlib = require("node:zlib");

const { parseNodes, classify } = require("./proxynodes.cjs");

let BASE = null;

function baseDir() {
  if (BASE) return BASE;
  try {
    BASE = path.join(require("electron").app.getPath("userData"), "subscriptions");
  } catch {
    BASE = path.join(os.homedir(), ".claude-buddy", "subscriptions");
  }
  return BASE;
}

function setBaseDir(dir) {
  BASE = dir;
}

/** 订阅 id：用 URL 的 hash，同一个地址重复添加就是同一条 */
function subId(url) {
  return crypto.createHash("sha256").update(String(url).trim()).digest("hex").slice(0, 12);
}

function fileOf(id) {
  return path.join(baseDir(), `${id}.yaml`);
}

function metaFile() {
  return path.join(baseDir(), "index.json");
}

/** 读订阅索引（地址、名字、刷新时间）。地址本身也算敏感，所以 0600 */
async function readIndex() {
  try {
    const raw = await fsp.readFile(metaFile(), "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeIndex(list) {
  await fsp.mkdir(baseDir(), { recursive: true });
  const f = metaFile();
  await fsp.writeFile(f, JSON.stringify(list, null, 2), { mode: 0o600 });
}

/** 拉一个 URL。跟重定向，解 gzip / deflate（机场经常压） */
function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("重定向次数过多"));
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error("订阅地址不是合法 URL"));
    }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.get(
      url,
      { headers: { "User-Agent": "clash.meta mihomo", Accept: "*/*" }, timeout: 20000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(fetchText(new URL(res.headers.location, url).toString(), redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`订阅返回 HTTP ${res.statusCode}`));
        }
        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        let stream = res;
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
        const chunks = [];
        stream.on("data", (c) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("订阅请求超时")));
    req.on("error", reject);
  });
}

/**
 * 把拿到的文本归一成 YAML。
 *
 * 有些机场给的是 base64 编码的节点列表（v2ray 老格式）。那种我们解析不了，
 * 但也不应该报「订阅无效」就完事 —— 直接说清楚该换什么格式，
 * 否则用户只能干瞪眼。
 */
function normalize(text) {
  const t = String(text || "").trim();
  if (!t) throw new Error("订阅内容是空的");
  if (/^proxies:\s*$/m.test(t) || /^proxy-groups:\s*$/m.test(t)) return t;
  // 可能是 base64 的节点列表
  if (/^[A-Za-z0-9+/=\s]+$/.test(t.slice(0, 200))) {
    try {
      const dec = Buffer.from(t, "base64").toString("utf8");
      if (/^proxies:\s*$/m.test(dec)) return dec;
      if (/^(ss|vmess|vless|trojan|hysteria2?):\/\//m.test(dec)) {
        throw new Error("这个订阅是节点链接列表（base64），不是 Clash 格式。请在机场后台换用「Clash」订阅链接。");
      }
    } catch (e) {
      if (e instanceof Error && /Clash 格式/.test(e.message)) throw e;
    }
  }
  throw new Error("这不是 Clash / mihomo 格式的订阅。请在机场后台复制「Clash」或「Mihomo」订阅链接。");
}

/**
 * 把 proxies 段切成一个个节点块（含凭据）。
 *
 * 这是全应用唯一会碰到节点凭据的地方，返回结果只能用于写实例配置，
 * 绝不能通过 IPC 传出去。
 */
function parseProxyBlocks(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => /^proxies:\s*$/.test(l));
  if (start < 0) return [];

  const blocks = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    // 离开 proxies 段
    if (/^[a-zA-Z][\w-]*:\s*$/.test(l)) break;
    if (/^\s{2}-\s/.test(l)) {
      if (cur) blocks.push(cur);
      cur = [l];
    } else if (cur) {
      cur.push(l);
    }
  }
  if (cur) blocks.push(cur);
  // 去掉尾空行，保证拼进配置时是一个完整的块
  return blocks.map((b) => {
    while (b.length && !b[b.length - 1].trim()) b.pop();
    return b;
  });
}

function blockName(block) {
  const m = block[0].match(/name:\s*"?([^"]+?)"?\s*$/);
  return m ? m[1] : null;
}

/**
 * 取出一个节点，**连同它依赖的节点一起**。
 *
 * 链式节点（`dialer-proxy: 某个入口`）单独拿出来一定起不来 —— mihomo
 * 找不到那个入口节点，报的是一句看不出原因的配置错误。所以跟着依赖
 * 往下走，把一条链上的节点一起带出去。
 *
 * 依赖缺失时**说清楚缺了谁**：机场的链式节点经常只发后半段、
 * 不发入口，这时候用户需要知道"换个节点"，而不是"配置无法启动"。
 */
function nodeBlocks(text, nodeName) {
  const blocks = parseProxyBlocks(text);
  const byName = new Map();
  for (const b of blocks) {
    const n = blockName(b);
    if (n) byName.set(n, b);
  }

  const out = [];
  const seen = new Set();
  const walk = (name, from) => {
    if (seen.has(name)) return;
    seen.add(name);
    const b = byName.get(name);
    if (!b) {
      throw new Error(
        from
          ? `节点「${from}」依赖「${name}」，但订阅里没有这个节点 —— 机场的链式节点经常这样。换一个节点，或者让机场把入口补上。`
          : `订阅里找不到节点「${name}」`,
      );
    }
    const dep = b.join("\n").match(/dialer-proxy:\s*"?([^"\n]+?)"?\s*$/m);
    if (dep) walk(dep[1].trim(), name);
    out.push(b.join("\n"));
  };
  walk(nodeName, null);
  return out;
}

/** 只要一个节点块（不带依赖）。给不关心链路的地方用 */
function nodeBlock(text, nodeName) {
  const blocks = parseProxyBlocks(text);
  const hit = blocks.find((b) => blockName(b) === nodeName);
  return hit ? hit.join("\n") : null;
}

/** 给界面的节点列表：不含任何凭据字段 */
function safeNodes(text) {
  return parseNodes(text).map((n) => ({
    name: n.name,
    type: n.type,
    server: n.server,
    kind: n.kind || classify(n.name),
  }));
}

/** 添加（或重新拉取）一个订阅 */
async function add(url, label) {
  const id = subId(url);
  const text = normalize(await fetchText(url));
  const nodes = safeNodes(text);
  if (nodes.length === 0) throw new Error("订阅里没有解析到任何节点");

  await fsp.mkdir(baseDir(), { recursive: true });
  // 0600：这份文件里有全部节点凭据
  await fsp.writeFile(fileOf(id), text, { mode: 0o600 });

  const index = await readIndex();
  const entry = {
    id,
    url,
    label: label || new URL(url).hostname,
    addedAt: Date.now(),
    updatedAt: Date.now(),
    count: nodes.length,
  };
  const at = index.findIndex((x) => x.id === id);
    if (at >= 0) index[at] = { ...index[at], ...entry, addedAt: index[at].addedAt };
    else index.push(entry);
    await writeIndex(index);

    // 给界面的那份不含 url（里面有 token），只留 host 供辨认
    const { url: _drop, ...safe } = entry;
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      /* 地址有问题不影响把结果给出去 */
    }
    return { sub: { ...safe, host }, nodes };
  }

/**
 * 导入一份本地 YAML —— 文件或粘贴的文本，不经过网络。
 *
 * 和订阅的唯一区别是数据来源。存下来之后完全同路：节点列表、生成实例配置、
 * 提取单节点块，全走同一套。这样「导入本地配置」和「填订阅」在后面的
 * 每一步都没有分叉，不会出现"导入的能看不能用"这种半截状态。
 *
 * id 带 y- 前缀，和订阅（哈希）区分开，出问题时一眼能看出这是哪来的。
 */
async function importText(text, label) {
  const clean = normalize(text);
  const nodes = safeNodes(clean);
  if (nodes.length === 0) throw new Error("这份配置里没有解析到节点");

  const id = `y-${crypto.createHash("sha256").update(`${label}\u0000${text.length}\u0000${Date.now()}`).digest("hex").slice(0, 10)}`;
  await fsp.mkdir(baseDir(), { recursive: true });
  await fsp.writeFile(fileOf(id), clean, { mode: 0o600 });

  const entry = {
    id,
    url: "",
    source: "file",
    label: label || "导入的配置",
    addedAt: Date.now(),
    updatedAt: Date.now(),
    count: nodes.length,
  };
  const index = await readIndex();
  index.push(entry);
  await writeIndex(index);

  const { url: _drop, ...safe } = entry;
  return { sub: { ...safe, host: "" }, nodes };
}

/**
 * 重新拉一次（节点会变，地址不变）。
 *
 * 导入的配置没有可刷新的地址 —— 说清楚，而不是让用户点半天没反应。
 */
async function refresh(id) {
  const index = await readIndex();
  const entry = index.find((x) => x.id === id);
  if (!entry) throw new Error("订阅不存在");
  if (!entry.url) throw new Error("这是导入的本地配置，没有可刷新的地址。重新导入一份即可更新。");
  return add(entry.url, entry.label);
}

async function remove(id) {
  const index = await readIndex();
  await writeIndex(index.filter((x) => x.id !== id));
  await fsp.rm(fileOf(id), { force: true });
  return { ok: true };
}

/**
 * 所有订阅 + 各自节点。
 *
 * 返回前把 url 换成 host：订阅地址里带着机场的 token，进了渲染层
 * 就等于写进界面状态和日志。界面只需要一个能认出来的名字，
 * 完整地址留在主进程（refresh 用）。
 */
async function list() {
  const index = await readIndex();
  return index.map((s) => {
    let nodes = [];
    try {
      nodes = safeNodes(fs.readFileSync(fileOf(s.id), "utf8"));
    } catch {
      /* 文件被删了就当没节点，界面上会显示为空 */
    }
    let host = "";
    try {
      host = new URL(s.url).hostname;
    } catch {
      /* 地址坏了也不影响列出来 */
    }
    const { url, ...rest } = s;
    // 订阅 / 本地导入：界面要分开显示，前者能刷新，后者要重新导入
    return { ...rest, source: s.source === "file" ? "file" : "sub", host, nodes };
  });
}

/** 读订阅原文（内部用） */
async function readText(id) {
  return fsp.readFile(fileOf(id), "utf8");
}

module.exports = {
  setBaseDir,
  baseDir,
  subId,
  fetchText,
  normalize,
  nodeBlock,
    nodeBlocks,
    safeNodes,
  add,
  importText,
  refresh,
  remove,
  list,
  readText,
};
