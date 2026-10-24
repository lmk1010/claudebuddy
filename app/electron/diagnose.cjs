/**
 * 连通性归因 —— "403 到底是哪一层挡的"。
 *
 * 一个请求被拒，可能是四个完全不同的层，处理方式毫无交集：
 *   1. 网络层   出口 IP 的 ASN / 信誉，或 TLS 指纹被判定为脚本
 *   2. 挑战层   Cloudflare 的 bot 挑战（cf-mitigated: challenge）
 *   3. 账号层   账号被 hold / restricted，判定挂在 accountUuid 上
 *   4. 用量层   时间窗口额度耗尽（5 小时 / 每周）
 *
 * 猜是不行的 —— 猜错方向会让人去换 IP 而其实该去申诉，或者反过来。
 * 所以这里每一条都真发请求，按响应头与响应体判定，并明确区分
 * "实测到的事实" 和 "没测到的推断"。
 *
 * 设计原则：
 *   · 只报告能观察到的东西，推断一律标 unverified。
 *   · 每层给出 oneLiner：这层通不通、该做什么。
 *   · 任何一步失败都不能让整个检查崩掉。
 */

const https = require("node:https");
const http = require("node:http");

/** 探测目标：每个代表一种可能失败的层 */
const PROBES = {
  /** 任意被 Cloudflare 保护但不需要登录的站 —— 判断网络层是否整体可行 */
  control: { url: "https://www.cloudflare.com/cdn-cgi/trace", host: "www.cloudflare.com" },
  /** Claude 的主站：最容易看出挑战层 */
  claude: { url: "https://claude.ai/", host: "claude.ai" },
  /**
   * 关键判据：bootstrap 是 CLI 登录后必调、且对 UA 极其敏感的端点。
   * 实测（2026-10-23，同一 IP / 同一 TLS）：
   *   claude-cli UA → 403 challenge ；Chrome UA → 200 JSON
   * 这是「CLI 授权成功但登录 403」的确切卡点。
   */
  bootstrap: { url: "https://claude.ai/api/bootstrap", host: "claude.ai" },
  /** OAuth 授权入口（新域名）：授权时会经过 */
  authorize: {
    url: "https://platform.claude.com/oauth/authorize",
    host: "platform.claude.com",
  },
  /** 换 token 端点：JSON API，实测不挑 UA */
  token: { url: "https://platform.claude.com/v1/oauth/token", host: "platform.claude.com" },
  /** 推理端点：账号 hold 在这里暴露 */
  api: { url: "https://api.anthropic.com/v1/messages", host: "api.anthropic.com" },
};

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CLI_UA = "claude-cli/2.1.309 (external, cli)";

/**
 * 发一次 GET，只要状态码、关键响应头和响应体前缀。
 *
 * 刻意不跟随重定向：302 本身是信息（比如 claude.ai 对未登录用户的引导），
 * 跟过去会把真正的判定点掩盖掉。
 */
function probe(name, { url, host }, timeout = 12000, ua = BROWSER_UA) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    let req;
    try {
      req = https.request(
        url,
        {
          method: "GET",
          timeout,
          headers: {
            // UA 可切换。默认用浏览器 UA：先在「最有利」的条件下测，
            // 这样如果仍然被挑战，才说明问题比 UA 更深。
            "user-agent": ua,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => {
            // 只需前 4KB 就能看出是挑战页还是 JSON 错误
            if (body.length < 4096) body += c;
          });
          res.on("end", () => {
            done({
              ok: true,
              status: res.statusCode,
              headers: {
                server: res.headers.server ?? null,
                cfRay: res.headers["cf-ray"] ?? null,
                cfMitigated: res.headers["cf-mitigated"] ?? null,
                contentType: res.headers["content-type"] ?? null,
                location: res.headers.location ?? null,
              },
              body: body.slice(0, 4000),
            });
          });
        }
      );
    } catch (e) {
      return done({ ok: false, error: e.message });
    }

    req.on("timeout", () => {
      req.destroy();
      done({ ok: false, error: "超时" });
    });
    req.on("error", (e) => done({ ok: false, error: e.code || e.message }));
    req.end();
  });
}

/** 从响应体里认出 Cloudflare 挑战页 */
function isChallenge(r) {
  if (!r.ok) return false;
  if (r.headers.cfMitigated === "challenge") return true;
  const b = r.body || "";
  return b.includes("Just a moment") || b.includes("Performing security verification");
}

/** 从响应体里认出账号层错误 */
function detectAccountHold(r) {
  const b = (r.body || "").toLowerCase();
  if (b.includes("account_on_hold")) return "account_on_hold";
  if (b.includes("your account is on hold")) return "account_on_hold";
  if (b.includes("on hold and can't use claude code")) return "account_on_hold";
  if (b.includes("has been disabled") || b.includes("account_disabled")) return "account_disabled";
  return null;
}

/** 从响应体里认出用量层错误 */
function detectRateLimit(r) {
  const b = (r.body || "").toLowerCase();
  if (r.status === 429) return "rate_limit";
  if (b.includes("rate_limit_error")) return "rate_limit";
  if (b.includes("usage limit")) return "usage_limit";
  return null;
}

/** 读 exit IP 的归属信息：ASN 与是否住宅，这是网络层的第一道判据 */
function lookupIp() {
  return new Promise((resolve) => {
    const req = http.get(
      "http://ip-api.com/json/?fields=status,country,regionName,city,isp,org,as,asname,hosting,proxy,mobile,query",
      { timeout: 8000 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ ok: true, ...JSON.parse(body) });
          } catch {
            resolve({ ok: false, error: "返回格式不对" });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "超时" });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.code || e.message }));
  });
}

/** proxycheck.io 对这个 IP 的类型与风险分（第二个独立来源）。拿不到返回 null */
function lookupRisk(ipAddr) {
  return new Promise((resolve) => {
    const req = https.get(`https://proxycheck.io/v2/${ipAddr}?vpn=1&risk=1&asn=1`, { timeout: 8000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          const d = JSON.parse(body)[ipAddr];
          resolve(d ? { type: d.type || "", risk: Number(d.risk ?? 0), proxy: d.proxy === "yes" } : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

/**
 * 归因。
 *
 * 判定顺序即处理优先级：先排除网络/挑战层，再谈账号与用量。
 * 只有确认前面的层都通，后面层的错误码才有意义。
 */
async function diagnose() {
  const [ip, control, claude, bootstrapBrowser, bootstrapCli, authorize, token, api] = await Promise.all([
    lookupIp(),
    probe("control", PROBES.control),
    probe("claude", PROBES.claude),
    probe("bootstrap", PROBES.bootstrap, 12000, BROWSER_UA),
    probe("bootstrap", PROBES.bootstrap, 12000, CLI_UA),
    probe("authorize", PROBES.authorize),
    probe("token", PROBES.token),
    probe("api", PROBES.api),
  ]);

  const layers = [];

  /* ── 层 1：网络 ── */
  const ipOk = ip.ok && ip.status === "success";
  /**
   * 只报数据源真实给出的结论，不按名字猜。
   * 之前看 ISP 名里带 "Hosting" 就判机房，可同一个 IP 在 ip-api 是 hosting:false、
   * 在 proxycheck 是 Residential —— 名字只是公司名，不是线路类型。两个来源各说各的，照实列出来。
   */
  const risk = ipOk ? await lookupRisk(ip.query) : null;
  const flaggedProxy = ipOk && (ip.proxy === true || Boolean(risk?.proxy));
  const flaggedHosting = ipOk && (ip.hosting === true || /hosting|business|data ?cent/i.test(risk?.type || ""));
  const sources = ipOk
    ? [
        `ip-api：${ip.proxy ? "代理" : ip.hosting ? "机房" : ip.mobile ? "移动网络" : "非机房"}`,
        risk ? `proxycheck：${risk.type || "未知类型"} · 风险 ${risk.risk}/100${risk.proxy ? " · 标记为代理" : ""}` : "proxycheck：没查到",
      ].join("；")
    : "";
  layers.push({
    id: "network",
    label: "本机直连出口",
    status: !ipOk ? "unknown" : flaggedProxy ? "fail" : flaggedHosting ? "warn" : "ok",
    detail: ipOk
      ? `${ip.query} · ${ip.as || ip.isp || "?"} · ${ip.city || ""} ${ip.country || ""} · ${sources}`
      : "查不到出口归属",
    note: ipOk
      ? flaggedProxy
        ? "有数据源把这个 IP 标成了代理 / VPN，风控里分数会很差。"
        : flaggedHosting
          ? "有数据源把这个 IP 归为机房 / 企业线路。"
          : "两个数据源都没把它标成机房或代理。"
      : "无法判定。",
  });

  /* ── 层 2：挑战（含 UA 对照实验） ── */
  const controlChallenge = isChallenge(control);
  const claudeChallenge = isChallenge(claude);
  const authChallenge = isChallenge(authorize);
  const tokenChallenge = isChallenge(token);
  const bootBrowserChallenge = isChallenge(bootstrapBrowser);
  const bootCliChallenge = isChallenge(bootstrapCli);

  /**
   * UA 对照实验，本模块最核心的一条结论。
   *
   * 同一台机器、同一个出口、同一套 TLS 栈，只换 User-Agent：
   * 主站从 403 challenge 变成正常响应，就说明这次的拦截挂在 UA 上，
   * 不是 TLS 指纹、不是 IP 信誉、更不是账号。
   */
  const uaMatters =
    bootstrapBrowser.ok && !bootBrowserChallenge && bootCliChallenge;

  let challengeStatus = "ok";
  let challengeNote = "没有观察到 Cloudflare 挑战页。";
  if (!control.ok || control.error) {
    challengeStatus = "unknown";
    challengeNote = `对照组请求失败（${control.error || "未知"}），无法区分是全网不通还是单站拦截。`;
  } else if (controlChallenge) {
    challengeStatus = "fail";
    challengeNote = "连对照组都被挑战，说明整个出口在这个网络层被判为可疑。";
  } else if (uaMatters) {
    challengeStatus = "warn";
    challengeNote =
      "确认：拦的是 User-Agent，不是 IP 也不是 TLS 指纹。" +
      "同一个请求换成浏览器 UA 就通了 —— 这正是 Claude Code 登录时 403 的成因。" +
      "它自己的 UA 是 claude-cli/…，被 claude.ai 的 bot 规则直接挑战。";
  } else if (claudeChallenge || authChallenge || tokenChallenge) {
    challengeStatus = "warn";
    challengeNote =
      "对照组正常，但 Claude 的域名返回了挑战页。通常由出口 IP 信誉或客户端指纹触发，" +
      "与账号内容无关。用真实浏览器打开同一页面可对照。";
  }
  layers.push({
    id: "challenge",
    label: "Bot 挑战",
    status: challengeStatus,
    detail: [
      `对照 ${control.ok ? control.status : "-"}`,
      `主站 ${claude.ok ? claude.status : "-"}${claudeChallenge ? "(挑战)" : ""}`,
      `bootstrap[浏览器UA] ${bootstrapBrowser.ok ? bootstrapBrowser.status : "-"}${bootBrowserChallenge ? "(挑战)" : ""}`,
      `bootstrap[CLI UA] ${bootstrapCli.ok ? bootstrapCli.status : "-"}${bootCliChallenge ? "(挑战)" : ""}`,
    ].join(" · "),
    note: challengeNote,
  });

  /* ── 层 3：账号 ── */
  const hold = detectAccountHold(api) || detectAccountHold(token);
  layers.push({
    id: "account",
    label: "账号状态",
    status: hold ? "fail" : api.ok ? "ok" : "unknown",
    detail: hold
      ? `命中 ${hold}`
      : api.ok
        ? `推理端点返回 ${api.status}`
        : `推理端点不可达（${api.error || "未知"}）`,
    note: hold
      ? "账号被限制。这一层换 IP、换浏览器、换指纹都无效，只能在账号侧处理。"
      : api.ok && (api.status === 401 || api.status === 403)
        ? "推理端点要鉴权，401/403 属于预期（这里没带 token）。不代表账号被限制。"
        : "未观察到账号层限制。",
  });

  /* ── 层 4：用量 ── */
  const rl = detectRateLimit(api) || detectRateLimit(token);
  layers.push({
    id: "quota",
    label: "用量额度",
    status: rl ? "warn" : "ok",
    detail: rl ? `命中 ${rl}` : "未观察到用量限制",
    note: rl
      ? "时间窗口额度用尽，等窗口重置即可，不是封号。"
      : "未观察到限流。",
  });

  /* ── 总结论 ──
   * 优先级：fail 永远最优先；同为 warn 时按「能直接解释 403 的程度」排序，
   * 挑战层高于网络层 —— 机房 IP 只是土壤，UA 判定才是这次的直接原因。 */
  const ORDER = { challenge: 0, account: 1, quota: 2, network: 3 };
  const failed = layers.filter((l) => l.status === "fail");
  const warned = layers
    .filter((l) => l.status === "warn")
    .sort((a, b) => (ORDER[a.id] ?? 9) - (ORDER[b.id] ?? 9));
  const blocker = failed[0] || warned[0] || null;

  const headline = !blocker
    ? "四层都通。当前的 403 若仍出现，只可能来自未覆盖的环节（如登录态 cookie 失效）。"
    : blocker.id === "challenge"
      ? uaMatters
        ? "主因是 User-Agent 判定：CLI 自己的 UA 被 Claude 的 bot 规则挑战，浏览器 UA 则放行。"
        : "主因在网络/挑战层：用真实浏览器对照一次即可确认。"
      : blocker.id === "account"
        ? "主因在账号层：换网络与指纹都无效，需要账号侧处理。"
        : blocker.id === "quota"
          ? "主因在用量层：等窗口重置。"
          : "主因在网络出口：先换一个出口再测。";

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    exitIp: ipOk ? { ip: ip.query, asn: ip.as, isp: ip.isp, city: ip.city, hosting: ip.hosting === true } : null,
    layers,
    blocker: blocker ? blocker.id : null,
    /** UA 对照实验的结论，独立给出便于 UI 高亮 */
    uaVerdict: {
      tested: !!(bootstrapBrowser.ok && bootstrapCli.ok),
      uaDecidesResult: uaMatters,
      browser: bootstrapBrowser.ok ? bootstrapBrowser.status : null,
      cli: bootstrapCli.ok ? bootstrapCli.status : null,
      summary: uaMatters
        ? "同一请求，浏览器 UA 通过、CLI UA 被挑战 —— 拦截点在 User-Agent。"
        : "未能证明 UA 是决定因素（可能两种 UA 都被拦，或都能通过）。",
    },
    headline,
    /**
     * 明确划清边界：以下内容没有测到，不要当结论用。
     * 把这句话返回给 UI，是为了防止把"能做的事"当成"正在做的事"。
     */
    unverified: [
      "本模块只对照 User-Agent 与 HTTP 响应，不读取 JA3/JA4，也不判断服务端是否在用 TLS 指纹。",
      "Canvas / WebGL / 字体 / 鼠标轨迹等浏览器指纹，本模块无法探测服务端是否采集。",
      "账号内部判定逻辑不可见，只能从响应中的错误码反推。",
      "本地 TLS 栈与真实 Chrome 不同，因此本模块的结论不能等同于「Chrome 会被怎样判定」。",
    ],
  };
}

module.exports = { diagnose };
