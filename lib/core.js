// 注入正文只来自插件自带的明文文件；不读也不写 $DSH_HOME。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT_FILE = path.join(PLUGIN_DIR, "default-prompt-inject.md");

let cached = null;

/** 自带正文只读一次；统一换行并去掉首尾空白。 */
export function bundledOperatorText() {
  if (cached === null) {
    try {
      cached = fs.readFileSync(DEFAULT_PROMPT_FILE, "utf8").replace(/\r\n/g, "\n").trim();
    } catch {
      cached = "";
    }
  }
  return cached;
}
