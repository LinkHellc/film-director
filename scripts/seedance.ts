import { appendFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertFilmName, filmDir } from "./lib/paths.ts";
import { readState, writeState } from "./lib/state.ts";
import { latestVersionPath, nextVersionPath, writeNew } from "./lib/versioned.ts";
import { sha256File } from "./lib/hash.ts";
import {
  latestReviewPath,
  readPricing,
  readSpendRows,
  round1,
  spentFromLog,
  spentFromRows,
  type Quote,
  type SpendRow,
} from "./quote.ts";
import { readApproval } from "./approve.ts";
import {
  apiKey,
  ArrearsError,
  baseUrl,
  createTask,
  downloadVideo,
  GatewayError,
  getTask,
  MissingKeyError,
  normBase,
  scrub,
  type TaskStatus,
} from "./lib/video-api.ts";

const USAGE =
  "用法：seedance.ts submit <片名> --quote Q<n>\n" +
  "      seedance.ts poll <片名> [--json]\n" +
  "      seedance.ts fetch <片名>\n" +
  "      seedance.ts wait <片名> [--interval 30] [--timeout 3600]\n" +
  '      seedance.ts reconcile <片名> --quote Q<n> --shot S01 (--task <任务号> | --not-created) --note "<本人说明>"';
const QUOTE_ID_RE = /^Q\d+$/;
const SHOT_RE = /^[A-Za-z0-9_]{1,20}$/;
const EPS = 1e-9;
const LOCK = ".submit.lock";

/** 提交前审核要和现在一致的三类文件（requirements.md 改了不拦：它是全片要求，不是这一镜的提交内容）。 */
const SHOT_FILES = [
  { base: "prompt", ext: "txt", label: "提示词" },
  { base: "first", ext: "png", label: "首帧" },
  { base: "last", ext: "png", label: "尾帧" },
] as const;

function fwd(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 审核记录的键是 fwd(resolve(路径))；Windows 上路径不分大小写。 */
function normKey(p: string): string {
  const f = fwd(resolve(p));
  return process.platform === "win32" ? f.toLowerCase() : f;
}

function rel(dir: string, p: string): string {
  return fwd(relative(dir, p));
}

/** 读 JSON；文件不存在返回 undefined，内容坏了返回 null。 */
function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function latestShotFile(dir: string, shot: string, base: string, ext: string): string | null {
  return latestVersionPath(join(dir, "shots", shot), base, ext);
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** 报价内容是否完整可用（不完整的报价一律不提交）。 */
function validQuote(q: any, id: string): q is Quote {
  return (
    q && typeof q === "object" && q.id === id && typeof q.model === "string" && typeof q.modelId === "string" &&
    isFiniteNum(q.totalCNY) && Array.isArray(q.shots) && q.shots.length > 0 &&
    q.shots.every(
      (s: any) =>
        s && typeof s.shot === "string" && SHOT_RE.test(s.shot) && Number.isInteger(s.billable) && s.billable >= 4 &&
        typeof s.reviewHash === "string",
    ) &&
    new Set(q.shots.map((s: any) => s.shot)).size === q.shots.length
  );
}

/**
 * 提交前的 7 道闸门，按顺序返回所有不满足的原因；空数组 = 通过。
 * 1 报价存在且不超预算；2 模型支持首尾帧（且报价的模型、金额和现在的价格表一致）；
 * 3 每镜最新提交前审核是"通过"；4 审核后没改过提示词/首帧/尾帧（且审核记录就是报价时那份）；
 * 5 本人批准了这份报价、金额一致；6 按 spend.jsonl 现算不超预算；7 这份报价没提交过。
 */
export function checkGates(film: string, quoteId: string): string[] {
  if (typeof quoteId !== "string" || !QUOTE_ID_RE.test(quoteId)) return [`报价号不合法：${quoteId}`];
  const dir = filmDir(film);

  // 1
  const raw = readJson(join(dir, "quotes", `${quoteId}.json`));
  if (raw === undefined) return [`报价 ${quoteId} 不存在`];
  if (!validQuote(raw, quoteId)) return [`报价 ${quoteId} 内容不完整`];
  const q = raw;
  const g: string[][] = [[], [], [], [], [], [], [], []];
  if (q.overBudget !== false) g[1].push(`报价 ${quoteId} 超预算，不能提交`);

  // 2
  const pricing = readPricing();
  const price = Object.hasOwn(pricing.models, q.model) ? pricing.models[q.model] : undefined;
  const seconds = q.shots.reduce((a, s) => a + s.billable, 0);
  let rawTotal = q.totalCNY;
  if (!price || !isFiniteNum(price.cnyPerSecond720p)) {
    g[2].push(`价格表里没有模型 ${q.model}`);
  } else {
    if (price.firstLastFrame !== true) g[2].push(`模型 ${price.id} 不支持首尾帧`);
    rawTotal = seconds * price.cnyPerSecond720p;
    if (q.modelId !== price.id) g[2].push(`报价 ${quoteId} 的模型 ${q.modelId} 和价格表里的 ${price.id} 对不上，请重新报价`);
    else if (round1(rawTotal) !== q.totalCNY) g[2].push(`报价 ${quoteId} 的金额和现在的单价对不上，请重新报价`);
  }

  // 3、4
  let state: ReturnType<typeof readState> | null = null;
  try {
    state = readState(film);
  } catch {
    g[3].push("读不到 state.json");
  }
  for (const line of q.shots) {
    const shot = line.shot;
    if (state && !Object.hasOwn(state.shots, shot)) {
      g[3].push(`没有这个镜头：${shot}`);
      continue;
    }
    const rp = latestReviewPath(dir, shot);
    const rec = rp ? (readJson(rp) as any) : undefined;
    if (!rp || !rec || rec.kind !== "pre-submit" || rec.shot !== shot || rec.verdict !== "pass") {
      g[3].push(`${shot} 的提交前审核不是"通过"`);
      continue;
    }
    if (sha256File(rp) !== line.reviewHash) g[4].push(`${shot} 报价后又审核过，请重新报价`);
    const recorded = new Map<string, unknown>();
    if (rec.files && typeof rec.files === "object") {
      for (const [k, v] of Object.entries(rec.files)) recorded.set(normKey(k), v);
    }
    for (const f of SHOT_FILES) {
      const cur = latestShotFile(dir, shot, f.base, f.ext);
      if (cur === null) {
        g[4].push(`${shot} 缺少${f.label}：shots/${shot}/${f.base}-v*.${f.ext}`);
        continue;
      }
      const h = recorded.get(normKey(cur));
      if (typeof h !== "string" || h !== sha256File(cur)) g[4].push(`${shot} 审核后改过文件：${rel(dir, cur)}`);
      else if (f.base === "prompt" && !readFileSync(cur, "utf8").trim()) g[4].push(`${shot} 的提示词是空的`);
    }
  }

  // 5
  let appr: ReturnType<typeof readApproval> = null;
  try {
    appr = readApproval(film, quoteId);
  } catch {
    appr = null;
  }
  if (!appr || appr.quote !== quoteId || !isFiniteNum(appr.totalCNY) || appr.totalCNY !== q.totalCNY) {
    g[5].push(`报价 ${quoteId} 还没有本人批准`);
  }

  // 6、7
  let rows: SpendRow[] | null = null;
  try {
    rows = readSpendRows(dir);
  } catch (err) {
    g[6].push((err as Error).message);
  }
  const budget = state?.settings?.budgetCNY;
  if (rows) {
    const spent = spentFromRows(rows);
    if (!isFiniteNum(budget) || budget < 0) {
      g[6].push(budget === null || budget === undefined ? "还没有设总预算" : `总预算不合法：${JSON.stringify(budget)}`);
    } else if (!(spent + rawTotal <= budget + EPS)) {
      g[6].push(`花费会超预算：已花 ¥${spent.toFixed(1)} + 本次 ¥${q.totalCNY.toFixed(1)} > 预算 ¥${budget.toFixed(1)}`);
    }
    if (rows.some((r) => r.quote === quoteId)) g[7].push(`报价 ${quoteId} 已经提交过`);
  }
  return g.flat();
}

function usage(): number {
  console.error(USAGE);
  return 2;
}

function needKey(): boolean {
  try {
    apiKey();
    return true;
  } catch (err) {
    console.error((err as Error).message);
    return false;
  }
}

/** 追加一行 JSON；原文件末尾没有换行时先补一个。 */
function appendJsonlImpl(path: string, row: object): void {
  let prefix = "";
  try {
    const cur = readFileSync(path, "utf8");
    if (cur.length > 0 && !cur.endsWith("\n")) prefix = "\n";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  appendFileSync(path, prefix + JSON.stringify(row) + "\n");
}

function updateShotImpl(film: string, shot: string, patch: { status?: string; clip?: string }, spent?: number): void {
  const st = readState(film);
  if (Object.hasOwn(st.shots, shot)) Object.assign(st.shots[shot], patch);
  if (spent !== undefined) st.spentCNY = spent;
  writeState(st);
}

/** 写记账文件和 state.json 的入口；测试里可以替换成会失败的版本。 */
export const io = {
  appendJsonl: appendJsonlImpl,
  updateShot: (film: string, shot: string, patch: { status?: string; clip?: string }, spent?: number): void =>
    updateShotImpl(film, shot, patch, spent),
};

/** 记账失败、但钱可能已经花了：退出 7，锁留着，等本人核对。 */
const EXIT_UNRECORDED = 7;

async function submit(args: string[]): Promise<number> {
  const [film, ...rest] = args;
  let quoteId: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--quote" && i + 1 < rest.length) quoteId = rest[++i];
    else return usage();
  }
  if (!film || !quoteId || !QUOTE_ID_RE.test(quoteId)) return usage();
  try {
    assertFilmName(film);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  if (!needKey()) return 1;
  const dir = filmDir(film);

  // 一次只允许一个提交：先占锁，再查闸门，查完到发完都在锁里
  const lock = join(dir, LOCK);
  const lockShown = `films/${film}/${LOCK}`;
  try {
    writeNew(lock, JSON.stringify({ pid: process.pid, quote: quoteId, at: new Date().toISOString() }));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      console.error(`另一个提交正在进行（${lockShown}）；确认没有在提交、并核对过网关任务日志和 spend.jsonl 后，删掉这个文件再试`);
      return 1;
    }
    if (code === "ENOENT") {
      console.error(`没有这部片子：${film}`);
      return 1;
    }
    throw err;
  }
  let keepLock = false;
  /** 记账失败时的统一处理：说清楚任务号、镜头、金额，保留锁。 */
  const unrecorded = (shot: string, task: string | null, cny: number, row: object, err: unknown): number => {
    keepLock = true;
    console.error(
      `${shot} ${task ? `已经在网关建了任务 ${task}` : "的提交结果不明，可能已经建了任务"}（约 ¥${cny.toFixed(2)}），` +
        `但写 spend.jsonl 失败（${scrub((err as Error).message)}）。`,
    );
    console.error(`应补记的一行：${JSON.stringify(row)}`);
    console.error(
      `已停止，其余镜头没有提交；锁 ${lockShown} 保留着。请先到网关的任务日志核对这个任务，` +
        "把上面这行补进 spend.jsonl，再删掉锁；不要直接重新提交。",
    );
    return EXIT_UNRECORDED;
  };
  try {
    const reasons = checkGates(film, quoteId);
    if (reasons.length > 0) {
      for (const r of reasons) console.error(r);
      return 1;
    }
    const q = readJson(join(dir, "quotes", `${quoteId}.json`)) as Quote;
    const price = readPricing().models[q.model];
    const aspect = readState(film).settings.aspect;
    const spendPath = join(dir, "spend.jsonl");
    // 记下提交时的网关地址：之后查询、下载只去同一个网关（换了地址就跳过，不把任务号和 Key 发给别的网关）
    const gateway = baseUrl();
    let n = 0;
    let total = 0;
    for (const line of q.shots) {
      const shot = line.shot;
      const cny = line.billable * price.cnyPerSecond720p;
      const base = { quote: quoteId, shot, model: price.id, billable: line.billable, cny, baseUrl: gateway };

      // 1) 建任务：这里的失败都还没花钱，或者花没花不确定
      let task: string;
      try {
        const prompt = readFileSync(latestShotFile(dir, shot, "prompt", "txt")!, "utf8").trim();
        task = (
          await createTask({
            model: price.id,
            prompt,
            firstFrame: latestShotFile(dir, shot, "first", "png")!,
            lastFrame: latestShotFile(dir, shot, "last", "png")!,
            seconds: line.billable,
            resolution: "720p",
            aspectRatio: aspect,
          })
        ).id;
      } catch (err) {
        if (err instanceof ArrearsError) {
          console.error(`网关说余额或额度不足：${scrub(err.message)}`);
          console.error(`欠费：已提交 ${n} 镜，其余未提交`);
          return 4;
        }
        if (err instanceof GatewayError && err.uncertain) {
          // 不知道建没建成：按可能已扣费记账（预算照算、这份报价不能再提交），不重发
          const row = { at: new Date().toISOString(), ...base, task: null, uncertain: true };
          try {
            io.appendJsonl(spendPath, row);
          } catch (e) {
            return unrecorded(shot, null, cny, row, e);
          }
          try {
            io.updateShot(film, shot, {}, spentFromLog(dir));
          } catch (e) {
            console.error(`警告：spend.jsonl 已记账，但 state.json 没有更新（${scrub((e as Error).message)}）`);
          }
          console.error(
            `${shot} 提交结果不明（${scrub(err.message)}）：可能已经建了任务并扣费，已按 ¥${cny.toFixed(2)} 记入 spend.jsonl。` +
              "请到网关的任务日志核对，不要直接重发；查清后由本人决定运行 reconcile 记下结果。",
          );
          console.error(`已提交 ${n} 镜，其余未提交`);
          return 1;
        }
        if (err instanceof MissingKeyError) {
          console.error(err.message);
          return 1;
        }
        const msg = err instanceof GatewayError ? `网关拒绝了（${scrub(err.message)}），没有建任务` : scrub((err as Error).message);
        console.error(`${shot} 提交失败：${msg}`);
        console.error(`已提交 ${n} 镜，其余未提交`);
        return 1;
      }

      // 2) 任务已建好、钱已花：先记账，记不上就停下、留锁
      const row = { at: new Date().toISOString(), ...base, task };
      try {
        io.appendJsonl(spendPath, row);
      } catch (err) {
        return unrecorded(shot, task, cny, row, err);
      }
      n++;
      total += cny;
      // 3) 更新 state.json：失败只警告（spend.jsonl 才是账本，闸门按它算）
      try {
        io.updateShot(film, shot, { status: "generating" }, spentFromLog(dir));
      } catch (err) {
        console.error(`警告：${shot} 已提交并记账，但 state.json 没有更新（${scrub((err as Error).message)}）`);
      }
      console.log(`已提交 ${shot}：${task}（${line.billable} 秒，约 ¥${cny.toFixed(2)}）`);
    }
    console.log(`已提交 ${n} 镜，约 ¥${round1(total).toFixed(1)}（估算，以账单为准）；用 wait 等出片`);
    return 0;
  } finally {
    if (!keepLock) {
      try {
        unlinkSync(lock);
      } catch {
        /* 锁已不在 */
      }
    }
  }
}

interface Pending {
  shot: string;
  task: string;
}

interface PollResult extends Pending {
  status: TaskStatus | "unknown";
  videoUrl?: string;
  error?: string;
}

/** fetched.jsonl：下载完或失败结束的任务（之后不再查询）。 */
function doneTasks(dir: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "fetched.jsonl"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err;
  }
  const done = new Set<string>();
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let row: any;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      throw new Error(`fetched.jsonl 第 ${i + 1} 行不是合法的 JSON`);
    }
    if (typeof row?.task === "string") done.add(row.task);
  }
  return done;
}

/**
 * spend.jsonl 里有任务编号、还没下载或失败结束的任务（按提交顺序，去重）。
 * 提交时的网关地址（行里的 baseUrl，旧行没有按默认地址）和现在的 SEEDANCE_BASE_URL 不同的跳过并说明；
 * warned 用来让同一个任务在一次 wait 里只说一次。
 */
function pendingTasks(dir: string, warned: Set<string> = new Set()): Pending[] {
  const done = doneTasks(dir);
  const current = baseUrl();
  const rows = readSpendRows(dir);
  // 核对为"建成了"的任务：网关地址取那条结果不明的提交行
  const uncertainBase = new Map<string, string | undefined>();
  for (const r of rows) if (r.uncertain === true && r.reconcile === undefined) uncertainBase.set(JSON.stringify([r.quote, r.shot]), r.baseUrl);
  const out: Pending[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (typeof r.task !== "string" || !r.task || typeof r.shot !== "string") continue;
    if (r.reconcile !== undefined && r.reconcile !== "created") continue;
    if (done.has(r.task) || seen.has(r.task)) continue;
    seen.add(r.task);
    const at = normBase(r.reconcile === "created" ? uncertainBase.get(JSON.stringify([r.quote, r.shot])) : r.baseUrl);
    if (at !== current) {
      if (!warned.has(r.task)) console.error(`${r.shot} 的任务是在 ${at} 提交的，当前网关地址不同，跳过`);
      warned.add(r.task);
      continue;
    }
    out.push({ shot: r.shot, task: r.task });
  }
  return out;
}

/** 同一个任务在一次 wait 里连续查询出错这么多次，就当失败结束，不再拖住整片。 */
const MAX_QUERY_ERRORS = 5;

/**
 * 查一遍所有待查任务。任何查询出错（含 404/410、回复里没有可识别的状态）都是 unknown（没结束），
 * 单次 poll / fetch 永远不因为出错就判失败——任务可能已经付了钱，一次查不到不代表没有。
 * 只有传入 errCounts（wait 用）时，同一任务在这次 wait 里连续出错 MAX_QUERY_ERRORS 次才算失败。
 */
async function pollOnce(dir: string, errCounts?: Map<string, number>, warned?: Set<string>): Promise<PollResult[]> {
  const out: PollResult[] = [];
  for (const p of pendingTasks(dir, warned)) {
    try {
      out.push({ ...p, ...(await getTask(p.task)) });
      errCounts?.delete(p.task);
    } catch (err) {
      if (err instanceof MissingKeyError) throw err;
      const msg = scrub((err as Error).message);
      const n = (errCounts?.get(p.task) ?? 0) + 1;
      errCounts?.set(p.task, n);
      if (errCounts && n >= MAX_QUERY_ERRORS) {
        out.push({ ...p, status: "failed", error: `连续 ${n} 次查询出错（${msg}）` });
      } else {
        out.push({ ...p, status: "unknown", error: msg });
      }
    }
  }
  return out;
}

function unfinished(results: PollResult[]): boolean {
  return results.some((r) => r.status === "queued" || r.status === "running" || r.status === "unknown");
}

const LABEL: Record<PollResult["status"], string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  unknown: "查询失败",
};

function filmArg(film: string | undefined): string | null {
  if (!film) return null;
  try {
    assertFilmName(film);
    return film;
  } catch (err) {
    console.error((err as Error).message);
    return null;
  }
}

async function poll(args: string[]): Promise<number> {
  const [filmRaw, ...rest] = args;
  let json = false;
  for (const a of rest) {
    if (a === "--json") json = true;
    else return usage();
  }
  const film = filmArg(filmRaw);
  if (!film) return usage();
  if (!needKey()) return 1;
  const results = await pollOnce(filmDir(film));
  if (json) console.log(JSON.stringify(results));
  else if (results.length === 0) console.log("没有待查询的任务");
  else {
    for (const r of results) console.log(`${r.shot} ${r.task}：${LABEL[r.status]}${r.error ? `：${r.error}` : ""}`);
  }
  return unfinished(results) ? 10 : 0;
}

/**
 * 下载成功的、记下失败的（写 fetched.jsonl，之后不再查询）；还在跑的跳过。
 * results 不传就现查一遍。返回 0；有下载出错返回 1。生成失败不影响返回值（原因已打印并记录）。
 */
async function fetchAll(film: string, results?: PollResult[]): Promise<number> {
  const dir = filmDir(film);
  const fetchedPath = join(dir, "fetched.jsonl");
  let code = 0;
  for (const r of results ?? (await pollOnce(dir))) {
    if (r.status === "succeeded") {
      const shotDir = join(dir, "shots", r.shot);
      mkdirSync(shotDir, { recursive: true });
      const dest = nextVersionPath(shotDir, "clip", "mp4");
      try {
        await downloadVideo(r.task, r.videoUrl, dest);
      } catch (err) {
        console.error(`${r.shot} 下载失败：${scrub((err as Error).message)}`);
        code = 1;
        continue;
      }
      const clip = rel(dir, dest);
      io.appendJsonl(fetchedPath, { at: new Date().toISOString(), task: r.task, shot: r.shot, status: "downloaded", clip });
      io.updateShot(film, r.shot, { status: "generated", clip });
      console.log(`${r.shot} 已下载：${clip}`);
    } else if (r.status === "failed") {
      const why = r.error || "失败";
      io.appendJsonl(fetchedPath, { at: new Date().toISOString(), task: r.task, shot: r.shot, status: "failed", error: why });
      io.updateShot(film, r.shot, { status: "failed" });
      console.error(`${r.shot} 生成失败：${why}`);
    } else {
      console.log(`${r.shot} ${r.task}：${LABEL[r.status]}${r.error ? `：${r.error}` : ""}`);
    }
  }
  return code;
}

async function fetchCmd(args: string[]): Promise<number> {
  const [filmRaw, ...rest] = args;
  if (rest.length > 0) return usage();
  const film = filmArg(filmRaw);
  if (!film) return usage();
  if (!needKey()) return 1;
  return fetchAll(film);
}

async function wait(args: string[]): Promise<number> {
  const [filmRaw, ...rest] = args;
  let interval = 30;
  let timeout = 3600;
  for (let i = 0; i < rest.length; i++) {
    const v = Number(rest[i + 1]);
    if (rest[i] === "--interval" && i + 1 < rest.length && Number.isFinite(v) && v >= 0) interval = v, i++;
    else if (rest[i] === "--timeout" && i + 1 < rest.length && Number.isFinite(v) && v > 0) timeout = v, i++;
    else return usage();
  }
  const film = filmArg(filmRaw);
  if (!film) return usage();
  if (!needKey()) return 1;
  const dir = filmDir(film);
  const deadline = Date.now() + timeout * 1000;
  const errCounts = new Map<string, number>();
  const warned = new Set<string>();
  for (;;) {
    const results = await pollOnce(dir, errCounts, warned);
    // 全部结束：下载并记录，退出 0（个别镜头生成失败也是 0，原因已打印并写进 fetched.jsonl）
    if (!unfinished(results)) return fetchAll(film, results);
    const left = deadline - Date.now();
    if (left <= 0) {
      // 超时也先把已经出好的下载下来、把失败的记下
      await fetchAll(film, results);
      console.log("还没出完，稍后再 wait");
      return 6;
    }
    await new Promise((ok) => setTimeout(ok, Math.min(interval * 1000, left)));
  }
}

const TASK_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

/**
 * 核对一次"结果不明"的提交（本人到网关后台查清之后，由本人决定执行）。只往 spend.jsonl 追加一行核对记录，不改旧行：
 *   --task <id>     建成了：之后 poll / fetch / wait 把这个任务当作这一镜的任务去查、去下载（已花金额不变）；
 *   --not-created   没建成：统计已花金额时不再算那条 uncertain 行（spentFromRows）。
 * 只有这一镜在这份报价里有 uncertain 行、而且还没核对过时才执行，否则退出 1。不联网，不需要 Key。
 * 闸门 7 照旧：这份报价不能再提交，要重拍就重新报价。
 */
async function reconcile(args: string[]): Promise<number> {
  const [filmRaw, ...rest] = args;
  let quoteId: string | undefined;
  let shot: string | undefined;
  let task: string | undefined;
  let notCreated = false;
  let note: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const has = i + 1 < rest.length;
    if (rest[i] === "--quote" && has) quoteId = rest[++i];
    else if (rest[i] === "--shot" && has) shot = rest[++i];
    else if (rest[i] === "--task" && has) task = rest[++i];
    else if (rest[i] === "--note" && has) note = rest[++i];
    else if (rest[i] === "--not-created") notCreated = true;
    else return usage();
  }
  const film = filmArg(filmRaw);
  if (!film || !quoteId || !QUOTE_ID_RE.test(quoteId) || !shot || !SHOT_RE.test(shot)) return usage();
  if ((task === undefined) === !notCreated) return usage(); // --task 和 --not-created 恰好给一个
  if (task !== undefined && !TASK_ID_RE.test(task)) return usage();
  if (note === undefined || !note.trim()) return usage();

  const dir = filmDir(film);
  if (readJson(join(dir, LOCK)) !== undefined) {
    console.error(`另一个提交的锁还在（films/${film}/${LOCK}），先处理它再核对`);
    return 1;
  }
  let rows: SpendRow[];
  try {
    rows = readSpendRows(dir);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  const same = (r: SpendRow) => r.quote === quoteId && r.shot === shot;
  if (!rows.some((r) => same(r) && r.uncertain === true && r.reconcile === undefined)) {
    console.error(`报价 ${quoteId} 的 ${shot} 没有结果不明（uncertain）的提交记录，不用核对`);
    return 1;
  }
  if (rows.some((r) => same(r) && r.reconcile !== undefined)) {
    console.error(`报价 ${quoteId} 的 ${shot} 已经核对过，不能再核对`);
    return 1;
  }
  if (task !== undefined && rows.some((r) => r.task === task)) {
    console.error(`任务 ${task} 已经记在 spend.jsonl 里了`);
    return 1;
  }
  const row = {
    at: new Date().toISOString(),
    quote: quoteId,
    shot,
    reconcile: notCreated ? "not-created" : "created",
    ...(task !== undefined ? { task } : {}),
    note,
  };
  try {
    io.appendJsonl(join(dir, "spend.jsonl"), row);
  } catch (err) {
    console.error(`写 spend.jsonl 失败（${scrub((err as Error).message)}），没有记下核对`);
    return 1;
  }
  try {
    io.updateShot(film, shot, notCreated ? {} : { status: "generating" }, spentFromLog(dir));
  } catch (err) {
    console.error(`警告：核对已记入 spend.jsonl，但 state.json 没有更新（${scrub((err as Error).message)}）`);
  }
  if (notCreated) {
    console.log(`已核对：报价 ${quoteId} 的 ${shot} 没有建成任务，已花金额不再算这一镜；要拍就重新报价`);
  } else {
    console.log(`已核对：报价 ${quoteId} 的 ${shot} 是任务 ${task}；用 wait 等出片`);
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd === "reconcile") return reconcile(args);
  if (cmd === "submit") return submit(args);
  if (cmd === "poll") return poll(args);
  if (cmd === "fetch") return fetchCmd(args);
  if (cmd === "wait") return wait(args);
  return usage();
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
