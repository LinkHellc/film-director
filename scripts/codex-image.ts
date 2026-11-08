// Codex 画图：一次一张，按阶段闸门放行。
// 用法：codex-image.ts <片名> --kind style|sheet|first|last --out <相对片子目录的基名> --prompt <提示词文件> [--ref <图>]...
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { filmDir } from "./lib/paths.ts";
import { isApproved, readState } from "./lib/state.ts";
import { nextVersionPath, writeNew } from "./lib/versioned.ts";
import { resolveCommand, run } from "./lib/proc.ts";

export type Kind = "style" | "sheet" | "first" | "last";
const KINDS: Kind[] = ["style", "sheet", "first", "last"];

/** Global Constraints 规定的提示词固定开头。 */
export const PROMPT_PREFIX = "Use your image generation tool to create exactly ONE image. Do not run shell commands.";

const USAGE =
  "用法：codex-image.ts <片名> --kind style|sheet|first|last --out <相对片子目录的基名> --prompt <提示词文件> [--ref <图>]...\n" +
  "  --out：style/sheet 写 style/<名字>（如 style/look）；first/last 写 shots/<镜头>/first 或 shots/<镜头>/last（如 shots/S01/first）。\n" +
  "  结果存成 <片子目录>/<--out>-v<n>.png，只新建不覆盖。";

const SESSION_RE = /session id:\s*([0-9a-f-]{8,})/i;
const QUOTA_RE = /quota|rate limit|额度/i;
const NAME_RE = /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,40}$/;
const SHOT_RE = /^S\d{2,3}$/;
const TIMEOUT_MS = 15 * 60_000;

/**
 * 解析 --out（相对片子目录、用 / 分隔、不带扩展名和版本号）：
 * - style、sheet：必须是 style/<名字>
 * - first、last：必须是 shots/<镜头号>/<first|last>，基名与 --kind 一致
 * 不合法返回 null。
 */
export function parseOut(kind: Kind, out: string): { dir: string; base: string } | null {
  const parts = out.split("/");
  if (kind === "style" || kind === "sheet") {
    if (parts.length !== 2 || parts[0] !== "style" || !NAME_RE.test(parts[1])) return null;
    return { dir: "style", base: parts[1] };
  }
  if (parts.length !== 3 || parts[0] !== "shots" || !SHOT_RE.test(parts[1]) || parts[2] !== kind) return null;
  return { dir: `shots/${parts[1]}`, base: kind };
}

/**
 * 输出里是否有额度报错。真 codex 会在开头回显提示词（user 下面那段），
 * 所以先去掉与本次提示词相同的行，免得提示词里的 quota/额度 被误判。
 */
export function quotaError(output: string, sentPrompt: string): boolean {
  const norm = (l: string) => l.trim();
  const promptLines = new Set(sentPrompt.split(/\r?\n/).map(norm).filter(Boolean));
  return output
    .split(/\r?\n/)
    .filter((l) => !promptLines.has(norm(l)))
    .some((l) => QUOTA_RE.test(l));
}

/** 从 PNG 文件头（IHDR）读宽高；不是 PNG 返回 null。 */
export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return null;
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** 加上固定开头；文件里已经有就不重复加。 */
export function withPrefix(prompt: string): string {
  return prompt.includes(PROMPT_PREFIX) ? prompt : `${PROMPT_PREFIX}\n${prompt}`;
}

function imagesRoot(): string {
  return process.env.FILM_CODEX_IMAGES || join(homedir(), ".codex", "generated_images");
}

/** dir 里（深入 depth 层子目录）修改时间 >= since 的 .png，取最新的；没有返回 null。 */
function newestPng(dir: string, since: number, depth: number): string | null {
  let best: { path: string; mtime: number } | null = null;
  const walk = (d: string, left: number) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (left > 0) walk(p, left - 1);
      } else if (e.isFile() && /\.png$/i.test(e.name)) {
        const mtime = statSync(p).mtimeMs;
        if (mtime >= since && (!best || mtime > best.mtime)) best = { path: p, mtime };
      }
    }
  };
  walk(dir, depth);
  return best === null ? null : (best as { path: string }).path;
}

interface Args {
  film: string;
  kind: Kind;
  out: string;
  prompt: string;
  refs: string[];
}

function parseArgs(argv: string[]): Args | null {
  const [film, ...rest] = argv;
  if (!film || film.startsWith("--")) return null;
  let kind: string | undefined;
  let out: string | undefined;
  let prompt: string | undefined;
  const refs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) return null;
    if (flag === "--kind") kind = value;
    else if (flag === "--out") out = value;
    else if (flag === "--prompt") prompt = value;
    else if (flag === "--ref") refs.push(value);
    else return null;
    i++;
  }
  if (!kind || !KINDS.includes(kind as Kind) || !out || !prompt) return null;
  return { film, kind: kind as Kind, out, prompt, refs };
}

/** 闸门：不放行时返回要输出的话。 */
function gateRefusal(film: string, kind: Kind): string | null {
  const state = readState(film);
  if (!isApproved(state, "G1")) return "故事还没确认，不画图";
  if (kind !== "style" && !isApproved(state, "G3")) return "画风还没确认，只能画样帧";
  if ((kind === "first" || kind === "last") && !isApproved(state, "G3b")) return "设定图还没确认";
  return null;
}

function fwd(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  let dir: string;
  try {
    dir = filmDir(args.film);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  if (!existsSync(join(dir, "state.json"))) {
    console.error(`找不到片子：${args.film}`);
    return 2;
  }
  const target = parseOut(args.kind, args.out);
  if (!target) {
    console.error(`--out 和 --kind ${args.kind} 对不上：${args.out}`);
    console.error(USAGE);
    return 2;
  }

  const refusal = gateRefusal(args.film, args.kind);
  if (refusal) {
    console.error(refusal);
    return 1;
  }

  let prompt: string;
  try {
    prompt = readFileSync(resolve(args.prompt), "utf8");
  } catch {
    console.error(`读不到提示词文件：${fwd(args.prompt)}`);
    return 2;
  }
  const refs = args.refs.map((r) => resolve(r));
  for (const [i, r] of refs.entries()) {
    if (!existsSync(r)) {
      console.error(`找不到参考图：${fwd(args.refs[i])}`);
      return 2;
    }
  }

  const cmd = [
    ...resolveCommand("FILM_CODEX_CMD", ["codex"]),
    "exec", "--skip-git-repo-check", "-s", "read-only",
    ...refs.flatMap((r) => ["-i", r]),
    "-",
  ];
  // 留 1 秒余量，防文件系统时间精度/时钟取整把本次的图漏掉
  const started = Date.now() - 1000;
  const sent = withPrefix(prompt);
  const res = await run(cmd, { cwd: dir, stdin: sent, timeoutMs: TIMEOUT_MS });
  const output = `${res.stdout}\n${res.stderr}`;

  const session = SESSION_RE.exec(output)?.[1];
  const root = imagesRoot();
  const image = session ? newestPng(join(root, session), started, 0) : newestPng(root, started, 1);

  if (!image) {
    const tail = res.stderr.trim().split(/\r?\n/).slice(-3).join("\n");
    if (quotaError(output, sent)) {
      console.error("Codex 额度用完");
      if (tail) console.error(tail);
      return 5;
    }
    console.error(`Codex 没有出图（退出码 ${res.code}）`);
    if (tail) console.error(tail);
    return 3;
  }

  const data = readFileSync(image);
  const outDir = join(dir, ...target.dir.split("/"));
  mkdirSync(outDir, { recursive: true });
  const dest = nextVersionPath(outDir, target.base, "png");
  writeNew(dest, data);

  const rel = fwd(relative(dir, dest));
  const size = pngSize(data);
  if (!size) {
    console.log(`已出图：${rel}（读不出宽高，可能不是 PNG）`);
    return 0;
  }
  let line = `已出图：${rel}（${size.width}×${size.height}）`;
  const ratio = size.width / size.height;
  if (Math.abs(ratio - 16 / 9) / (16 / 9) > 0.01) line += "；比例不是 16:9，提交视频前要裁切";
  console.log(line);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
