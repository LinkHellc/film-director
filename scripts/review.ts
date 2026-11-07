import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filmDir, assertFilmName } from "./lib/paths.ts";
import { writeNew } from "./lib/versioned.ts";
import { sha256File } from "./lib/hash.ts";

export type ReviewKind = "story" | "keyframe-plan" | "keyframes" | "pre-submit" | "final";
export type Verdict = "pass" | "fail";

export interface ReviewRecord {
  kind: ReviewKind;
  film: string;
  shot: string | null;
  verdict: Verdict;
  at: string;
  files: Record<string, string>; // 绝对路径 → sha256
}

interface PromptMeta {
  kind: ReviewKind;
  film: string;
  shot: string | null;
  n: number;
  files: Record<string, string>;
}

const KINDS: readonly ReviewKind[] = ["story", "keyframe-plan", "keyframes", "pre-submit", "final"];
const SHOT_RE = /^[A-Za-z0-9_]{1,20}$/;
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const USAGE =
  "用法：review.ts prepare <story|keyframe-plan|keyframes|pre-submit|final> <片名> [--shot S03]\n" +
  "      review.ts record <片名> --prompt <prompt.md 路径> --reply <回复文件>";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 资料缺失（退出 3）。 */
class MissingMaterial extends Error {}

function fwd(p: string): string {
  return p.replace(/\\/g, "/");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isKind(s: string | undefined): s is ReviewKind {
  return KINDS.includes(s as ReviewKind);
}

/** 模式配置属于代码仓库，按本文件位置定位（与 FILM_ROOT 无关）。 */
function readPatterns(kind: ReviewKind): string[] {
  const cfg = JSON.parse(readFileSync(join(REPO, "config", "reviews.json"), "utf8")) as Record<string, unknown>;
  const list = cfg[kind];
  if (!Array.isArray(list) || list.length === 0 || !list.every((p) => typeof p === "string")) {
    throw new Error(`config/reviews.json 里 ${kind} 的模式不合法`);
  }
  return list as string[];
}

function needsShot(kind: ReviewKind): boolean {
  return readPatterns(kind).some((p) => p.includes("<镜头>"));
}

function checklistPath(kind: ReviewKind): string {
  return join(REPO, ".claude", "skills", "film-director", "references", "reviews", `${kind}.md`);
}

/** 只认"去掉空白和 Markdown 加粗后的最后一个非空行"恰好等于"通过"。 */
export function parseVerdict(text: string): Verdict {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\*\*|__/g, "").replace(/[\s\u200b\ufeff]/g, ""))
    .filter((l) => l !== "");
  return lines.at(-1) === "通过" ? "pass" : "fail";
}

function listEntries(dir: string): { name: string; isDir: boolean; isFile: boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((d) => ({
      name: d.name,
      isDir: d.isDirectory(),
      isFile: d.isFile(),
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * 把最后一段（如 `sheet-*-v*.png`）编成正则：`v*` 是版本号（数字），其余 `*` 是分组名。
 * 返回正则和版本号所在的捕获组序号。
 */
function compileSegment(seg: string): { re: RegExp; versionGroup: number } {
  const parts = seg.split("*");
  let src = "^";
  let versionGroup = 0;
  for (let i = 0; i < parts.length; i++) {
    src += escapeRe(parts[i]);
    if (i === parts.length - 1) break;
    if (parts[i].endsWith("v") && versionGroup === 0) {
      src += "(\\d+)";
      versionGroup = i + 1;
    } else {
      src += "(.+)";
    }
  }
  if (versionGroup === 0) throw new Error(`模式里没有版本号 v*：${seg}`);
  return { re: new RegExp(src + "$"), versionGroup };
}

/** 一个模式匹配到的最新版本（每个分组各取 n 最大的），按分组名排序；目录模式展开为其中的图片。 */
function expandPattern(root: string, pattern: string): string[] {
  const isDirPattern = pattern.endsWith("/");
  const segs = pattern.replace(/\/$/, "").split("/");
  const last = segs.pop()!;
  if (segs.some((s) => s.includes("*"))) throw new Error(`只有最后一段可以有 *：${pattern}`);
  const base = join(root, ...segs);
  const { re, versionGroup } = compileSegment(last);

  const best = new Map<string, { n: number; name: string }>();
  for (const e of listEntries(base)) {
    if (isDirPattern ? !e.isDir : !e.isFile) continue;
    const m = re.exec(e.name);
    if (!m) continue;
    const n = Number(m[versionGroup]);
    const key = m.filter((_, i) => i > 0 && i !== versionGroup).join("\u0000");
    const cur = best.get(key);
    if (!cur || n > cur.n) best.set(key, { n, name: e.name });
  }
  const chosen = [...best.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => join(base, v.name));
  if (!isDirPattern) return chosen;

  const out: string[] = [];
  for (const d of chosen) {
    const imgs = listEntries(d)
      .filter((e) => e.isFile && IMAGE_RE.test(e.name))
      .map((e) => e.name)
      .sort();
    for (const name of imgs) out.push(join(d, name));
  }
  return out;
}

function collectMaterials(kind: ReviewKind, film: string, shot?: string): { files: string[]; missing: string[] } {
  const root = filmDir(film);
  if (needsShot(kind) && (!shot || !SHOT_RE.test(shot))) throw new Error(`${kind} 审核要指定合法的镜头`);
  const files: string[] = [];
  const missing: string[] = [];
  for (const raw of readPatterns(kind)) {
    const pattern = raw.replaceAll("<镜头>", shot ?? "");
    const got = expandPattern(root, pattern);
    if (got.length === 0) missing.push(pattern);
    for (const p of got) {
      const abs = fwd(resolve(p));
      if (!files.includes(abs)) files.push(abs);
    }
  }
  return { files, missing };
}

/** 绝对路径（`/` 分隔），按 config/reviews.json 取每类模式下最新版本；有模式没匹配到就抛错。 */
export function materialsFor(kind: ReviewKind, film: string, shot?: string): string[] {
  const { files, missing } = collectMaterials(kind, film, shot);
  if (missing.length > 0) throw new MissingMaterial(`缺少资料：${missing.join("、")}`);
  return files;
}

/** 同一轮的 .prompt.md / .prompt.json / .md / .json 共用 n；取四种后缀里最大的 n 加 1。 */
function nextRound(reviewsDir: string, base: string): number {
  const re = new RegExp(`^${escapeRe(base)}-v(\\d+)\\.(?:prompt\\.md|prompt\\.json|md|json)$`);
  let max = 0;
  for (const e of listEntries(reviewsDir)) {
    const m = re.exec(e.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function baseName(kind: ReviewKind, shot: string | null): string {
  return shot ? `${kind}-${shot}` : kind;
}

function isForbidden(root: string, abs: string): boolean {
  const rel = fwd(relative(root, abs));
  return rel === "state.json" || rel.endsWith("/state.json") || rel === "reviews" || rel.startsWith("reviews/");
}

async function prepare(args: string[]): Promise<number> {
  const [kind, film, ...rest] = args;
  let shot: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--shot" && i + 1 < rest.length) shot = rest[++i];
    else return usage();
  }
  if (!isKind(kind) || !film) return usage();
  try {
    assertFilmName(film);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  const wantShot = needsShot(kind);
  if (wantShot ? !shot || !SHOT_RE.test(shot) : shot !== undefined) return usage();

  const root = filmDir(film);
  const { files, missing } = collectMaterials(kind, film, shot);
  const req = fwd(join(root, "requirements.md"));
  if (listEntries(root).every((e) => !(e.isFile && e.name === "requirements.md"))) missing.push("requirements.md");
  if (missing.length > 0) {
    console.error(`缺少资料：${missing.join("、")}`);
    return 3;
  }
  for (const p of files) {
    if (isForbidden(root, p)) throw new Error(`资料里不能有 state.json 或 reviews/ 下的文件：${p}`);
  }

  const reviewsDir = join(root, "reviews");
  const s = shot ?? null;
  const base = baseName(kind, s);
  const n = nextRound(reviewsDir, base);
  const hashes: Record<string, string> = {};
  for (const p of [...files, req]) hashes[p] = sha256File(p);

  const checklist = readFileSync(checklistPath(kind), "utf8");
  const text =
    checklist +
    "\n\n资料（只读这些文件，不要读别的）：\n" +
    files.join("\n") +
    "\n本人要求：" +
    req +
    '\n\n最后一行只写"通过"或"不通过"。';
  const meta: PromptMeta = { kind, film, shot: s, n, files: hashes };
  const promptPath = join(reviewsDir, `${base}-v${n}.prompt.md`);
  writeNew(promptPath, text);
  writeNew(join(reviewsDir, `${base}-v${n}.prompt.json`), JSON.stringify(meta, null, 2) + "\n");
  console.log(fwd(promptPath));
  return 0;
}

async function record(args: string[]): Promise<number> {
  const [film, ...rest] = args;
  let promptArg: string | undefined;
  let replyArg: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--prompt" && i + 1 < rest.length) promptArg = rest[++i];
    else if (rest[i] === "--reply" && i + 1 < rest.length) replyArg = rest[++i];
    else return usage();
  }
  if (!film || !promptArg || !replyArg) return usage();
  let root: string;
  try {
    root = filmDir(film);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  const reviewsDir = resolve(root, "reviews");
  const promptPath = resolve(promptArg);
  const sameDir =
    process.platform === "win32"
      ? dirname(promptPath).toLowerCase() === reviewsDir.toLowerCase()
      : dirname(promptPath) === reviewsDir;
  const name = promptPath.slice(dirname(promptPath).length + 1);
  const m = /^(.+)-v(\d+)\.prompt\.md$/.exec(name);
  if (!sameDir || !m) {
    console.error(`提示词文件要是本片 reviews/ 下的 .prompt.md：${fwd(promptArg)}`);
    return 2;
  }
  const [, base, nStr] = m;

  let meta: PromptMeta;
  try {
    meta = JSON.parse(readFileSync(join(reviewsDir, `${base}-v${nStr}.prompt.json`), "utf8")) as PromptMeta;
  } catch {
    console.error(`读不到 ${base}-v${nStr}.prompt.json，先用 prepare 生成。`);
    return 2;
  }
  if (
    !isKind(meta.kind) || meta.film !== film || meta.n !== Number(nStr) ||
    baseName(meta.kind, meta.shot) !== base || typeof meta.files !== "object" || meta.files === null
  ) {
    console.error(`${base}-v${nStr}.prompt.json 和提示词文件对不上`);
    return 2;
  }

  const changed: string[] = [];
  for (const [p, h] of Object.entries(meta.files)) {
    let now: string | null;
    try {
      now = sha256File(p);
    } catch {
      now = null;
    }
    if (now !== h) changed.push(fwd(relative(root, p)));
  }
  if (changed.length > 0) {
    console.error(`审核期间文件变了：${changed.join("、")}`);
    return 3;
  }

  let reply: string;
  try {
    reply = readFileSync(resolve(replyArg), "utf8");
  } catch {
    console.error(`读不到回复文件：${fwd(replyArg)}`);
    return 2;
  }
  const verdict = parseVerdict(reply);
  const rec: ReviewRecord = {
    kind: meta.kind,
    film,
    shot: meta.shot,
    verdict,
    at: new Date().toISOString(),
    files: meta.files,
  };
  const mdName = `${base}-v${nStr}.md`;
  try {
    writeNew(join(reviewsDir, mdName), reply);
    writeNew(join(reviewsDir, `${base}-v${nStr}.json`), JSON.stringify(rec, null, 2) + "\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(`这一轮已经记录过：reviews/${base}-v${nStr}，重新审核请再 prepare 一轮。`);
      return 2;
    }
    throw err;
  }
  console.log(`审核 ${meta.kind}：${verdict === "pass" ? "通过" : "不通过"}（reviews/${mdName}）`);
  return verdict === "pass" ? 0 : 1;
}

function usage(): number {
  console.error(USAGE);
  return 2;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd === "prepare") return prepare(args);
  if (cmd === "record") return record(args);
  return usage();
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
