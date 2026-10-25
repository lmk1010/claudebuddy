/**
 * 节点清单 —— 读代理软件的配置，把里面的节点列出来给人选。
 *
 * 为什么需要这一层：
 * `proxydetect` 只能回答「哪个端口能通」，但一个 mihomo 实例通常只有一个
 * `mixed-port`，几十个节点全挤在它后面。要让两个环境走不同 IP，必须先把
 * 节点拆成多个端口（mihomo 的 `listeners`），而拆之前得先知道有哪些节点、
 * 哪些适合当独立出口。
 *
 * 两条硬规矩：
 *   1. **只读 name / type / server，绝不读 password**。配置文件里每个节点都
 *      带凭据，一旦进了渲染层就等于泄漏到界面和日志里。
 *   2. 只读不改。写入配置是另一步，需要用户确认且必须先备份。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { L } = require("./i18n.cjs");

const HOME = os.homedir();
const APP_SUPPORT = path.join(HOME, "Library", "Application Support");

/**
 * 已知的代理软件，以及它们把「当前生效配置」放在哪。
 *
 * 每个条目给一个 find() —— 因为不同版本目录名会变，写死路径迟早失效，
 * 让每个软件自己去找反而稳。
 */
const APPS = [
  {
    id: "sparkle",
    name: "Sparkle",
    dir: path.join(APP_SUPPORT, "sparkle"),
    /** Sparkle 把「当前选中的订阅 id」写在 profile.yaml 的 current 字段 */
    find(dir) {
      const prof = path.join(dir, "profile.yaml");
      if (!fs.existsSync(prof)) return null;
      const id = readCurrentProfile(prof);
      if (!id) return null;
      const f = path.join(dir, "profiles", `${id}.yaml`);
      return fs.existsSync(f) ? { config: f, base: path.join(dir, "mihomo.yaml") } : null;
    },
  },
  {
    id: "clash-verge",
    name: "Clash Verge",
    dir: path.join(APP_SUPPORT, "io.github.clash-verge-rev.clash-verge-rev"),
    find(dir) {
      // Verge 的生效配置是 profiles 里最新的那个 yaml
      const p = path.join(dir, "profiles");
      const f = newestYaml(p);
      return f ? { config: f, base: null } : null;
    },
  },
  {
    id: "clashx",
    name: "ClashX",
    dir: path.join(APP_SUPPORT, "com.w2s.ClashX"),
    find(dir) {
      const f = path.join(dir, "config.yaml");
      return fs.existsSync(f) ? { config: f, base: null } : null;
    },
  },
  {
    id: "clashx-pro",
    name: "ClashX Pro",
    dir: path.join(APP_SUPPORT, "com.west2online.ClashXPro"),
    find(dir) {
      const f = path.join(dir, "config.yaml");
      return fs.existsSync(f) ? { config: f, base: null } : null;
    },
  },
  {
    id: "mihomo-party",
    name: "Mihomo Party",
    dir: path.join(APP_SUPPORT, "mihomo-party"),
    find(dir) {
      const f = newestYaml(path.join(dir, "profiles"));
      return f ? { config: f, base: null } : null;
    },
  },
];

function newestYaml(dir) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => path.join(dir, f))
      .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return files[0]?.f ?? null;
  } catch {
    return null;
  }
}

/** 从 Sparkle 的 profile.yaml 里读出 current 订阅 id */
function readCurrentProfile(file) {
  try {
    const m = fs.readFileSync(file, "utf8").match(/^current:\s*(\S+)\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * 按名字判断节点类型。
 *
 * 这不是猜着玩：住宅 IP 和机房 IP 在风控里权重完全不同，
 * 而订阅命名通常就写明了（家宽 / 住宅 / RESI / VPS / 链式）。
 * 判不出来就老实标「其他」，不要瞎归类。
 */
function classify(name) {
  const n = name.toLowerCase();
  // 住宅优先：链式节点里也可能带住宅，但「住宅」这个属性更关键
  if (/家宽|住宅|resi|residential|原生|家庭宽带/.test(n)) return "residential";
  if (/链式|relay|chain|中转|落地/.test(n)) return "chained";
  if (/vps|机房|idc|cn2|云|cloud|azure|aws|gcp/.test(n)) return "datacenter";
  return "other";
}

/**
 * 解析 `proxies:` 段，只取三个字段。
 *
 * 手写行级解析而不是上 YAML 库，有两个理由：
 *   · 不引入依赖（配置文件里是别人的数据，少一个解析器少一份风险）
 *   · 只取需要的行，password / uuid 那些压根不进内存
 */
function parseNodes(text) {
  const nodes = [];
  let inProxies = false;
  let cur = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");

    // 进入 / 离开 proxies 段
    if (/^proxies:\s*$/.test(line)) {
      inProxies = true;
      continue;
    }
    if (inProxies && /^[a-zA-Z][\w-]*:\s*$/.test(line)) {
      inProxies = false;
      cur = null;
      continue;
    }
    if (!inProxies) continue;

    const name = line.match(/^\s{2}-\s+name:\s*"?([^"]+?)"?\s*$/);
    if (name) {
      cur = { name: name[1] };
      nodes.push(cur);
      continue;
    }
    if (!cur) continue;

    const type = line.match(/^\s{4}type:\s*"?([^"\s]+)"?/);
    if (type) {
      cur.type = type[1];
      continue;
    }
    const server = line.match(/^\s{4}server:\s*"?([^"\s]+)"?/);
    if (server) cur.server = server[1];
  }

  return nodes.map((n) => ({
    name: n.name,
    type: n.type || "unknown",
    server: n.server || "",
    kind: classify(n.name),
  }));
}

/** 解析已有的 listeners（用户可能已经手动配过几个） */
function parseListeners(text) {
  const out = [];
  let inL = false;
  let cur = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (/^listeners:\s*$/.test(line)) {
      inL = true;
      continue;
    }
    if (inL && /^[a-zA-Z][\w-]*:\s*$/.test(line)) {
      inL = false;
      cur = null;
      continue;
    }
    if (!inL) continue;

    const name = line.match(/^\s{2}-\s+name:\s*"?([^"]+?)"?\s*$/);
    if (name) {
      cur = { name: name[1] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const port = line.match(/^\s{4}port:\s*(\d+)/);
    if (port) cur.port = Number(port[1]);
    const proxy = line.match(/^\s{4}proxy:\s*"?([^"\s]+)"?/);
    if (proxy) cur.proxy = proxy[1];
    const type = line.match(/^\s{4}type:\s*"?([^"\s]+)"?/);
    if (type) cur.type = type[1];
  }
  return out.filter((l) => l.port);
}

/** 读 mixed-port / port，判断这个实例现在开了几个入口 */
function parsePorts(text) {
  const get = (k) => {
    const m = text.match(new RegExp(`^${k}:\\s*(\\d+)`, "m"));
    return m ? Number(m[1]) : 0;
  };
  return { mixed: get("mixed-port"), http: get("port"), socks: get("socks") };
}

/**
 * 探测：找出正在用的代理软件、它的节点、已有入口。
 *
 * 返回的节点里没有密码，也没有任何凭据字段。
 */
function detect() {
  for (const app of APPS) {
    if (!fs.existsSync(app.dir)) continue;
    let found;
    try {
      found = app.find(app.dir);
    } catch {
      found = null;
    }
    if (!found) continue;

    let text;
    try {
      text = fs.readFileSync(found.config, "utf8");
    } catch {
      continue;
    }

    const nodes = parseNodes(text);
    if (nodes.length === 0) continue;

    // 入口端口可能写在基础配置里（Sparkle 的 mihomo.yaml），也可能在同一份文件
    let baseText = "";
    if (found.base && fs.existsSync(found.base)) {
      try {
        baseText = fs.readFileSync(found.base, "utf8");
      } catch {
        /* 读不到就当没有 */
      }
    }

    return {
      app: app.name,
      appId: app.id,
      configPath: found.config,
      profileName: path.basename(found.config, ".yaml"),
      nodes,
      listeners: parseListeners(text),
      ports: parsePorts(baseText || text),
    };
  }

  return null;
}

/** 给界面用的一句话总结 */
function summary(d) {
  if (!d) {
    return L(
      "没找到正在使用的代理软件。没装代理就选「直连」；装了但没被识别，可以在下面手动填端口。",
      "No proxy app detected. Choose Direct if you don't use one, or enter a port manually below.",
    );
  }
  const n = d.nodes.length;
  const resi = d.nodes.filter((x) => x.kind === "residential").length;
  const exits = 1 + d.listeners.length;
  return L(
    `识别到 ${d.app}，共 ${n} 个节点（其中 ${resi} 个住宅 IP）。当前只有 ${exits} 个入口，所有环境都挤在这一个出口上。`,
    `Detected ${d.app} with ${n} nodes (${resi} residential). Only ${exits} entry point(s) right now, so every environment shares one exit.`,
  );
}

module.exports = { detect, summary, classify, parseNodes, parseListeners, parsePorts };
