import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 返回 <dir>/<base>-v<n>.<ext>，n = 已有最大版本号 + 1，从 1 开始；目录不存在视为空。 */
export function nextVersionPath(dir: string, base: string, ext: string): string {
  const re = new RegExp(`^${escapeRe(base)}-v(\\d+)\\.${escapeRe(ext)}$`);
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  let max = 0;
  for (const name of names) {
    const m = re.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return join(dir, `${base}-v${max + 1}.${ext}`);
}

/** 只写新文件：已存在就抛错（flag "wx"），不覆盖。 */
export function writeNew(path: string, data: string | Uint8Array): void {
  writeFileSync(path, data, { flag: "wx" });
}
