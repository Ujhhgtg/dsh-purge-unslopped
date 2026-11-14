// 注入正文只来自插件自带的明文文件；不读也不写 $DSH_HOME。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT_FILE = path.join(PLUGIN_DIR, "default-prompt-inject.md");


export function defaultOverrideText() {
  try {
    return fs.readFileSync(DEFAULT_PROMPT_FILE, "utf8");
  } catch {
    return "";
  }
}

/** 统一换行并去掉首尾空白；空正文视为"没有"。 */
export function normalizeOverride(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

let hung = "";

/** 进程内"已挂上"的正文。宿主在钩子未就绪的窗口靠它兜底。 */
export function hangOperatorPrompt(text) {
  hung = String(text || "");
  return hung;
}

export function hungOperatorPrompt() {
  return hung;
}
