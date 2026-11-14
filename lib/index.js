import * as core from "./core.js";
import {
  GLOBAL_PROMPT_ORDER,
  installAssembleGuard,
  prepareInjectText,
  rewritePromptAssembly,
} from "./identity.js";
import {
  isInactiveContextError,
  watchContextLife,
} from "./settle-policy.js";

export const name = "dsh-purge";

// 不要把 pluginPackages 写进 inject：Cordis 会对 map 里每一个 key 空等。
// 便携拷贝 / Hub 残装经常没有这项服务，一写进去就是 pending → 宿主退出码 1。
export const inject = ["systemPrompt"];

const DEFAULTS = {
  enabled: true,
  postPrompt: "",
  postPromptOrder: 5100,
  verbose: false,
};

const log = (config, ...args) => {
  if (config?.verbose) console.log("[dsh-purge]", ...args);
};

function injectAllowedNow(config) {
  return config.enabled !== false;
}

/** 自带正文只读一次，组装前只准备一次。 */
let preparedInject = null;

function preparedInjectText() {
  if (preparedInject === null) {
    preparedInject = prepareInjectText(core.bundledOperatorText());
  }
  return preparedInject;
}


/** 提示词服务自己的 ctx 多半没有 scope，段会进全局层。插件若挂在某个 scope 上，预设代理的父链看不到那一层。 */
function addPromptSection(ctx, section) {
  const hosts = [];
  const push = (host) => {
    if (host && !hosts.includes(host)) hosts.push(host);
  };
  try { push(ctx?.systemPrompt?.ctx); } catch { /* 代理未注入时点属性会抛 */ }
  push(ctx);
  const disposers = [];
  let registered = false;
  let lastError = null;
  for (const host of hosts) {
    try {
      const d = host.systemPrompt.section(section);
      registered = true;
      if (typeof d === "function") disposers.push(d);
    } catch (error) {
      const msg = String(error && error.message || error);
      if (msg.includes("already registered")) registered = true;
      else lastError = error;
    }
  }
  if (!registered && lastError) throw lastError;
  // 让 ctx.effect 在 reload / dispose 时把 section 一并撤掉；host.systemPrompt.section
  // 当前多半不返回 disposer，这段只对返回 function 的实现生效，不改变旧行为。
  if (disposers.length && typeof ctx?.effect === "function") {
    try {
      ctx.effect(() => () => {
        for (const d of disposers) {
          try { d(); } catch { /* ignore */ }
        }
      });
    } catch { /* 死 ctx */ }
  }
}

export function registerPromptSections(ctx, config) {
  const injectText = () => (injectAllowedNow(config) ? preparedInjectText() : "");
  // 固定置顶：注入正文永远是第一个 section。
  addPromptSection(ctx, {
    name: "dsh-purge",
    order: GLOBAL_PROMPT_ORDER,
    interpolate: false,
    text: injectText,
  });

  const postPrompt = typeof config.postPrompt === "string" ? config.postPrompt.trim() : "";
  if (!postPrompt) return;
  if (!Number.isFinite(config.postPromptOrder) || config.postPromptOrder <= GLOBAL_PROMPT_ORDER) {
    // 旧版 throw 会把整个 apply 炸掉；postPrompt 只是附加段，降级 skip 不影响核心注入。
    console.warn(
      `[dsh-purge] postPromptOrder (${config.postPromptOrder}) 需要是 > ${GLOBAL_PROMPT_ORDER} 的有限数；跳过 postPrompt 段`,
    );
    return;
  }
  addPromptSection(ctx, {
    name: "dsh-purge:post",
    order: config.postPromptOrder,
    text: () => (injectAllowedNow(config) ? postPrompt : ""),
  });
}

function rewriteLiveAssembly(config, assembled) {
  const inject = injectAllowedNow(config) ? preparedInjectText() : "";
  // 有注入正文时丢掉官方 workspace baseline，避免两套工作区说明打架。
  return rewritePromptAssembly(assembled, inject);
}


function installIdentityOverride(ctx, config = {}) {
  if (typeof ctx.on !== "function") return;
  // installAssembleGuard 幂等:slot.rewrite 已挂的 prompt 对象只刷新 rewriteFn,
  // 不再 return 新 dispose。原实现每 400ms + 每 pre-step push 一个 noop closure 入 Set,
  // 2 小时 session 累积上万条。改为:只 track 首次真正挂上的 disposer。
  const wrapDisposers = new Set();
  const wrappedPrompts = new WeakSet();
  const trackDisposer = (d, prompt) => {
    if (typeof d !== "function") return d;
    if (prompt) {
      if (wrappedPrompts.has(prompt)) return d;
      wrappedPrompts.add(prompt);
    }
    wrapDisposers.add(d);
    return d;
  };
  const rewriteFn = (assembled) => rewriteLiveAssembly(config, assembled);
  const wrapAssemble = () => {
    try {
      const prompt = ctx.systemPrompt;
      return trackDisposer(installAssembleGuard(prompt, rewriteFn), prompt);
    } catch {
      return false;
    }
  };
  if (!ctx.__dshPurgeAssembleHook) {
    ctx.__dshPurgeAssembleHook = true;
    // cordis 不同版本的 waterfall 可能是 (assembly, context) 或 (assembly, context, next)：
    // 旧写法把 `next` 当函数直接取第 3 位，老宿主就拿到 context 当 next，await next() 立刻抛。
    // disposer 不进 wrapDisposers:ctx.effect cleanup 在 child scope 结束/预设切换都会触发,
    // 收集进去的话会被误解绑,之后再也挂不回来。cordis 真 dispose 时 listener 自己跟 ctx 释放。
    try {
      ctx.on("system-prompt/assemble", async (...args) => {
        const [assembly] = args;
        const next = args.length >= 3 ? args[args.length - 1] : null;
        let assembled = assembly;
        if (typeof next === "function") {
          try {
            assembled = await next();
          } catch (err) {
            // 下游 waterfall 任一环节抛就会把整条 assemble 弄死,UI 卡住发不出去。
            // 吞掉改用上游装配兜底,inject 保底能挂上。
            try { console.warn("[dsh-purge] system-prompt/assemble waterfall rejected:", err?.message || err); } catch {}
            assembled = assembly;
          }
        }
        try {
          return rewriteLiveAssembly(config, assembled);
        } catch (err) {
          try { console.warn("[dsh-purge] rewriteLiveAssembly failed:", err?.message || err); } catch {}
          return assembled;
        }
      }, { global: true, prepend: true });
    } catch { /* ctx.on 老版本签名异常,下次 apply 覆盖 */ }
  }
  // complete:true 会在 waterfall 之后盖掉 sections；包住 assemble 返回值，每轮都补回注入。
  wrapAssemble();
  // guard 需要在每次 cordis 换 systemPrompt 代理时重挂（session 内切预设、subagent fork、
  // live-mount）。原本 20 秒后 clearInterval，之后换代理就包不上 → 第二轮 inject 走原生
  // assemble → 宿主按 token 预算裁剪 → 用户看到"只截取了部分"。installAssembleGuard 幂等
  // （wrappedPrompts WeakSet + 对象 identity 校验），400ms 持续跑到 ctx dispose 的 CPU 代价可忽略。
  // 400ms 回滚:2000ms 窗口 → 新对话第一次 assemble 可能跑在钩子挂上之前,inject 塌。
  // CPU 代价(幂等 wrap)相比"新对话失效"的用户感知,根本不值一提。
  const timer = setInterval(wrapAssemble, 400);
  if (typeof timer.unref === "function") timer.unref();
  // 下面三个 ctx.on 必须加 flag:installIdentityOverride 若被同一 ctx 二次 apply
  // (dispose 后重 mount / 热重载),listener 叠加会让 inject 跑 N 遍,也让 wrap 挂 N 层。
  if (!ctx.__dshPurgeSessionHook) {
    ctx.__dshPurgeSessionHook = true;
    try {
      ctx.on("session/created", wrapAssemble);
    } catch { /* ignore */ }
  }
  if (!ctx.__dshPurgePresetHook) {
    ctx.__dshPurgePresetHook = true;
    try {
      ctx.on("agent-preset/selected", wrapAssemble, { global: true });
    } catch { /* ignore */ }
  }
  if (!ctx.__dshPurgePreStepHook) {
    ctx.__dshPurgePreStepHook = true;
    try {
      ctx.on("agent/pre-step", (payload, next) => {
        wrapAssemble();
        return typeof next === "function" ? next() : payload;
      }, { global: true, prepend: true });
    } catch { /* ignore */ }
  }
  // 热重载/卸载时统一回收：轮询 timer、guard 代理层，都在同一个 effect 里扫掉；
  // 避免下次 apply 再绑一层造成多次写入。
  try {
    ctx.effect(() => () => {
      clearInterval(timer);
      for (const d of wrapDisposers) {
        try { d(); } catch { /* ignore */ }
      }
      wrapDisposers.clear();
      // 清 flag,下次 apply 允许重新挂 listener;不然 ctx 复用时沉默无响应。
      delete ctx.__dshPurgeSessionHook;
      delete ctx.__dshPurgePresetHook;
      delete ctx.__dshPurgePreStepHook;
      // [v10] AssembleHook 也要清。原漏删,ctx 复用时新 apply 看到 flag=true 直接跳过
      // ctx.on("system-prompt/assemble", ...),cordis event listener 永远不装 → 新对话首轮
      // 完全依赖 400ms setInterval wrapAssemble 的 guard,时间窗没赶上就 inject 真空。
      delete ctx.__dshPurgeAssembleHook;
    });
  } catch { /* 无 effect 时靠 unref + 下次 apply 自覆盖 */ }
}


export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  if (!cfg.enabled) return;
  const life = watchContextLife(ctx);
  if (!life.alive) {
    console.warn("[dsh-purge] skip apply: inactive context");
    return;
  }
  log(cfg, "plugin enabled");
  try {
    applyHostHooks(ctx, cfg);
  } catch (e) {
    if (isInactiveContextError(e)) {
      console.warn("[dsh-purge] skip apply: inactive context");
      return;
    }
    throw e;
  }
}

function applyHostHooks(ctx, cfg) {
  installIdentityOverride(ctx, cfg);
  registerPromptSections(ctx, cfg);
}

const plugin = {
  name,
  inject,
  apply,
};

export default plugin;
