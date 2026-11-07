/*
 * Seedance 视频接口（第三方 new-api 网关 DragonAPI）。
 *
 * ── Step 1 核实结果（2026-11-07；只读了公开文档与源码，没有发任何会建任务或扣费的请求） ──
 * 来源：
 *   [A] 网关公开价目 GET https://newapi.dragon3api.com/api/pricing（副本 .superpowers/sdd/…/gateway-pricing.json）
 *   [B] 网关公开状态 GET https://newapi.dragon3api.com/api/status：version "v1.0.0-rc.48-dragonapi"，docs_link https://docs.dragon3api.com/
 *   [C] https://docs.dragon3api.com/model/video-seedance-mini-generation
 *   [D] https://docs.dragon3api.com/model/video-seedance-2-5-generation
 *   [E] https://docs.dragon3api.com/videos
 *   [F] https://docs.dragon3api.com/tasks
 *   [G] https://docs.dragon3api.com/video-references
 *   [H] https://docs.dragon3api.com/errors
 *   [I] new-api 源码 https://github.com/QuantumNous/new-api ：service/billing.go、service/billing_session.go
 *       （预扣失败 → HTTP 403，code "insufficient_user_quota" / "pre_consume_token_quota_failed"）、
 *       relaykit/types/error.go（上述 code 常量）、relay/relay_task.go（预扣在发上游请求之前："余额不足就不发请求"）、
 *       controller/relay.go respondTaskError（错误体 {code,message,data}）、plugins/tasks/doubao/plugin.js、router/video-router.go。
 *
 * 创建 POST /v1/videos，Authorization: Bearer <key>，JSON（也接受 multipart，这里只用 JSON）[C][E][G]：
 *   { "model": "seedance-2.0-mini", "prompt": "...", "seconds": 5, "resolution": "720p", "aspect_ratio": "16:9",
 *     "task_mode": "first_last_frame",
 *     "content": [ {"type":"image_url","role":"first_frame","url":"data:image/png;base64,..."},
 *                  {"type":"image_url","role":"last_frame", "url":"data:image/png;base64,..."} ] }
 *   - 首尾帧：[G] 原文要点"首尾帧用 task_mode: first_last_frame，content 中两张图片的角色依次为 first_frame、
 *     last_frame，每张图仍填写完整 data URL"；url 必须是完整 data URL（不是裸 base64、外部网址或本地路径）。
 *     单图 input_reference 默认按"参考图"处理，不是首帧——所以不用 input_reference。
 *   - 时长 seconds（整数秒）：seedance-2.0-mini 4–15 秒，seedance-2.5 4–30 秒 [C][D][E][G]；不传按最短。
 *     → billableSeconds 下限由 2 改为 4（scripts/quote.ts）。上限未在本地检查：超了网关 400、不建任务不扣费 [E][G]。
 *   - 分辨率 resolution "720p"；比例 aspect_ratio ∈ 16:9 9:16 1:1 4:3 3:4 21:9 [C]。
 *   - 返回 {"id":"task_xxx","status":"queued",...}，id 是公开任务 ID [E][F]。
 *   - 规格不符 → 400，不建任务、不扣费 [E][G]。每次 POST 都是新任务、单独计费；幂等键不会合并；
 *     超时且没拿到 id 时"不要直接重发"，要到任务日志核对 [G]。
 * 查询 GET /v1/videos/{id}：status ∈ queued / in_progress / completed / failed，失败看 error [F]。
 * 下载 GET /v1/videos/{id}/content，带同一个 Bearer Key，返回视频二进制 [C][F]。
 * 计费：费用 = 输出秒数 × 单价（+ 参考视频秒数 × 单价，这里不用参考视频），不足 1 秒按 1 秒计；
 *   seedance-2.0-mini 720p ¥0.15/秒，首帧/首尾帧同价 ¥0.15/秒；seedance-2.5 720p ¥0.55/秒 [A][G]。
 *   提交时按上限预扣（2.0 系列 15 秒，2.5 系列 30 秒），完成后按实际结算、退差额；失败全额退回 [G]。
 *   → 余额要够"上限预扣"才能提交；不够时网关拒绝（不发上游请求）。
 * seedance-2.5 是否支持首尾帧：不支持。[G] 原文"seedance-2.5、seedance-1.5-pro 不提供首帧模式"，
 *   [D] 生成方式只有"文生视频、参考生成"。→ pricing.json 里 2.5 的 firstLastFrame 为 false。
 * 余额或额度不足：new-api 在发上游请求前预扣，失败返回 HTTP 403 + code insufficient_user_quota（钱包或订阅不足）
 *   或 pre_consume_token_quota_failed（Key 自身额度不足）[I]；网关文档另列"402／余额不足"[H]。
 *   → 402、上述 code、或正文含"余额不足/额度不足/quota is not enough/insufficient…quota|balance"都按欠费处理。
 *   403 "This token has no access to model" 等其他 403 不是欠费，按普通拒绝处理（同样停止整批）[H]。
 * 未核实（按最保守方式实现）：
 *   - 欠费时的确切中文文案（网关 i18n 文本没看到原文）→ 主要靠 HTTP 状态和 code 判断。
 *   - 查询结果里有没有可直接下载的视频网址 → 一律走 /content；若响应里带了网址，只在 /content 失败时
 *     用它下载，而且不带 Key（防止把 Key 发给别的主机）。
 *   - JSON 请求体大小上限（multipart 写明 64 MiB）→ 不在本地限制，超了网关会报错（4xx 不扣费）。
 *   - 上游内容审核/人脸检测在排队阶段执行，失败的任务"失败则全额退回"[G]。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

/** 余额或额度不足。 */
export class ArrearsError extends Error {}

/**
 * 网关拒绝或请求失败。uncertain = true 表示不知道任务建没建成（断线、超时、5xx、2xx 却没有 id），
 * 可能已经扣费，不能直接重发；false 表示网关明确拒绝了（4xx），没有建任务。
 */
export class GatewayError extends Error {
  status: number | null;
  uncertain: boolean;
  constructor(message: string, status: number | null, uncertain: boolean) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}

/** 没有设置 SEEDANCE_API_KEY。 */
export class MissingKeyError extends Error {
  constructor() {
    super("没有设置 SEEDANCE_API_KEY");
  }
}

export interface CreateRequest {
  model: string;
  prompt: string;
  firstFrame: string; // 本地图片路径
  lastFrame: string; // 本地图片路径
  seconds: number; // 整数秒（计费秒数）
  resolution: "720p";
  aspectRatio?: string; // 16:9 等；不在网关支持列表里就不传
}

export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

const DEFAULT_BASE = "https://newapi.dragon3api.com";
const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const CREATE_TIMEOUT_MS = 180_000;
const QUERY_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;

export function baseUrl(): string {
  return (process.env.SEEDANCE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

/** 读 Key；没设抛 MissingKeyError。Key 只放进请求头，不进任何输出。 */
export function apiKey(): string {
  const key = process.env.SEEDANCE_API_KEY;
  if (!key || !key.trim()) throw new MissingKeyError();
  return key.trim();
}

/** 把文本里的 Key（原文和 Bearer 形式）换成 ***。所有要打印的网关文本都先过这里。 */
export function scrub(text: string): string {
  const key = process.env.SEEDANCE_API_KEY?.trim();
  let s = String(text);
  if (key) s = s.split(key).join("***");
  return s.replace(/Bearer\s+\S+/gi, "Bearer ***");
}

function firstChars(s: string, n: number): string {
  return Array.from(s).slice(0, n).join("");
}

function dataUrl(path: string): string {
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error(`首尾帧只支持 png/jpg/webp：${path.replace(/\\/g, "/")}`);
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

/** 从错误正文里取 code 和 message（兼容 {code,message} 与 {error:{code,message}}）。 */
function errorInfo(text: string): { code: string; message: string } {
  try {
    const j = JSON.parse(text);
    const e = j && typeof j.error === "object" && j.error !== null ? j.error : j;
    return { code: String(e?.code ?? ""), message: String(e?.message ?? (typeof j?.error === "string" ? j.error : text)) };
  } catch {
    return { code: "", message: text };
  }
}

const ARREARS_CODES = new Set(["insufficient_user_quota", "pre_consume_token_quota_failed", "insufficient_quota"]);
const ARREARS_TEXT = /余额不足|额度不足|欠费|quota is not enough|insufficient[_ ](user[_ ])?(quota|balance)/i;

export function isArrears(status: number, text: string): boolean {
  if (status === 402) return true;
  const { code, message } = errorInfo(text);
  return ARREARS_CODES.has(code) || ARREARS_TEXT.test(message) || ARREARS_TEXT.test(code);
}

function describe(status: number, text: string): string {
  const { code, message } = errorInfo(text);
  return scrub(`HTTP ${status}${code ? ` ${code}` : ""}：${firstChars(message.trim() || "（无正文）", 300)}`);
}

async function send(method: string, path: string, body: unknown, timeoutMs: number, redirect: RequestRedirect = "error"): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey()}`, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect, // 默认不跟随跳转：带 Key 的请求不能被引到别的主机
  });
}

/** 建一个首尾帧视频任务。欠费抛 ArrearsError；其他失败抛 GatewayError（见 uncertain）。 */
export async function createTask(req: CreateRequest): Promise<{ id: string }> {
  if (!Number.isInteger(req.seconds) || req.seconds < 4) throw new Error(`秒数不合法：${req.seconds}`);
  if (req.resolution !== "720p") throw new Error(`分辨率不合法：${req.resolution}`);
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    seconds: req.seconds,
    resolution: req.resolution,
  };
  if (req.aspectRatio && ASPECTS.includes(req.aspectRatio)) body.aspect_ratio = req.aspectRatio;
  body.task_mode = "first_last_frame";
  body.content = [
    { type: "image_url", role: "first_frame", url: dataUrl(req.firstFrame) },
    { type: "image_url", role: "last_frame", url: dataUrl(req.lastFrame) },
  ];
  apiKey(); // 读图之后、发请求之前再确认一次 Key

  let res: Response;
  try {
    res = await send("POST", "/v1/videos", body, CREATE_TIMEOUT_MS);
  } catch (err) {
    throw new GatewayError(scrub(`连不上网关或超时（${(err as Error).message}）`), null, true);
  }
  let text = "";
  try {
    text = await res.text();
  } catch (err) {
    throw new GatewayError(scrub(`读网关回复失败（${(err as Error).message}）`), res.status, res.ok || res.status >= 500);
  }
  if (res.ok) {
    let id: unknown;
    try {
      const j = JSON.parse(text);
      id = j?.id ?? j?.task_id;
    } catch {
      /* 落到下面 */
    }
    if (typeof id !== "string" || !id.trim()) throw new GatewayError(`网关回复里没有任务编号（HTTP ${res.status}）`, res.status, true);
    return { id: id.trim() };
  }
  if (isArrears(res.status, text)) throw new ArrearsError(describe(res.status, text));
  // 4xx：网关明确拒绝，没建任务；5xx：不确定
  throw new GatewayError(describe(res.status, text), res.status, res.status >= 500);
}

/** 查任务。网关状态 queued / in_progress / completed / failed 映射为 queued / running / succeeded / failed；不认识的当 running。 */
export async function getTask(id: string): Promise<{ status: TaskStatus; videoUrl?: string; error?: string }> {
  let res: Response;
  try {
    res = await send("GET", `/v1/videos/${encodeURIComponent(id)}`, undefined, QUERY_TIMEOUT_MS);
  } catch (err) {
    throw new GatewayError(scrub(`查询失败（${(err as Error).message}）`), null, false);
  }
  const text = await res.text();
  if (!res.ok) throw new GatewayError(`查询失败：${describe(res.status, text)}`, res.status, false);
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new GatewayError("查询回复不是 JSON", res.status, false);
  }
  const raw = String(j?.status ?? "").toLowerCase();
  const map: Record<string, TaskStatus> = {
    queued: "queued",
    submitted: "queued",
    not_start: "queued",
    in_progress: "running",
    running: "running",
    processing: "running",
    completed: "succeeded",
    succeeded: "succeeded",
    success: "succeeded",
    failed: "failed",
    failure: "failed",
    cancelled: "failed",
    expired: "failed",
  };
  const status = map[raw] ?? "running";
  const out: { status: TaskStatus; videoUrl?: string; error?: string } = { status };
  const url = j?.video_url ?? j?.url ?? j?.metadata?.url ?? j?.content?.video_url;
  if (typeof url === "string" && /^https?:\/\//.test(url)) out.videoUrl = url;
  if (status === "failed") {
    const e = j?.error;
    const msg = typeof e === "string" ? e : e?.message ?? j?.fail_reason ?? raw;
    out.error = scrub(firstChars(String(msg || "失败"), 300));
  }
  return out;
}

/**
 * 下载视频到 dest（只写新文件，已存在就报错）。先走 GET /v1/videos/{id}/content（带 Key）；
 * 失败且有 url 时，再不带 Key 直接下载 url。
 */
export async function downloadVideo(id: string, url: string | undefined, dest: string): Promise<void> {
  let bytes: Uint8Array | null = null;
  let why = "";
  try {
    let res = await send("GET", `/v1/videos/${encodeURIComponent(id)}/content`, undefined, DOWNLOAD_TIMEOUT_MS, "manual");
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location) {
      // 网关把下载转到存储地址：跟过去，但不带 Key
      res = await fetch(new URL(location, baseUrl()), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    }
    if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
    else why = describe(res.status, await res.text());
  } catch (err) {
    if (err instanceof MissingKeyError) throw err;
    why = scrub((err as Error).message);
  }
  if ((!bytes || bytes.length === 0) && url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
      else why += `；网址下载 HTTP ${res.status}`;
    } catch (err) {
      why += `；网址下载失败（${scrub((err as Error).message)}）`;
    }
  }
  if (!bytes || bytes.length === 0) throw new GatewayError(`下载失败：${why || "内容为空"}`, null, false);
  writeFileSync(dest, bytes, { flag: "wx" });
}
