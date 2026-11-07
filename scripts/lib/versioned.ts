import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** <dir> 里 <base>-v<n>.<ext> 的最大 n（数字比较）和对应文件名；没有为 0 / null。目录不存在视为空。 */
function maxVersion(dir: string, base: string, ext: string): { n: number; name: string | null } {
  const re = new RegExp(`^${escapeRe(base)}-v(\\d+)\\.${escapeRe(ext)}$`);
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  let best = { n: 0, name: null as string | null };
  for (const name of names) {
    const m = re.exec(name);
    if (m && Number(m[1]) > best.n) best = { n: Number(m[1]), name };
  }
  return best;
}

/** 返回 <dir>/<base>-v<n>.<ext>，n = 已有最大版本号 + 1，从 1 开始；目录不存在视为空。 */
export function nextVersionPath(dir: string, base: string, ext: string): string {
  return join(dir, `${base}-v${maxVersion(dir, base, ext).n + 1}.${ext}`);
}

/** 已有的最新版本 <dir>/<base>-v<n>.<ext>（n 最大）；没有返回 null。 */
export function latestVersionPath(dir: string, base: string, ext: string): string | null {
  const { name } = maxVersion(dir, base, ext);
  return name === null ? null : join(dir, name);
}

/** 只写新文件：已存在就抛错（flag "wx"），不覆盖。 */
export function writeNew(path: string, data: string | Uint8Array): void {
  writeFileSync(path, data, { flag: "wx" });
}
