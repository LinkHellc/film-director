import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filmDir } from "./lib/paths.ts";
import { readState } from "./lib/state.ts";
import { writeNew } from "./lib/versioned.ts";
import { sha256File } from "./lib/hash.ts";

export type Model = "mini" | "2.0" | "2.5";

export interface Quote {
  id: string;
  film: string;
  model: Model;
  modelId: string;
  shots: { shot: string; seconds: number; billable: number; reviewHash: string }[];
  totalCNY: number;
  spentCNY: number;
  budgetCNY: number;
  overBudget: boolean;
  createdAt: string;
}

export interface Pricing {
  default: Model;
  /** maxSeconds：网关单镜最长秒数（mini 15、2.0 15、2.5 30，来源见 scripts/lib/video-api.ts 顶部注释）。 */
  models: Record<Model, { id: string; cnyPerSecond720p: number; firstLastFrame?: boolean; maxSeconds?: number }>;
}

/**
 * spend.jsonl 的一行。submit 写 {at,quote,shot,task,model,billable,cny,baseUrl}；结果不明时 task 为 null 且 uncertain 为 true。
 * seedance.ts reconcile 追加核对行 {at,quote,shot,reconcile:"created"|"not-created",task?,note}（文件里没有 cny，读进来按 0）。
 */
export interface SpendRow {
  at?: string;
  quote?: string;
  shot?: string;
  task?: string | null;
  model?: string;
  billable?: number;
  cny: number;
  uncertain?: boolean;
  /** 提交时的网关地址（旧行没有，按默认地址算）。 */
  baseUrl?: string;
  reconcile?: "created" | "not-created";
  note?: string;
}

const USAGE = "用法：quote.ts <片名> --shots S01,S02 [--model mini|2.0|2.5]";
const EPS = 1e-9;

/** 价格表属于代码仓库，按本文件位置定位（与 FILM_ROOT 无关）。 */
export function readPricing(): Pricing {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "..", "config", "pricing.json");
  return JSON.parse(readFileSync(path, "utf8")) as Pricing;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function listNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * 计费秒数：向上取整；余量不足（含等于）0.5 秒再加 1 秒；最少 4 秒。秒数必须是大于 0 的有限数。
 * 4 秒下限：网关文档写明 seedance-2.0-mini 4–15 秒、seedance-2.0 4–15 秒、seedance-2.5 4–30 秒（三者最短都是 4 秒），seconds 是整数，
 * 费用 = 输出秒数 × 单价（来源见 scripts/lib/video-api.ts 顶部注释）。上限因模型而异（pricing.json 的 maxSeconds），buildQuote 检查。
 */
export function billableSeconds(seconds: number): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`秒数不合法：${seconds}`);
  }
  let n = Math.ceil(seconds - EPS);
  if (n - seconds <= 0.5 + EPS) n += 1;
  return Math.max(n, 4);
}

/** 镜头最新（n 最大，按数字比较）的 pre-submit 审核记录路径；没有返回 null。 */
export function latestReviewPath(dir: string, shot: string): string | null {
  const esc = shot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^pre-submit-${esc}-v(\\d+)\\.json$`);
  let best = 0;
  for (const name of listNames(join(dir, "reviews"))) {
    const m = re.exec(name);
    if (m) best = Math.max(best, Number(m[1]));
  }
  return best === 0 ? null : join(dir, "reviews", `pre-submit-${shot}-v${best}.json`);
}

/** 镜头最新的 pre-submit 审核文件；必须 verdict 为 pass，返回其哈希。 */
function passedReviewHash(dir: string, shot: string): string {
  const fail = new Error(`${shot} 还没有通过提交前审核`);
  const path = latestReviewPath(dir, shot);
  if (path === null) throw fail;
  const review = JSON.parse(readFileSync(path, "utf8")) as { verdict?: string };
  if (review.verdict !== "pass") throw fail;
  return sha256File(path);
}

/** spend.jsonl 的全部行；文件不存在为 []；坏行（不是 JSON、cny 不是非负有限数）抛错。 */
export function readSpendRows(dir: string): SpendRow[] {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "spend.jsonl"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const rows: SpendRow[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let row: { cny?: unknown; reconcile?: unknown; quote?: unknown; shot?: unknown; task?: unknown; note?: unknown } | null;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      throw new Error(`spend.jsonl 第 ${i + 1} 行不是合法的 JSON`);
    }
    if (row && typeof row === "object" && Object.hasOwn(row, "reconcile")) {
      // 核对行：不带钱（cny 只能没有或为 0），必须写明报价、镜头、结论、说明；created 要有任务号
      const ok =
        (row.reconcile === "created" || row.reconcile === "not-created") &&
        typeof row.quote === "string" && typeof row.shot === "string" && typeof row.note === "string" &&
        (row.reconcile === "not-created" || (typeof row.task === "string" && row.task.length > 0)) &&
        (row.cny === undefined || row.cny === 0);
      if (!ok) throw new Error(`spend.jsonl 第 ${i + 1} 行的核对记录不合法`);
      rows.push({ ...(row as SpendRow), cny: 0 });
      continue;
    }
    const cny = row?.cny;
    if (typeof cny !== "number" || !Number.isFinite(cny) || cny < 0) {
      throw new Error(`spend.jsonl 第 ${i + 1} 行的 cny 不合法：${JSON.stringify(cny)}`);
    }
    rows.push(row as SpendRow);
  }
  return rows;
}

/**
 * 已花金额（不四舍五入）：各提交行 cny 之和，减去被核对为"没建成"（reconcile: "not-created"）的那条 uncertain 行。
 * 核对行本身不算钱；只是不计入某一行，所以不会小于 0。quote.ts、seedance.ts 都只用这个函数算已花。
 */
export function spentFromRows(rows: SpendRow[]): number {
  const key = (r: SpendRow) => JSON.stringify([r.quote, r.shot]);
  const notCreated = new Set(rows.filter((r) => r.reconcile === "not-created").map(key));
  let sum = 0;
  for (const r of rows) {
    if (r.reconcile !== undefined) continue;
    if (r.uncertain === true && notCreated.has(key(r))) continue;
    sum += r.cny;
  }
  return sum;
}

/** spend.jsonl 算出的已花金额（见 spentFromRows）；文件不存在为 0；坏行抛错。 */
export function spentFromLog(dir: string): number {
  return spentFromRows(readSpendRows(dir));
}

function nextQuoteId(dir: string): string {
  let max = 0;
  for (const name of listNames(join(dir, "quotes"))) {
    const m = /^Q(\d+)\.json$/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Q${max + 1}`;
}

export function buildQuote(film: string, shots: string[], model?: Model): Quote {
  const dir = filmDir(film);
  const state = readState(film);
  const pricing = readPricing();
  const m: Model = model ?? state.settings.model ?? pricing.default;
  const price = pricing.models[m];
  if (!price) throw new Error(`没有这个模型：${m}`);
  // 本流程每镜都是首尾帧，不支持的模型不报价（提交时闸门 2 还会再查一次）
  if (price.firstLastFrame !== true) throw new Error(`模型 ${price.id} 不支持首尾帧，不能用于本流程`);
  const maxSeconds = price.maxSeconds;
  if (typeof maxSeconds !== "number" || !Number.isInteger(maxSeconds) || maxSeconds < 4) {
    throw new Error(`价格表里模型 ${price.id} 的单镜上限 maxSeconds 不合法：${JSON.stringify(maxSeconds)}`);
  }
  if (shots.length === 0) throw new Error("没有指定镜头");
  const seen = new Set<string>();
  for (const s of shots) {
    if (seen.has(s)) throw new Error(`镜头重复：${s}`);
    seen.add(s);
    if (!Object.hasOwn(state.shots, s)) throw new Error(`没有这个镜头：${s}`);
  }
  const budget = state.settings.budgetCNY;
  if (budget === null || budget === undefined) throw new Error("还没有设总预算");
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0) {
    throw new Error(`总预算不合法：${JSON.stringify(budget)}`);
  }

  const lines = shots.map((shot) => {
    const seconds = state.shots[shot].seconds;
    let billable: number;
    try {
      billable = billableSeconds(seconds);
    } catch {
      throw new Error(`${shot} 的秒数不合法：${JSON.stringify(seconds)}`);
    }
    if (billable > maxSeconds) throw new Error(`${shot} 计费 ${billable} 秒，超过 ${price.id} 单镜上限 ${maxSeconds} 秒，请拆镜头`);
    return { shot, seconds, billable, reviewHash: passedReviewHash(dir, shot) };
  });
  const rawTotal = lines.reduce((a, l) => a + l.billable, 0) * price.cnyPerSecond720p;
  if (!Number.isFinite(rawTotal)) throw new Error(`单价不合法：${m}`);
  const rawSpent = spentFromLog(dir);
  return {
    id: nextQuoteId(dir),
    film,
    model: m,
    modelId: price.id,
    shots: lines,
    totalCNY: round1(rawTotal),
    spentCNY: round1(rawSpent),
    budgetCNY: budget,
    // 用未四舍五入的数比较；写成 !(<=)，任何 NaN 都算超预算（失败即关）。
    overBudget: !(rawSpent + rawTotal <= budget + EPS),
    createdAt: new Date().toISOString(),
  };
}

function human(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function main(argv: string[]): Promise<number> {
  const [film, ...rest] = argv;
  let shotsArg: string | undefined;
  let modelArg: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--shots") shotsArg = rest[++i];
    else if (rest[i] === "--model") modelArg = rest[++i];
    else {
      console.error(USAGE);
      return 2;
    }
  }
  if (!film || !shotsArg || (modelArg !== undefined && modelArg !== "mini" && modelArg !== "2.0" && modelArg !== "2.5")) {
    console.error(USAGE);
    return 2;
  }
  const shots = shotsArg.split(",").map((s) => s.trim()).filter(Boolean);

  let q: Quote;
  try {
    q = buildQuote(film, shots, modelArg as Model | undefined);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  const path = join(filmDir(film), "quotes", `${q.id}.json`);
  writeNew(path, JSON.stringify(q, null, 2) + "\n");

  const secs = q.shots.reduce((a, s) => a + s.billable, 0);
  const sentence =
    `报价 ${q.id}：${q.shots.length} 镜 ${secs} 秒 ${q.model} 约 ¥${q.totalCNY.toFixed(1)}（估算，以账单为准）；` +
    `已花 ¥${q.spentCNY.toFixed(1)}，预算余 ¥${round1(q.budgetCNY - q.spentCNY).toFixed(1)}`;
  if (q.overBudget) {
    console.error(`超预算：${sentence}（已写 ${human(path)}，不能提交）`);
    return 2;
  }
  console.log(sentence);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
