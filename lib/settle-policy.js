/** 启动后的 settle 判据：ctx 是否还活着。 */

export function isInactiveContextError(error) {
  if (!error) return false;
  if (error.code === "INACTIVE_EFFECT") return true;
  return /inactive context/i.test(String(error.message || error));
}

export function watchContextLife(ctx) {
  const life = { alive: true };
  if (!ctx || typeof ctx.effect !== "function") return life;
  try {
    ctx.effect(() => () => {
      life.alive = false;
    });
  } catch (error) {
    if (isInactiveContextError(error)) {
      life.alive = false;
      return life;
    }
    throw error;
  }
  return life;
}

/** 纯 web 宿主：启动后立即 settle，不需要为桌面壳让路。 */