import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILM_NAME_RE = /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,40}$/;

/** 项目根：FILM_ROOT 优先，否则为仓库根（按本文件位置定位，与 cwd 无关）。 */
export function projectRoot(): string {
  const env = process.env.FILM_ROOT;
  if (env) return resolve(env);
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** 片名只允许 [A-Za-z0-9_\-\u4e00-\u9fa5]{1,40}，否则抛错。 */
export function assertFilmName(film: string): void {
  if (typeof film !== "string" || !FILM_NAME_RE.test(film)) {
    throw new Error(`片名不合法：${film}`);
  }
}

/** films/<片名> 的绝对路径（先校验片名）。 */
export function filmDir(film: string): string {
  assertFilmName(film);
  return join(projectRoot(), "films", film);
}
