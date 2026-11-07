// 假视频网关：模仿 new-api（DragonAPI）的 POST /v1/videos、GET /v1/videos/{id}、GET /v1/videos/{id}/content。
// 测试里 import startVideoServer；也能单独运行（Task 9 用）：
//   node tests/fakes/video-server.ts --port 3399 --video clip.mp4 [--succeed-after 2] [--create ok|arrears|reject] [--result ok|fail]
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";

/** 第 n 个创建请求的反应：ok 建任务；arrears 返回额度不足（new-api 的 403 insufficient_user_quota）；
 *  reject 返回 400（不建任务）；echo-key 返回 400 且错误正文里带上收到的 Authorization（测试脱敏）；
 *  crash 直接断开连接（结果不明）。 */
export type CreateMode = "ok" | "arrears" | "reject" | "echo-key" | "crash";

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

export interface VideoServerOptions {
  /** 按顺序消费；用完后一律 ok。 */
  creates?: CreateMode[];
  /** 每个任务第几次查询变成 completed（默认 1）。 */
  succeedAfter?: number;
  /** 这些任务查询时一直返回 404（任务丢了）。 */
  vanish?: string[];
  /** 这些任务查询时一直返回 500。 */
  queryErrors?: string[];
  /** 这些任务一直在生成，永远不结束。 */
  stuck?: string[];
  /** 任务的最终结果（默认 ok）。 */
  result?: "ok" | "fail";
  /** 下载返回的视频内容。 */
  video?: Uint8Array;
  port?: number;
}

export interface VideoServer {
  url: string;
  requests: RecordedRequest[];
  /** 只看 POST /v1/videos。 */
  creates(): RecordedRequest[];
  options: VideoServerOptions;
  close(): Promise<void>;
}

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** 按 DragonAPI 文档检查首尾帧请求格式；不对就 400（真网关也是 400、不建任务）。 */
function checkCreate(body: any): string | null {
  if (!body || typeof body !== "object") return "JSON object required";
  if (typeof body.model !== "string" || !body.model) return "model is required";
  if (typeof body.prompt !== "string" || !body.prompt) return "prompt is required";
  if (!Number.isInteger(body.seconds) || body.seconds < 4) return "seconds must be an integer >= 4";
  if (body.resolution !== "720p") return "resolution must be 720p";
  if (body.task_mode !== "first_last_frame") return "task_mode must be first_last_frame";
  const c = body.content;
  if (!Array.isArray(c) || c.length !== 2) return "content must have 2 images";
  const roles = ["first_frame", "last_frame"];
  for (let i = 0; i < 2; i++) {
    if (c[i]?.type !== "image_url" || c[i]?.role !== roles[i]) return `content[${i}] must be image_url ${roles[i]}`;
    if (typeof c[i]?.url !== "string" || !DATA_URL.test(c[i].url)) return `content[${i}].url must be a data URL`;
  }
  return null;
}

export async function startVideoServer(options: VideoServerOptions = {}): Promise<VideoServer> {
  const requests: RecordedRequest[] = [];
  const tasks = new Map<string, { queries: number }>();
  let createCount = 0;
  let seq = 0;
  const video = options.video ?? new TextEncoder().encode("FAKE-MP4-DATA");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const path = (req.url ?? "/").split("?")[0];
    const auth = req.headers.authorization ?? null;
    requests.push({ method: req.method ?? "", path, authorization: auth, body });

    if (!auth || !/^Bearer \S+$/.test(auth)) return send(res, 401, { error: { message: "invalid token", code: "invalid_api_key" } });

    if (req.method === "POST" && path === "/v1/videos") {
      const mode = options.creates?.[createCount] ?? "ok";
      createCount++;
      if (mode === "crash") {
        req.socket.destroy();
        return;
      }
      if (mode === "arrears") {
        return send(res, 403, {
          code: "insufficient_user_quota",
          message: "用户额度不足，剩余额度：¤0.10，需要预扣：¤2.25",
          data: null,
        });
      }
      if (mode === "echo-key") return send(res, 400, { error: { message: `bad request from ${auth}`, code: "invalid_request" } });
      const problem = mode === "reject" ? "seconds out of range" : checkCreate(body);
      if (problem) return send(res, 400, { error: { message: problem, code: "invalid_request" } });
      const id = `task_fake${String(++seq).padStart(4, "0")}`;
      tasks.set(id, { queries: 0 });
      return send(res, 200, { id, object: "video", model: (body as any).model, status: "queued", progress: 0 });
    }

    const m = /^\/v1\/videos\/([^/]+)(\/content)?$/.exec(path);
    if (req.method === "GET" && m) {
      const id = decodeURIComponent(m[1]);
      if (options.vanish?.includes(id)) return send(res, 404, { error: { message: "task not found", code: "not_found" } });
      if (!m[2] && options.queryErrors?.includes(id)) return send(res, 500, { error: { message: "upstream busy", code: "internal" } });
      const t = tasks.get(id);
      if (!t) return send(res, 404, { error: { message: "task not found", code: "not_found" } });
      const stuck = options.stuck?.includes(id) ?? false;
      const done = !stuck && t.queries >= (options.succeedAfter ?? 1);
      if (m[2]) {
        if (!done || options.result === "fail") return send(res, 400, { error: { message: "video not ready", code: "not_ready" } });
        res.writeHead(200, { "content-type": "video/mp4" });
        res.end(video);
        return;
      }
      t.queries++;
      const finished = !stuck && t.queries >= (options.succeedAfter ?? 1);
      if (!finished) return send(res, 200, { id, object: "video", status: t.queries === 1 ? "queued" : "in_progress", progress: 50 });
      if (options.result === "fail") {
        return send(res, 200, { id, object: "video", status: "failed", progress: 100, error: { message: "内容审核未通过", code: "content_policy" } });
      }
      return send(res, 200, { id, object: "video", status: "completed", progress: 100 });
    }
    send(res, 404, { error: { message: "not found" } });
  });

  await new Promise<void>((ok) => server.listen(options.port ?? 0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    creates: () => requests.filter((r) => r.method === "POST" && r.path === "/v1/videos"),
    options,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opts: VideoServerOptions = { port: 3399 };
  for (let i = 0; i < args.length; i++) {
    const v = args[i + 1];
    if (args[i] === "--port") opts.port = Number(v), i++;
    else if (args[i] === "--video") opts.video = readFileSync(v), i++;
    else if (args[i] === "--succeed-after") opts.succeedAfter = Number(v), i++;
    else if (args[i] === "--create") opts.creates = Array(1000).fill(v as CreateMode), i++;
    else if (args[i] === "--result") opts.result = v as "ok" | "fail", i++;
    else {
      console.error("用法：video-server.ts --port <n> --video <mp4> [--succeed-after n] [--create ok|arrears|reject] [--result ok|fail]");
      process.exit(2);
    }
  }
  const s = await startVideoServer(opts);
  console.log(`假视频网关已启动：${s.url}`);
}
