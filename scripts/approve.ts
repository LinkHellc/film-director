import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { filmDir } from "./lib/paths.ts";
import { writeNew } from "./lib/versioned.ts";
import type { Quote } from "./quote.ts";

export interface Approval {
  quote: string;
  totalCNY: number;
  model: Quote["model"];
  shots: Quote["shots"];
  said: string;
  at: string;
}

const USAGE = '用法：approve.ts <片名> Q<n> --said "<本人在对话里的原话>"';
const QUOTE_ID_RE = /^Q\d+$/;

function assertQuoteId(id: string): void {
  if (typeof id !== "string" || !QUOTE_ID_RE.test(id)) throw new Error(`报价号不合法：${id}`);
}

/** 读文件；不存在返回 null。 */
function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** 出现任何一个就不算批准：否定、拒绝、撤回、拖延、疑问。 */
const NOT_APPROVING = ["不", "别", "勿", "没", "未", "拒", "取消", "暂缓", "撤", "等", "再说", "？", "?", "吗"];

/**
 * 只认两种回答（"批准" 和报价号之间是半角空格）：
 * 1. 恰好是 G4 选项原文 `批准 Q3（¥1.5）`（允许首尾空白）；
 * 2. 以 `批准 Q3` 开头（后面不能紧跟数字，"批准 Q31" 不算 Q3），且全文不含 NOT_APPROVING 里的任何字样。
 * 宁可错拒（如"不错，批准 Q3"会被拒），不可错收。只回一个数字（选项编号）不算批准。
 */
export function saidApproves(said: string, quoteId: string): boolean {
  assertQuoteId(quoteId);
  if (typeof said !== "string") return false;
  const s = said.trim();
  if (new RegExp(`^批准 ${quoteId}（¥[0-9.]+）$`).test(s)) return true;
  return new RegExp(`^批准 ${quoteId}(?!\\d)`).test(s) && !NOT_APPROVING.some((w) => s.includes(w));
}

/** 读 approvals/<报价号>.json；没有批准过返回 null。报价号不合法时抛错。 */
export function readApproval(
  film: string,
  quoteId: string,
): { quote: string; totalCNY: number; said: string; at: string } | null {
  assertQuoteId(quoteId);
  const raw = readOrNull(join(filmDir(film), "approvals", `${quoteId}.json`));
  if (raw === null) return null;
  return JSON.parse(raw) as Approval;
}

export async function main(argv: string[]): Promise<number> {
  const [film, id, ...rest] = argv;
  let said: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--said" && i + 1 < rest.length) said = rest[++i];
    else {
      console.error(USAGE);
      return 2;
    }
  }
  if (!film || !id || !QUOTE_ID_RE.test(id) || said === undefined) {
    console.error(USAGE);
    return 2;
  }
  let dir: string;
  try {
    dir = filmDir(film);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  const raw = readOrNull(join(dir, "quotes", `${id}.json`));
  if (raw === null) {
    console.error(`报价 ${id} 不存在`);
    return 1;
  }
  let q: Quote;
  try {
    q = JSON.parse(raw) as Quote;
  } catch {
    console.error(`报价 ${id} 不是合法的 JSON`);
    return 1;
  }
  if (typeof q?.totalCNY !== "number" || !Number.isFinite(q.totalCNY) || !Array.isArray(q.shots)) {
    console.error(`报价 ${id} 内容不完整`);
    return 1;
  }
  // 只有明确 overBudget === false 才放行（字段缺失或坏值都按超预算处理，失败即关）。
  if (q.overBudget !== false) {
    console.error(`报价 ${id} 超预算，不能批准`);
    return 1;
  }
  if (!saidApproves(said, id)) {
    console.error(`本人原话里没有"批准 ${id}"`);
    return 1;
  }

  const approval: Approval = {
    quote: id,
    totalCNY: q.totalCNY,
    model: q.model,
    shots: q.shots,
    said,
    at: new Date().toISOString(),
  };
  const approvalsDir = join(dir, "approvals");
  mkdirSync(approvalsDir, { recursive: true });
  try {
    writeNew(join(approvalsDir, `${id}.json`), JSON.stringify(approval, null, 2) + "\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(`报价 ${id} 已经批准过`);
      return 1;
    }
    throw err;
  }
  console.log(`已记下批准：${id} ¥${q.totalCNY.toFixed(1)}`);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
