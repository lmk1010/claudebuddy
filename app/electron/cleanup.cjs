/**
 * 账号体检与清理。
 *
 * 解决的问题：一个号废了（被封、凭据烂掉、目录删了但 Keychain 留着），
 * 要把它从这台机器上彻底摘干净 —— 而且不能误伤还活着的号。
 *
 * 三个原则：
 *   1. 只读本地，不发网络请求。判断"能不能清"不该等网络。
 *   2. 清理 = 移到回收站，不是 rm。删错了还能捞回来。
 *   3. 每个号都能单独清；"一键"只清自己判定为已废的，绝不扩大到正常号。
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const HOME = process.env.CLAUDE_BUDDY_HOME || os.homedir();

/** 回收站：清理只移动到这里，用户确认不再需要时可自行删除 */
const TRASH_ROOT = path.join(HOME, ".claude-buddy-trash");

/**
 * 演练模式。
 *
 * Keychain 是全局的，不随 CLAUDE_BUDDY_HOME 隔离 —— 在临时 HOME 里跑体检时，
 * 真实条目会全部被判定为「无人认领」，一旦执行就真的删掉了。
 * 所以任何自动化测试都必须开这个开关，只出计划不动手。
 */
const DRY_RUN = process.env.CLAUDE_BUDDY_DRY_RUN === "1";

/**
 * 账号目录的三个来源。
 *
 * neox-shell 自己的 `.claude-*`、默认的 `.claude`，
 * 以及另一个工具（codex-config-ui）建的 `prof_*`。
 * 用户真实的号很可能在第三类里 —— 漏掉就等于"看得见却清不掉"。
 */
const SOURCES = [
  {
    kind: "default",
    root: HOME,
    re: /^\.claude$/,
    // 默认目录用无后缀的主条目，这是唯一例外
    keychainSuffix: false,
  },
  {
    kind: "claude-dir",
    root: HOME,
    // 排除回收站自己，否则清理完它会被当成新账号扫出来
    re: /^\.claude-(?!buddy-trash$)[a-z0-9-]+$/,
    keychainSuffix: true,
  },
  {
    kind: "codex-profile",
    root: path.join(HOME, ".codex-config-ui", "claudecode-oauth-profiles"),
    re: /^prof_[0-9a-f]+$/,
    keychainSuffix: true,
    /** 这个工具自己有一份登记文件，删目录时要同步删记录 */
    registry: path.join(HOME, ".codex-config-ui", "claudecode-oauth-profiles", "profiles.json"),
  },
];

const KEYCHAIN_PREFIX = "Claude Code-credentials";

/**
 * Keychain 条目名。
 *
 * 实测确认：后缀是 **完整绝对路径** 的 sha256 前 8 位，
 * 不是目录名 —— 用目录名会算出完全不同的值，导致清不掉却以为清了。
 */
function keychainServiceFor(absPath, withSuffix) {
  if (!withSuffix) return KEYCHAIN_PREFIX;
  const h = crypto.createHash("sha256").update(absPath).digest("hex").slice(0, 8);
  return `${KEYCHAIN_PREFIX}-${h}`;
}

/** 枚举本机所有 Claude Code 的 Keychain 条目名 */
function listKeychainServices() {
  try {
    const out = execFileSync("security", ["dump-keychain"], {
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const found = new Set();
    for (const m of out.matchAll(/"svce"<blob>="(Claude Code-credentials[^"]*)"/g)) {
      found.add(m[1]);
    }
    return [...found];
  } catch {
    return [];
  }
}

/** 读 .claude.json 里的账号档案。读不到就当没有，不猜。 */
function readProfileMeta(dir) {
  const candidates = [
    path.join(dir, ".claude.json"),
    path.join(dir, "claude.json"),
  ];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      const oa = j?.oauthAccount;
      if (oa && (oa.emailAddress || oa.accountUuid)) {
        return {
          email: oa.emailAddress ?? null,
          accountUuid: oa.accountUuid ?? null,
          tier: oa.organizationRateLimitTier ?? null,
        };
      }
    } catch {
      /* 下一个 */
    }
  }
  return { email: null, accountUuid: null, tier: null };
}

/** 目录大小，带预算，避免碰到超大目录时卡住 */
function dirSize(dir, budget = 2 * 1024 * 1024) {
  let total = 0;
  let seen = 0;
  const walk = (d) => {
    if (seen > budget) return;
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (seen > budget) return;
      const full = path.join(d, e.name);
      try {
        const st = fs.statSync(full);
        seen++;
        if (st.isDirectory()) walk(full);
        else total += st.size;
      } catch {
        /* 跳过 */
      }
    }
  };
  walk(dir);
  return total;
}

/** 最近一次活动时间：取目录里最新文件的 mtime */
function lastActiveOf(dir) {
  let newest = 0;
  let seen = 0;
  const walk = (d) => {
    if (seen > 2000 || Date.now() - newest < 0) return;
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (seen > 2000) return;
      const full = path.join(d, e.name);
      try {
        const st = fs.statSync(full);
        seen++;
        if (st.mtimeMs > newest) newest = st.mtimeMs;
        if (st.isDirectory()) walk(full);
      } catch {
        /* 跳过 */
      }
    }
  };
  walk(dir);
  return newest;
}

/** 统计对话记录条数：projects 目录下的 .jsonl */
function countSessions(dir) {
  let n = 0;
  const proj = path.join(dir, "projects");
  let ents = [];
  try {
    ents = fs.readdirSync(proj, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const d of ents) {
    if (!d.isDirectory()) continue;
    try {
      for (const f of fs.readdirSync(path.join(proj, d.name))) {
        if (f.endsWith(".jsonl")) n++;
      }
    } catch {
      /* 跳过 */
    }
  }
  return n;
}

/**
 * 体检：列出所有账号，并标出哪些已经废了。
 *
 * 注意这里**不判断"账号是否被封"** —— 那需要联网，本地看不出来。
 * 这里判断的是"本地这套东西是否还有意义"：
 *   · 凭据在不在
 *   · 目录在不在
 * 被封的号本地看起来是完好的，只有用户自己知道它废了，所以留了手动清理。
 */
function survey() {
  const services = new Set(listKeychainServices());
  const accounts = [];
  const claimedServices = new Set();

  for (const src of SOURCES) {
    let names = [];
    try {
      names = fs
        .readdirSync(src.root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && src.re.test(d.name))
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const name of names) {
      const abs = path.join(src.root, name);
      const svc = keychainServiceFor(abs, src.keychainSuffix);
      const hasKeychain = services.has(svc);
      if (hasKeychain) claimedServices.add(svc);

      const hasCredentials = fs.existsSync(path.join(abs, "credentials.json"));
      const meta = readProfileMeta(abs);
      const sizeBytes = dirSize(abs);
      const lastActive = lastActiveOf(abs);
      const sessions = countSessions(abs);

      /**
       * 状态只反映本地事实，且**绝不因为"没凭据"就建议删**：
       *   ok          有 Keychain，看起来能用
       *   signed-out  没凭据了，但目录里有东西（对话记录等）——
       *               重新登录就能接着用，删了就是丢资料，所以只标出来不建议清
       *   empty       没凭据、也没有任何对话记录、体积也很小 —— 才是真正的残渣
       */
      let state = "ok";
      // 判据以「有没有对话记录」为主：对话才是不可再生的东西。
      // 体积只用来兜底拦一下异常大却没有 .jsonl 的目录。
      const nearEmpty = sessions === 0 && sizeBytes < 8 * 1024 * 1024;
      if (!hasKeychain && !hasCredentials) state = nearEmpty ? "empty" : "signed-out";
      else if (!hasKeychain) state = "signed-out";

      accounts.push({
        id: `${src.kind}:${name}`,
        kind: src.kind,
        name,
        path: abs,
        keychainService: svc,
        hasKeychain,
        hasCredentials,
        email: meta.email,
        tier: meta.tier,
        sizeBytes,
        lastActive,
        sessions,
        state,
      });
    }
  }

  /**
   * 孤儿条目：Keychain 里有，但没有任何目录用它。
   * 这是最该清的一类 —— 凭据还活着、却已经没人认领。
   */
  const orphans = [...services]
    .filter((s) => !claimedServices.has(s))
    .map((s) => ({ service: s, reason: "没有对应的配置目录" }));

  /**
   * 其他工具（codex-config-ui）临时建的 prof_* 不列出来：那是别的工具自己管的会话目录，
   * 用户在那边正用着，这里清掉等于把那边的登录拔了。
   * 但它们仍然参与上面的「认领」—— 否则它们的凭据会被误判成无人认领、进到建议清理里。
   */
  const visible = accounts.filter((a) => a.kind !== "codex-profile");
  visible.sort((a, b) => b.lastActive - a.lastActive);

  /**
   * 建议清理的只有 `empty` —— 真正的空壳。
   * 有对话记录但掉了登录的（signed-out）绝不自动建议：
   * 那 600MB 对话一删就没了，而重新登录本来就能救回来。
   */
  const disposable = visible.filter((a) => a.state === "empty");

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    accounts: visible,
    orphans,
    suggested: {
      accountIds: disposable.map((a) => a.id),
      services: orphans.map((o) => o.service),
      reason:
        disposable.length || orphans.length
          ? `${disposable.length} 个空壳目录、${orphans.length} 个无人认领的凭据`
          : "没有可清理的",
    },
  };
}

/** 把目录挪进回收站。返回挪到哪，方便用户反悔。 */
function moveToTrash(abs) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(TRASH_ROOT, stamp, path.basename(abs));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(abs, dest);
    return { ok: true, dest };
  } catch {
    // 跨设备或权限问题，退回复制后删除
    try {
      fs.cpSync(abs, dest, { recursive: true });
      fs.rmSync(abs, { recursive: true, force: true });
      return { ok: true, dest };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  }
}

/** 删一条 Keychain 凭据。不存在不算失败。 */
function deleteKeychain(service) {
  try {
    execFileSync("security", ["delete-generic-password", "-s", service], {
      stdio: "ignore",
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "条目不存在或无权删除" };
  }
}

/** 从 codex-config-ui 的登记文件里摘掉一条记录 */
function unregisterCodexProfile(profileName) {
  const src = SOURCES.find((s) => s.kind === "codex-profile");
  if (!src?.registry) return { ok: false, reason: "没有登记文件" };
  try {
    const j = JSON.parse(fs.readFileSync(src.registry, "utf8"));
    if (!Array.isArray(j.profiles)) return { ok: false, reason: "格式不认识" };
    const before = j.profiles.length;
    j.profiles = j.profiles.filter((p) => p.id !== profileName);
    if (j.profiles.length === before) return { ok: true, changed: false };
    if (j.active === profileName) j.active = j.profiles[0]?.id ?? null;
    fs.writeFileSync(src.registry, JSON.stringify(j, null, 2));
    return { ok: true, changed: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * 执行清理。
 *
 * 只接受 survey() 给过的 id / service，渲染层传不进任意路径 ——
 * 否则一个参数注入就能删掉主目录。
 *
 * 顺序很重要：先删登记、再挪目录、最后删凭据。
 * 万一中途失败，凭据还在，用户还能重新登录找回这个号。
 */
function purge({ accountIds = [], services = [], allowMainKeychain = false } = {}) {
  const snap = survey();
  const byId = new Map(snap.accounts.map((a) => [a.id, a]));

  const moved = [];
  const keychainDeleted = [];
  const unregistered = [];
  const failed = [];

  // 1) 先摘登记，避免留下指向已删目录的记录
  for (const id of accountIds) {
    const a = byId.get(id);
    if (!a) {
      failed.push({ id, reason: "不在体检结果里" });
      continue;
    }
    if (a.kind === "codex-profile") {
      const r = unregisterCodexProfile(a.name);
      if (r.ok && r.changed) unregistered.push(a.name);
      else if (!r.ok) failed.push({ id, reason: `摘登记失败：${r.reason}` });
    }
  }

  // 2) 挪目录
  for (const id of accountIds) {
    const a = byId.get(id);
    if (!a) continue;
    // 默认目录指向用户自己的主配置，永远不动
    if (a.kind === "default") {
      failed.push({ id, reason: "默认目录是 ~/.claude，不提供删除" });
      continue;
    }
    if (DRY_RUN) {
      moved.push({ id, dest: `${TRASH_ROOT}/(演练，未移动)` });
      continue;
    }
    const r = moveToTrash(a.path);
    if (r.ok) moved.push({ id, dest: r.dest });
    else failed.push({ id, reason: r.reason });
  }

  // 3) 最后删凭据
  const servicesToDrop = new Set(services);
  for (const id of accountIds) {
    const a = byId.get(id);
    if (a?.hasKeychain) servicesToDrop.add(a.keychainService);
  }
  for (const svc of servicesToDrop) {
    /**
     * 主条目对应 ~/.claude。删它 = 默认账号掉登录，目录里的对话记录不动。
     * 清理一个失效的默认号时这正是想要的，但误删会让人以为账号没了，
     * 所以要求显式打开 allowMainKeychain。
     */
    if (svc === KEYCHAIN_PREFIX && !allowMainKeychain) {
      failed.push({ service: svc, reason: "主条目属于默认账号，需显式确认才能删除" });
      continue;
    }
    if (DRY_RUN) {
      keychainDeleted.push(svc);
      continue;
    }
    const r = deleteKeychain(svc);
    if (r.ok) keychainDeleted.push(svc);
    else failed.push({ service: svc, reason: r.reason });
  }

  return {
    ok: failed.length === 0,
    dryRun: DRY_RUN,
    moved,
    keychainDeleted,
    unregistered,
    failed,
    trashRoot: TRASH_ROOT,
  };
}

module.exports = { survey, purge, keychainServiceFor, listKeychainServices, TRASH_ROOT };
