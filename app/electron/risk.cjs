/**
 * 风控陷阱清单。
 *
 * 这份清单回答一个问题：这台机器上，有哪些东西会把几个环境连成一条线。
 * 每一条都对应一次实测或一次二进制扫描的结论，不是泛泛的"注意安全"。
 *
 * 分三种处置能力，界面必须分开显示，不能混：
 *   · 能改   —— 我们有按钮，点了就生效（配出口、轮换设备码、清痕迹）
 *   · 只能看 —— 不是我们的进程或不是我们的范围（Claude Desktop、结构性的内核画像）
 *   · 已堵上 —— 已经在 env 里关掉或清掉的（非必要流量、云凭据、终端画像）
 *
 * 为什么要有"只能看"这一档：把管不了的东西也标成红色、不给任何出路，
 * 只会让人以为这个软件在骗他。说清楚边界比堆警报有用。
 */

const { L } = require("./i18n.cjs");

/** 清单条目 */
function item(o) {
  return {
    key: o.key,
    group: o.group,
    level: o.level, // danger | warn | info | ok
    status: o.status, // risk | ok | unfixable | info
    title: o.title,
    why: o.why,
    detail: o.detail || null,
    /** 能点的动作；null = 只能看 */
    fix: o.fix || null,
  };
}

/**
 * 生成清单。
 *
 * 全部输入都是外面已经量好的事实（账号列表、Desktop 探测、UDP 探测），
 * 这个函数自己不做 IO —— 这样它能被直接测，也不会因为多问一次就变慢。
 */
function build({ accounts = [], desktop = null, leak = null } = {}) {
  const items = [];
  const label = (a) => a.label || a.configDir || a.id;
  const proxied = (a) => Boolean(a.proxy && a.proxy.protocol !== "none" && a.proxy.host);

  // ── 出口 ────────────────────────────────────────────────────────
  const direct = accounts.filter((a) => !proxied(a));
  if (direct.length > 0) {
    items.push(
      item({
        key: "exit-direct",
        group: "出口",
        level: direct.some((a) => a.enforceProxy) ? "danger" : "warn",
        status: "risk",
        title: L(
          `${direct.length} 个环境在走直连`,
          `${direct.length} environments go direct`,
        ),
        why: L(
          "直连就是这台机器家里那条宽带。几个环境一起直连，服务端看到的是同一个出口 IP —— 这是最容易被连起来的一条线，而且跟你怎么起名、怎么轮换设备码无关。",
          "Going direct means your home connection. Several environments sharing it look like one exit IP to the server — the easiest link to spot, regardless of naming or device-ID rotation.",
        ),
        detail: direct.map(label).join("、"),
        fix: { kind: "open-network", accountId: direct[0].id },
      }),
    );
  }

  /** 同一个出口 IP 被多个环境用过 */
  const byIp = new Map();
  for (const a of accounts) {
    if (!a.lastExitIp) continue;
    if (!byIp.has(a.lastExitIp)) byIp.set(a.lastExitIp, []);
    byIp.get(a.lastExitIp).push(a);
  }
  for (const [ip, group] of byIp) {
    if (group.length < 2) continue;
    items.push(
      item({
        key: `exit-shared-${ip}`,
        group: "出口",
        level: "danger",
        status: "risk",
        title: L(`出口 IP ${ip} 被 ${group.length} 个环境共用`, `Exit IP ${ip} is shared by ${group.length} environments`),
        why: L(
          "两个环境走同一个出口，等于把两个身份钉在同一台机器上。要么换成不同的线路，要么就承认它们是一伙的。",
          "Two environments on one exit pin two identities to the same machine. Either give them different routes or accept that they are linked.",
        ),
        detail: group.map(label).join("、"),
        fix: { kind: "open-network", accountId: group[1].id },
      }),
    );
  }

  // ── 设备身份 ────────────────────────────────────────────────────
  /**
   * 多个环境共用同一个 userID / machineID。
   *
   * 这是最隐蔽的一条：deviceId 在遥测事件里和 accountUuid 一起上报，
   * 而 deviceId 是从 userID 派生的。两个环境 userID 一样，
   * 服务端不需要看任何别的东西就知道它们是同一台设备。
   */
  const withId = accounts.filter((a) => a.identity && a.identity.userID);
  const byUserId = new Map();
  for (const a of withId) {
    if (!byUserId.has(a.identity.userID)) byUserId.set(a.identity.userID, []);
    byUserId.get(a.identity.userID).push(a);
  }
  for (const [, group] of byUserId) {
    if (group.length < 2) continue;
    items.push(
      item({
        key: `device-shared-${group[0].identity.userID.slice(0, 8)}`,
        group: "设备身份",
        level: "danger",
        status: "risk",
        title: L(`${group.length} 个环境的设备码相同`, `${group.length} environments share one device ID`),
        why: L(
          "deviceId 是从 userID 派生的，而它和 accountUuid 出现在同一条遥测里。设备码相同，等于直接告诉服务端这几个号在同一台机器上。",
          "deviceId derives from userID and is reported alongside accountUuid. An identical device ID tells the server outright that these accounts share a machine.",
        ),
        detail: group.map(label).join("、"),
        fix: { kind: "rotate-identity", accountId: group[1].id },
      }),
    );
  }

  const noId = accounts.filter((a) => !a.identity || !a.identity.userID);
  if (noId.length > 0) {
    items.push(
      item({
        key: "device-missing",
        group: "设备身份",
        level: "info",
        status: "info",
        title: L(`${noId.length} 个环境还没生成设备码`, `${noId.length} environments have no device ID yet`),
        why: L(
          "第一次启动时由 CLI 生成。生成之前没有可轮换的东西，也不用紧张。",
          "The CLI generates it on first launch. Nothing to rotate before that.",
        ),
        detail: noId.map(label).join("、"),
      }),
    );
  }

  // ── UDP / STUN ─────────────────────────────────────────────────
  if (leak) {
    for (const t of leak.targets || []) {
      if (!t.stun || t.stun.length === 0) continue;
      const isSelf = t.key === "self";
      items.push(
        item({
          key: `stun-${t.key}`,
          group: "UDP 泄漏",
          level: "danger",
          status: isSelf ? "risk" : "unfixable",
          title: L(`${t.label} 正在发 STUN`, `${t.label} is sending STUN`),
          why: L(
            "STUN 走 UDP，代理只盖 TCP，盖不住它。它问出来的是整机真实公网 IP —— 不管你给每个环境配了什么代理，拿到的都是同一个。",
            "STUN uses UDP, which proxies do not cover. It reveals the machine's real public IP — the same one for every environment, whatever proxy you set.",
          ),
          detail: t.stun.map((f) => `${f.command} → ${f.remote}`).join("；"),
          fix: isSelf ? { kind: "open-clean" } : null,
        }),
      );
    }
  }

  // ── Claude Desktop（不在我们管辖内）──────────────────────────────
  if (desktop) {
    if (desktop.running) {
      items.push(
        item({
          key: "desktop-running",
          group: "Claude Desktop",
          level: "danger",
          status: "unfixable",
          title: L("Claude Desktop 正开着", "Claude Desktop is running"),
          why: L(
            "它不归任何环境管：Cookies、IndexedDB、Safe Storage 都是整机一份。只要它登录着，这台机器在服务端就永远有第二个身份，环境隔离在这条线上不成立。",
            "It sits outside every environment: cookies, IndexedDB and Safe Storage are machine-wide. While it is signed in, this machine always has a second identity.",
          ),
          detail: desktop.supportDir || null,
          fix: null,
        }),
      );
    } else if (desktop.hasSafeStorage) {
      items.push(
        item({
          key: "desktop-signed-in",
          group: "Claude Desktop",
          level: "warn",
          status: "unfixable",
          title: L("Claude Desktop 还留着登录痕迹", "Claude Desktop still holds sign-in traces"),
          why: L(
            "它没在跑，但 Keychain 里有 Safe Storage 密钥、目录里有 Cookies —— 说明登录态还在。做隔离测试前先在 Desktop 里退出登录。",
            "It is not running, but the Safe Storage key and cookies are still there. Sign out in Desktop before testing isolation.",
          ),
          detail: desktop.lastActiveAt
            ? L(`最后活动：${new Date(desktop.lastActiveAt).toLocaleDateString("zh-CN")}`, `Last active: ${new Date(desktop.lastActiveAt).toLocaleDateString("en-US")}`)
            : null,
          fix: null,
        }),
      );
    }
  }

  // ── 痕迹 ────────────────────────────────────────────────────────
  const dirty = accounts.filter(
    (a) => a.traces && a.traces.some((t) => t.exists && t.critical && !t.machineWide),
  );
  if (dirty.length > 0) {
    items.push(
      item({
        key: "traces-in-env",
        group: "痕迹",
        level: "warn",
        status: "risk",
        title: L(`${dirty.length} 个环境里还留着对话记录/遥测`, `${dirty.length} environments still hold history or telemetry`),
        why: L(
          "这些是跨环境关联时最先被翻的东西：聊过的项目、跑过的命令、文件的路径。不用的环境该清掉。",
          "This is what gets lined up first: projects discussed, commands run, file paths. Clean the environments you no longer use.",
        ),
        detail: dirty.map(label).join("、"),
        fix: { kind: "open-clean" },
      }),
    );
  }

  const machineTrace = (accounts[0]?.traces || []).filter((t) => t.machineWide && t.exists && t.size > 0);
  if (machineTrace.length > 0) {
    items.push(
      item({
        key: "traces-machine",
        group: "痕迹",
        level: "warn",
        status: "risk",
        title: L("整机还有 MCP 日志和客户端日志", "Machine-wide MCP and client logs remain"),
        why: L(
          "这两项不按环境分，是所有环境共用的。里面记着你跑过哪些项目、哪些 MCP 服务 —— 清任何一个环境时会连带清掉它们。",
          "These are not per-environment; every environment shares them, and they record the projects and MCP servers you ran. Cleaning any environment clears them too.",
        ),
        detail: machineTrace.map((t) => `${t.label} ${Math.round(t.size / 1024)} KB`).join("；"),
        fix: { kind: "open-clean" },
      }),
    );
  }

  // ── 已堵上的（显示出来，让人知道做了什么）────────────────────────
  items.push(
    item({
      key: "env-hardened",
      group: "已加固",
      level: "ok",
      status: "ok",
      title: L("每个会话都关掉了非必要流量", "Non-essential traffic is off in every session"),
      why: L(
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1。否则错误上报（Sentry）和产品遥测会带着 deviceId 一起出去，而那两个端点是写死在客户端白名单里的。",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1. Otherwise Sentry and product telemetry leave with the deviceId attached.",
      ),
    }),
    item({
      key: "env-clean-creds",
      group: "已加固",
      level: "ok",
      status: "ok",
      title: L("云凭据和自定义 header 不会跟着继承", "Cloud credentials and custom headers are not inherited"),
      why: L(
        "AWS_* / GOOGLE_APPLICATION_CREDENTIALS / ANTHROPIC_CUSTOM_HEADERS / OTEL_* / git 配置注入都清掉了 —— 不清的话，子进程可能拿着上一个环境的身份发请求。",
        "AWS_*, GOOGLE_APPLICATION_CREDENTIALS, ANTHROPIC_CUSTOM_HEADERS, OTEL_* and injected git config are all cleared.",
      ),
    }),
    item({
      key: "stun-self-blocked",
      group: "已加固",
      level: "ok",
      status: "ok",
      title: L("本应用发不出 STUN", "This app cannot send STUN"),
      why: L(
        "WebRTC 的构造器在页面加载时就被取掉了（Chromium 那几个策略开关实测在 Electron 里一个都不管用，只有删构造器是 0 包）。",
        "The WebRTC constructor is removed at load. Chromium's policy switches were measured to do nothing in Electron; removing the constructor gave 0 packets.",
      ),
    }),
  );

  // ── 改不了的（说清楚，不制造幻觉）────────────────────────────────
  items.push(
    item({
      key: "kernel-shared",
      group: "改不了",
      level: "info",
      status: "unfixable",
      title: L("内核版本、架构、用户名、家目录是共用的", "Kernel, architecture, user name and home are shared"),
      why: L(
        "macOS 没有网络命名空间，靠应用层换不掉 uname -r、USER、HOME。要连这些都不同，只有真虚拟机（Apple Virtualization.framework / Firecracker）一条路。说清楚比假装做到了有用。",
        "macOS has no network namespaces; an app cannot change uname -r, USER or HOME. Only a real VM can. Saying so is more useful than pretending.",
      ),
    }),
  );

  const count = (level) => items.filter((i) => i.level === level && i.status !== "ok").length;
  return {
    items,
    danger: count("danger"),
    warn: count("warn"),
    unfixable: items.filter((i) => i.status === "unfixable").length,
    checkedAt: Date.now(),
  };
}

module.exports = { build };