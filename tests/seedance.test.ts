import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkGates, io, main } from "../scripts/seedance.ts";
import { main as quote } from "../scripts/quote.ts";
import { main as approve } from "../scripts/approve.ts";
import { sha256File } from "../scripts/lib/hash.ts";
import { readState, type FilmState } from "../scripts/lib/state.ts";
import { startVideoServer, type VideoServer, type VideoServerOptions } from "./fakes/video-server.ts";

const FILM = "提交片";
const KEY = "sk-test-SECRET-9f8e7d6c5b4a";
const PNG = (tag: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(tag)]);

function fwd(p: string): string {
  return p.replace(/\\/g, "/");
}

interface Ctx {
  dir: string;
  out: string[];
  gw: VideoServer;
}

/** 临时 FILM_ROOT + 一部素材齐全、审核通过的片子 + 假网关 + 环境变量 + 捕获输出。 */
async function withFilm(
  opts: { shots?: string[]; gw?: VideoServerOptions },
  fn: (c: Ctx) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "film-seedance-"));
  const saved = { FILM_ROOT: process.env.FILM_ROOT, SEEDANCE_BASE_URL: process.env.SEEDANCE_BASE_URL, SEEDANCE_API_KEY: process.env.SEEDANCE_API_KEY };
  const out: string[] = [];
  const log = console.log;
  const err = console.error;
  const gw = await startVideoServer(opts.gw ?? {});
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    process.env.FILM_ROOT = root;
    process.env.SEEDANCE_BASE_URL = gw.url;
    process.env.SEEDANCE_API_KEY = KEY;
    const dir = join(root, "films", FILM);
    const shots = opts.shots ?? ["S01", "S02"];
    mkdirSync(join(dir, "reviews"), { recursive: true });
    mkdirSync(join(dir, "quotes"), { recursive: true });
    const state: FilmState = {
      film: FILM,
      stage: "generate",
      settings: { seconds: 10, aspect: "16:9", budgetCNY: 100, music: null, subtitles: false, model: "mini" },
      gates: {},
      shots: Object.fromEntries(shots.map((s) => [s, { seconds: 4.4, status: "ready", clip: null }])),
      spentCNY: 0,
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
    writeFileSync(join(dir, "requirements.md"), "本人要求");
    for (const s of shots) {
      put(dir, `shots/${s}/prompt-v1.txt`, `${s} 的七段式提示词`);
      put(dir, `shots/${s}/first-v1.png`, PNG(`${s}-first`));
      put(dir, `shots/${s}/last-v1.png`, PNG(`${s}-last`));
      review(dir, s, 1, "pass");
    }
    await fn({ dir, out, gw });
  } finally {
    console.log = log;
    console.error = err;
    await gw.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

function put(dir: string, rel: string, data: string | Uint8Array): string {
  const p = join(dir, ...rel.split("/"));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

/** 按 review.ts 的格式写一份 pre-submit 审核记录：当前最新的提示词、首帧、尾帧 + requirements.md。 */
function review(dir: string, shot: string, n: number, verdict: "pass" | "fail"): void {
  const files: Record<string, string> = {};
  const latest = (base: string, ext: string) => {
    const names = readdirSync(join(dir, "shots", shot)).filter((x) => new RegExp(`^${base}-v\\d+\\.${ext}$`).test(x));
    names.sort((a, b) => Number(/v(\d+)/.exec(b)![1]) - Number(/v(\d+)/.exec(a)![1]));
    return join(dir, "shots", shot, names[0]);
  };
  for (const p of [latest("prompt", "txt"), latest("first", "png"), latest("last", "png"), join(dir, "requirements.md")]) {
    files[fwd(resolve(p))] = sha256File(p);
  }
  writeFileSync(
    join(dir, "reviews", `pre-submit-${shot}-v${n}.json`),
    JSON.stringify({ kind: "pre-submit", film: FILM, shot, verdict, at: new Date().toISOString(), files }, null, 2),
  );
}

/** 报价 + 批准，返回报价号。 */
async function quoteAndApprove(shots: string, model?: "mini" | "2.0" | "2.5"): Promise<string> {
  const args = [FILM, "--shots", shots, ...(model ? ["--model", model] : [])];
  assert.equal(await quote(args), 0);
  const ids = readdirSync(join(process.env.FILM_ROOT!, "films", FILM, "quotes")).map((n) => Number(/^Q(\d+)/.exec(n)![1]));
  const id = `Q${Math.max(...ids)}`;
  assert.equal(await approve([FILM, id, "--said", `批准 ${id}`]), 0);
  return id;
}

function spendLines(dir: string): any[] {
  if (!existsSync(join(dir, "spend.jsonl"))) return [];
  return readFileSync(join(dir, "spend.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function noKey(c: Ctx): void {
  assert.ok(!c.out.join("\n").includes(KEY), "输出里出现了 Key");
  assert.ok(!c.out.join("\n").includes("SECRET"), "输出里出现了 Key 片段");
}

// ---------- checkGates ----------

test("checkGates：全部满足时返回 []", async () => {
  await withFilm({}, async () => {
    const id = await quoteAndApprove("S01,S02");
    assert.deepEqual(checkGates(FILM, id), []);
  });
});

test("闸门 1：报价不存在 / 报价超预算", async () => {
  await withFilm({}, async (c) => {
    assert.deepEqual(checkGates(FILM, "Q9"), ["报价 Q9 不存在"]);
    const id = await quoteAndApprove("S01,S02");
    const p = join(c.dir, "quotes", `${id}.json`);
    const q = JSON.parse(readFileSync(p, "utf8"));
    q.overBudget = true;
    writeFileSync(p, JSON.stringify(q));
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 超预算，不能提交`]);
  });
});

test("闸门 2：模型不支持首尾帧（seedance-2.5）", async () => {
  await withFilm({}, async (c) => {
    // quote.ts 已经不给 2.5 报价；这里手改一份报价和批准，确认闸门 2 自己也拦得住
    const id = await quoteAndApprove("S01,S02");
    const qp = join(c.dir, "quotes", `${id}.json`);
    const ap = join(c.dir, "approvals", `${id}.json`);
    writeFileSync(qp, JSON.stringify({ ...JSON.parse(readFileSync(qp, "utf8")), model: "2.5", modelId: "seedance-2.5", totalCNY: 5.5 }));
    writeFileSync(ap, JSON.stringify({ ...JSON.parse(readFileSync(ap, "utf8")), totalCNY: 5.5 }));
    assert.deepEqual(checkGates(FILM, id), ["模型 seedance-2.5 不支持首尾帧"]);
  });
});

test("2.0（seedance-2.0，firstLastFrame 为 true）：报价批准后 checkGates 返回 []，不报不支持首尾帧", async () => {
  await withFilm({}, async () => {
    const id = await quoteAndApprove("S01,S02", "2.0");
    assert.deepEqual(checkGates(FILM, id), []);
  });
});

test("闸门 3：最新提交前审核不是通过", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    review(c.dir, "S01", 2, "fail");
    assert.deepEqual(checkGates(FILM, id), ['S01 的提交前审核不是"通过"']);
  });
});

test("rejects files changed after review：改 prompt-v1.txt、新增 prompt-v2.txt 都被拒；改 requirements.md 不拦", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    writeFileSync(join(c.dir, "requirements.md"), "本人要求（补充）");
    assert.deepEqual(checkGates(FILM, id), []);
    appendFileSync(join(c.dir, "shots", "S01", "prompt-v1.txt"), "字");
    assert.deepEqual(checkGates(FILM, id), ["S01 审核后改过文件：shots/S01/prompt-v1.txt"]);
  });
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    put(c.dir, "shots/S02/prompt-v2.txt", "新提示词");
    assert.deepEqual(checkGates(FILM, id), ["S02 审核后改过文件：shots/S02/prompt-v2.txt"]);
  });
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    put(c.dir, "shots/S01/last-v2.png", PNG("new-last"));
    assert.deepEqual(checkGates(FILM, id), ["S01 审核后改过文件：shots/S01/last-v2.png"]);
  });
});

test("闸门 4：报价之后又审核过（审核记录不是报价时那份）也被拒", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    review(c.dir, "S01", 2, "pass");
    assert.deepEqual(checkGates(FILM, id), ["S01 报价后又审核过，请重新报价"]);
  });
});

test("闸门 5：没有批准 / 批准金额对不上 / 批准的不是这份报价", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    const p = join(c.dir, "approvals", `${id}.json`);
    const a = JSON.parse(readFileSync(p, "utf8"));
    writeFileSync(p, JSON.stringify({ ...a, totalCNY: 0.5 }));
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 还没有本人批准`]);
    writeFileSync(p, JSON.stringify({ ...a, totalCNY: "1.5" }));
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 还没有本人批准`]);
    writeFileSync(p, JSON.stringify({ ...a, quote: "Q7" }));
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 还没有本人批准`]);
    unlinkSync(p);
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 还没有本人批准`]);
  });
});

test("闸门 6：提交时按 spend.jsonl 重算，会超预算就拒", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    writeFileSync(join(c.dir, "spend.jsonl"), JSON.stringify({ quote: "Q0", shot: "X", cny: 98.6 }) + "\n");
    assert.deepEqual(checkGates(FILM, id), ["花费会超预算：已花 ¥98.6 + 本次 ¥1.5 > 预算 ¥100.0"]);
  });
});

test("闸门 7：报价已经提交过", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    writeFileSync(join(c.dir, "spend.jsonl"), JSON.stringify({ quote: id, shot: "S01", task: "t", cny: 0.75 }) + "\n");
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 已经提交过`]);
  });
});

// ---------- submit ----------

test("submit：闸门通过后逐镜头建任务、记账、改状态；请求格式与鉴权头正确；输出不含 Key", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    c.out.length = 0;
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    const creates = c.gw.creates();
    assert.equal(creates.length, 2);
    for (const [i, s] of ["S01", "S02"].entries()) {
      const r = creates[i];
      assert.equal(r.authorization, `Bearer ${KEY}`);
      const b = r.body as any;
      assert.equal(b.model, "seedance-2.0-mini");
      assert.equal(b.prompt, `${s} 的七段式提示词`);
      assert.equal(b.seconds, 5);
      assert.equal(b.resolution, "720p");
      assert.equal(b.aspect_ratio, "16:9");
      assert.equal(b.task_mode, "first_last_frame");
      assert.deepEqual(b.content, [
        { type: "image_url", role: "first_frame", url: "data:image/png;base64," + Buffer.from(PNG(`${s}-first`)).toString("base64") },
        { type: "image_url", role: "last_frame", url: "data:image/png;base64," + Buffer.from(PNG(`${s}-last`)).toString("base64") },
      ]);
    }
    const rows = spendLines(c.dir);
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["at", "baseUrl", "billable", "cny", "model", "quote", "shot", "task"]);
    assert.equal(rows[0].baseUrl, c.gw.url);
    assert.equal(rows[0].quote, id);
    assert.equal(rows[0].shot, "S01");
    assert.equal(rows[0].task, "task_fake0001");
    assert.equal(rows[0].model, "seedance-2.0-mini");
    assert.equal(rows[0].billable, 5);
    assert.ok(Math.abs(rows[0].cny - 0.75) < 1e-9);
    const st = readState(FILM);
    assert.equal(st.shots.S01.status, "generating");
    assert.equal(st.shots.S02.status, "generating");
    assert.ok(Math.abs(st.spentCNY - 1.5) < 1e-9);
    noKey(c);
    for (const f of ["spend.jsonl", "state.json"]) assert.ok(!readFileSync(join(c.dir, f), "utf8").includes(KEY));
  });
});

test("submit 2.0：请求体 model 是 seedance-2.0，格式与 mini 相同（首尾帧），按 0.45/秒记账", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02", "2.0");
    c.out.length = 0;
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    const creates = c.gw.creates();
    assert.equal(creates.length, 2);
    for (const [i, s] of ["S01", "S02"].entries()) {
      const b = creates[i].body as any;
      assert.equal(b.model, "seedance-2.0");
      assert.equal(b.seconds, 5);
      assert.equal(b.resolution, "720p");
      assert.equal(b.task_mode, "first_last_frame");
      assert.deepEqual(b.content.map((x: any) => x.role), ["first_frame", "last_frame"]);
      assert.equal(b.content[0].url, "data:image/png;base64," + Buffer.from(PNG(`${s}-first`)).toString("base64"));
    }
    const rows = spendLines(c.dir);
    assert.deepEqual(rows.map((r) => [r.model, r.billable, r.cny]), [["seedance-2.0", 5, 2.25], ["seedance-2.0", 5, 2.25]]);
    assert.ok(Math.abs(readState(FILM).spentCNY - 4.5) < 1e-9);
    noKey(c);
  });
});

test("submit：闸门不过就逐条打印原因、退出 1、不发任何请求", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    unlinkSync(join(c.dir, "approvals", `${id}.json`));
    appendFileSync(join(c.dir, "shots", "S01", "prompt-v1.txt"), "字");
    c.out.length = 0;
    assert.equal(await main(["submit", FILM, "--quote", id]), 1);
    assert.ok(c.out.includes("S01 审核后改过文件：shots/S01/prompt-v1.txt"));
    assert.ok(c.out.includes(`报价 ${id} 还没有本人批准`));
    assert.equal(c.gw.requests.length, 0);
    assert.deepEqual(spendLines(c.dir), []);
  });
});

test("rejects quote already submitted：第二次提交退出 1，网关只收到第一次的请求，spend.jsonl 行数不变", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    assert.equal(c.gw.creates().length, 2);
    assert.equal(await main(["submit", FILM, "--quote", id]), 1);
    assert.ok(c.out.includes(`报价 ${id} 已经提交过`));
    assert.equal(c.gw.creates().length, 2);
    assert.equal(spendLines(c.dir).length, 2);
  });
});

test("stops batch on arrears：3 镜，第 2 个请求欠费 → 退出 4，只记 1 行，网关只收到 2 个请求", async () => {
  await withFilm({ shots: ["S01", "S02", "S03"], gw: { creates: ["ok", "arrears"] } }, async (c) => {
    const id = await quoteAndApprove("S01,S02,S03");
    c.out.length = 0;
    assert.equal(await main(["submit", FILM, "--quote", id]), 4);
    assert.ok(c.out.includes("欠费：已提交 1 镜，其余未提交"), c.out.join("\n"));
    assert.equal(spendLines(c.dir).length, 1);
    assert.equal(c.gw.creates().length, 2);
    const st = readState(FILM);
    assert.equal(st.shots.S01.status, "generating");
    assert.equal(st.shots.S02.status, "ready");
    assert.equal(st.shots.S03.status, "ready");
    noKey(c);
  });
});

test("网关报错正文里带 Key 时打印前脱敏；退出 1，不记账", async () => {
  await withFilm({ gw: { creates: ["echo-key"] } }, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    c.out.length = 0;
    assert.equal(await main(["submit", FILM, "--quote", id]), 1);
    assert.match(c.out.join("\n"), /HTTP 400/);
    assert.equal(c.gw.creates().length, 1);
    assert.deepEqual(spendLines(c.dir), []);
    noKey(c);
  });
});

test("提交时连接断开（结果不明）：退出 1，按可能已扣费记账，之后同一报价不能再提交", async () => {
  await withFilm({ gw: { creates: ["crash"] } }, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    c.out.length = 0;
    assert.equal(await main(["submit", FILM, "--quote", id]), 1);
    assert.match(c.out.join("\n"), /结果不明/);
    const rows = spendLines(c.dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].task, null);
    assert.equal(rows[0].uncertain, true);
    assert.equal(rows[0].baseUrl, c.gw.url);
    assert.ok(Math.abs(rows[0].cny - 0.75) < 1e-9);
    assert.equal(c.gw.creates().length, 1);
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 已经提交过`]);
    noKey(c);
  });
});

/** 把片子里所有镜头的片中时长改成 seconds（5 秒按计费规则算 6 秒）。 */
function setShotSeconds(dir: string, seconds: number): void {
  const p = join(dir, "state.json");
  const st = JSON.parse(readFileSync(p, "utf8"));
  for (const s of Object.values(st.shots) as any[]) s.seconds = seconds;
  writeFileSync(p, JSON.stringify(st, null, 2));
}

test("D2：spend.jsonl 的 cny 写入时取整到分：6 秒 × 0.15 读回来是 0.9（正常行和结果不明行）", async () => {
  for (const creates of [["ok"], ["crash"]] as VideoServerOptions["creates"][]) {
    await withFilm({ shots: ["S01"], gw: { creates } }, async (c) => {
      setShotSeconds(c.dir, 5);
      const id = await quoteAndApprove("S01");
      assert.equal(JSON.parse(readFileSync(join(c.dir, "quotes", `${id}.json`), "utf8")).shots[0].billable, 6);
      await main(["submit", FILM, "--quote", id]);
      const rows = spendLines(c.dir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].cny, 0.9, `${creates}: ${readFileSync(join(c.dir, "spend.jsonl"), "utf8")}`);
      assert.ok(!readFileSync(join(c.dir, "spend.jsonl"), "utf8").includes("0.8999"));
    });
  }
});

test("没设 SEEDANCE_API_KEY：退出 1，不发请求", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    delete process.env.SEEDANCE_API_KEY;
    for (const argv of [["submit", FILM, "--quote", id], ["poll", FILM], ["fetch", FILM], ["wait", FILM]]) {
      c.out.length = 0;
      assert.equal(await main(argv), 1, argv.join(" "));
      assert.equal(c.out.at(-1), "没有设置 SEEDANCE_API_KEY");
    }
    assert.equal(c.gw.requests.length, 0);
  });
});

test("另一个提交正在进行（有锁文件）：退出 1，不发请求", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    writeFileSync(join(c.dir, ".submit.lock"), "");
    assert.equal(await main(["submit", FILM, "--quote", id]), 1);
    assert.match(c.out.at(-1)!, /另一个提交正在进行/);
    assert.equal(c.gw.requests.length, 0);
  });
});

test("参数不对：退出 2", async () => {
  await withFilm({}, async () => {
    for (const argv of [[], ["submit", FILM], ["submit", FILM, "--quote"], ["bogus", FILM], ["wait", FILM, "--interval", "-1"], ["poll"]]) {
      assert.equal(await main(argv), 2, JSON.stringify(argv));
    }
  });
});

// ---------- poll / fetch / wait ----------

test("poll：有任务在跑时退出 10；--json 输出数组；全部结束退出 0", async () => {
  await withFilm({ gw: { succeedAfter: 2 } }, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    c.out.length = 0;
    assert.equal(await main(["poll", FILM, "--json"]), 10);
    const arr = JSON.parse(c.out.at(-1)!);
    assert.deepEqual(arr.map((x: any) => [x.shot, x.task, x.status]), [["S01", "task_fake0001", "queued"], ["S02", "task_fake0002", "queued"]]);
    assert.equal(await main(["poll", FILM]), 0);
    noKey(c);
  });
});

test("wait：第 3 次查询成功 → 下载 clip-v1.mp4、更新 state、退出 0", async () => {
  const video = new TextEncoder().encode("REAL-ENOUGH-MP4");
  await withFilm({ shots: ["S01"], gw: { succeedAfter: 3, video } }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    assert.equal(await main(["wait", FILM, "--interval", "0"]), 0);
    const clip = join(c.dir, "shots", "S01", "clip-v1.mp4");
    assert.deepEqual(new Uint8Array(readFileSync(clip)), video);
    const st = readState(FILM);
    assert.equal(st.shots.S01.clip, "shots/S01/clip-v1.mp4");
    assert.equal(st.shots.S01.status, "generated");
    const queries = c.gw.requests.filter((r) => r.method === "GET" && r.path === "/v1/videos/task_fake0001");
    assert.ok(queries.length >= 3);
    for (const r of c.gw.requests) assert.equal(r.authorization, `Bearer ${KEY}`);
    // 已下载的任务不再查询；再 wait 立即结束
    const before = c.gw.requests.length;
    assert.equal(await main(["wait", FILM, "--interval", "0"]), 0);
    assert.equal(c.gw.requests.length, before);
    noKey(c);
  });
});

test("wait --timeout 1：还没出完 → 退出 6", async () => {
  await withFilm({ shots: ["S01"], gw: { succeedAfter: 100000 } }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    c.out.length = 0;
    const t0 = Date.now();
    assert.equal(await main(["wait", FILM, "--interval", "0.2", "--timeout", "1"]), 6);
    assert.ok(Date.now() - t0 < 5000);
    assert.equal(c.out.at(-1), "还没出完，稍后再 wait");
    assert.equal(existsSync(join(c.dir, "shots", "S01", "clip-v1.mp4")), false);
  });
});

test("重拍后得到 clip-v2.mp4，clip-v1.mp4 还在", async () => {
  await withFilm({ shots: ["S01"] }, async (c) => {
    const q1 = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", q1]), 0);
    assert.equal(await main(["wait", FILM, "--interval", "0"]), 0);
    const q2 = await quoteAndApprove("S01");
    assert.notEqual(q2, q1);
    assert.equal(await main(["submit", FILM, "--quote", q2]), 0);
    assert.equal(await main(["fetch", FILM]), 0);
    assert.ok(existsSync(join(c.dir, "shots", "S01", "clip-v1.mp4")));
    assert.ok(existsSync(join(c.dir, "shots", "S01", "clip-v2.mp4")));
    assert.equal(readState(FILM).shots.S01.clip, "shots/S01/clip-v2.mp4");
    assert.equal(spendLines(c.dir).length, 2);
  });
});

test("fetch：失败的任务打印原因，状态记为 failed，之后不再查询", async () => {
  await withFilm({ shots: ["S01"], gw: { result: "fail" } }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    c.out.length = 0;
    assert.equal(await main(["fetch", FILM]), 0);
    assert.ok(c.out.includes("S01 生成失败：内容审核未通过"), c.out.join("\n"));
    assert.equal(readState(FILM).shots.S01.status, "failed");
    assert.equal(existsSync(join(c.dir, "shots", "S01", "clip-v1.mp4")), false);
    const before = c.gw.requests.length;
    assert.equal(await main(["poll", FILM]), 0);
    assert.equal(c.gw.requests.length, before);
  });
});

// ---------- 复审修复 ----------

test("建好任务后记账失败：打印任务号，保留锁，退出 7；再提交被锁挡住，网关只收到 1 个 POST", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    const real = io.appendJsonl;
    io.appendJsonl = () => {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    };
    try {
      c.out.length = 0;
      assert.equal(await main(["submit", FILM, "--quote", id]), 7);
    } finally {
      io.appendJsonl = real;
    }
    const text = c.out.join("\n");
    assert.match(text, /task_fake0001/);
    assert.match(text, /S01/);
    assert.match(text, /¥0\.75/);
    assert.match(text, /任务日志/);
    assert.ok(existsSync(join(c.dir, ".submit.lock")), "锁应该还在");
    assert.equal(await main(["submit", FILM, "--quote", id]), 1);
    assert.match(c.out.at(-1)!, /另一个提交正在进行/);
    assert.equal(c.gw.creates().length, 1);
    noKey(c);
  });
});

test("记账成功但 state.json 更新失败：这一镜算提交成功，只给警告，继续下一镜", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    const real = io.updateShot;
    io.updateShot = () => {
      throw new Error("EPERM: operation not permitted");
    };
    try {
      c.out.length = 0;
      assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    } finally {
      io.updateShot = real;
    }
    assert.equal(spendLines(c.dir).length, 2);
    assert.ok(c.out.some((l) => /S01/.test(l) && /state\.json 没有更新/.test(l)), c.out.join("\n"));
    assert.ok(c.out.some((l) => l.startsWith("已提交 S01：task_fake0001")));
    assert.equal(existsSync(join(c.dir, ".submit.lock")), false);
  });
});

test("wait：一个任务查询 404、一个成功 → 下载成功的、把 404 的记为失败、退出 0", async () => {
  await withFilm({ gw: { vanish: ["task_fake0002"] } }, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    c.out.length = 0;
    assert.equal(await main(["wait", FILM, "--interval", "0", "--timeout", "30"]), 0);
    assert.ok(existsSync(join(c.dir, "shots", "S01", "clip-v1.mp4")));
    const done = readFileSync(join(c.dir, "fetched.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const lost = done.find((r) => r.task === "task_fake0002");
    assert.equal(lost.status, "failed");
    assert.match(lost.error, /404/);
    assert.equal(readState(FILM).shots.S02.status, "failed");
    assert.ok(c.out.some((l) => l.startsWith("S02 生成失败：")), c.out.join("\n"));
  });
});

test("wait：同一任务连续 5 次查询出错 → 记为失败，不再拖住整片", async () => {
  await withFilm({ gw: { queryErrors: ["task_fake0001"] } }, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    assert.equal(await main(["wait", FILM, "--interval", "0", "--timeout", "30"]), 0);
    const q1 = c.gw.requests.filter((r) => r.method === "GET" && r.path === "/v1/videos/task_fake0001");
    assert.equal(q1.length, 5);
    assert.ok(existsSync(join(c.dir, "shots", "S02", "clip-v1.mp4")));
    assert.equal(readState(FILM).shots.S01.status, "failed");
  });
});

test("wait 超时时也把已经出好的片段下载下来，再退出 6", async () => {
  await withFilm({ gw: { stuck: ["task_fake0002"] } }, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    c.out.length = 0;
    assert.equal(await main(["wait", FILM, "--interval", "0.2", "--timeout", "1"]), 6);
    assert.equal(c.out.at(-1), "还没出完，稍后再 wait");
    assert.ok(existsSync(join(c.dir, "shots", "S01", "clip-v1.mp4")));
    assert.equal(readState(FILM).shots.S01.clip, "shots/S01/clip-v1.mp4");
    assert.equal(readState(FILM).shots.S02.status, "generating");
  });
});

// ---------- 终审 I1：查询出错不直接判死；嵌套状态；网关地址 ----------

function fetchedLines(dir: string): any[] {
  if (!existsSync(join(dir, "fetched.jsonl"))) return [];
  return readFileSync(join(dir, "fetched.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("I1：单次 fetch / poll 遇到 404 → 不写 fetched.jsonl，镜头仍在生成中", async () => {
  await withFilm({ shots: ["S01"], gw: { vanish: ["task_fake0001"] } }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    for (const cmd of ["fetch", "fetch", "poll", "poll", "fetch", "poll"]) await main([cmd, FILM]);
    assert.deepEqual(fetchedLines(c.dir), []);
    assert.equal(readState(FILM).shots.S01.status, "generating");
    c.out.length = 0;
    assert.equal(await main(["poll", FILM]), 10);
    assert.match(c.out.join("\n"), /S01 task_fake0001：查询失败：.*404/);
  });
});

test("I1：wait 里同一任务连续 404 达到上限（5 次）才判失败", async () => {
  await withFilm({ shots: ["S01"], gw: { vanish: ["task_fake0001"] } }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    assert.equal(await main(["wait", FILM, "--interval", "0", "--timeout", "30"]), 0);
    const q = c.gw.requests.filter((r) => r.method === "GET" && r.path === "/v1/videos/task_fake0001");
    assert.equal(q.length, 5);
    const rows = fetchedLines(c.dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "failed");
    assert.match(rows[0].error, /连续 5 次查询出错.*404/);
  });
});

test("I1：new-api 通用格式 {code,data:{status:\"SUCCESS\"}} 能解析，wait 下载到片子", async () => {
  await withFilm({ shots: ["S01"], gw: { queryShape: "data", succeedAfter: 2 } }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    c.out.length = 0;
    assert.equal(await main(["poll", FILM, "--json"]), 10);
    assert.equal(JSON.parse(c.out.at(-1)!)[0].status, "queued");
    assert.equal(await main(["wait", FILM, "--interval", "0", "--timeout", "30"]), 0);
    assert.ok(existsSync(join(c.dir, "shots", "S01", "clip-v1.mp4")));
  });
  await withFilm({ shots: ["S01"], gw: { queryShape: "data", result: "fail" } }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    c.out.length = 0;
    assert.equal(await main(["fetch", FILM]), 0);
    assert.ok(c.out.includes("S01 生成失败：上游失败"), c.out.join("\n"));
  });
});

test("I1：status 为空算查询出错，不当作生成中；单次 poll 不写记录，wait 连续 5 次才判失败", async () => {
  await withFilm({ shots: ["S01"], gw: { queryShape: "empty" } }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    c.out.length = 0;
    assert.equal(await main(["poll", FILM, "--json"]), 10);
    const r = JSON.parse(c.out.at(-1)!)[0];
    assert.equal(r.status, "unknown");
    assert.match(r.error, /没有可识别的状态/);
    assert.deepEqual(fetchedLines(c.dir), []);
    assert.equal(await main(["wait", FILM, "--interval", "0", "--timeout", "30"]), 0);
    const rows = fetchedLines(c.dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "failed");
    assert.match(rows[0].error, /连续 5 次查询出错/);
  });
});

test("I1：当前网关地址和提交时不同 → poll/fetch/wait 跳过这一行、不查询、不写 fetched.jsonl", async () => {
  await withFilm({ shots: ["S01"] }, async (c) => {
    const id = await quoteAndApprove("S01");
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    const submitted = c.gw.url;
    process.env.SEEDANCE_BASE_URL = submitted.replace("127.0.0.1", "localhost");
    const before = c.gw.requests.length;
    for (const argv of [["poll", FILM], ["fetch", FILM], ["wait", FILM, "--interval", "0", "--timeout", "5"]]) {
      c.out.length = 0;
      assert.equal(await main(argv), 0, argv.join(" "));
      assert.ok(c.out.includes(`S01 的任务是在 ${submitted} 提交的，当前网关地址不同，跳过`), c.out.join("\n"));
    }
    assert.equal(c.gw.requests.length, before);
    assert.deepEqual(fetchedLines(c.dir), []);
    // 地址改回来（末尾多一个 / 也算同一个）就能接着下载
    process.env.SEEDANCE_BASE_URL = submitted + "/";
    assert.equal(await main(["wait", FILM, "--interval", "0", "--timeout", "30"]), 0);
    assert.ok(existsSync(join(c.dir, "shots", "S01", "clip-v1.mp4")));
  });
});

test("I1：旧的 spend 行没有 baseUrl 时按默认地址算；当前地址不是默认地址就跳过", async () => {
  await withFilm({ shots: ["S01"] }, async (c) => {
    writeFileSync(join(c.dir, "spend.jsonl"), JSON.stringify({ quote: "Q1", shot: "S01", task: "task_old", cny: 0.75 }) + "\n");
    c.out.length = 0;
    assert.equal(await main(["fetch", FILM]), 0);
    assert.ok(c.out.includes("S01 的任务是在 https://newapi.dragon3api.com 提交的，当前网关地址不同，跳过"), c.out.join("\n"));
    assert.equal(c.gw.requests.length, 0);
    assert.deepEqual(fetchedLines(c.dir), []);
  });
});

// ---------- 终审 I2：结果不明的提交由本人核对 ----------

/** 提交时连接断开 → S01 一行 uncertain。返回报价号。 */
async function uncertainSubmit(c: Ctx): Promise<string> {
  const id = await quoteAndApprove("S01,S02");
  assert.equal(await main(["submit", FILM, "--quote", id]), 1);
  const rows = spendLines(c.dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uncertain, true);
  return id;
}

test("I2：reconcile --task 之后 wait 能下载到这一镜；只追加一行，旧行不变", async () => {
  await withFilm({ gw: { creates: ["crash"], known: ["task_lost01"] } }, async (c) => {
    const id = await uncertainSubmit(c);
    const before = readFileSync(join(c.dir, "spend.jsonl"), "utf8");
    c.out.length = 0;
    assert.equal(await main(["reconcile", FILM, "--quote", id, "--shot", "S01", "--task", "task_lost01", "--note", "网关后台查到了"]), 0, c.out.join("\n"));
    const after = readFileSync(join(c.dir, "spend.jsonl"), "utf8");
    assert.ok(after.startsWith(before));
    const rows = spendLines(c.dir);
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[1]).sort(), ["at", "note", "quote", "reconcile", "shot", "task"]);
    assert.equal(rows[1].reconcile, "created");
    assert.equal(rows[1].task, "task_lost01");
    assert.equal(rows[1].note, "网关后台查到了");
    assert.equal(readState(FILM).shots.S01.status, "generating");
    assert.equal(await main(["wait", FILM, "--interval", "0", "--timeout", "30"]), 0);
    assert.ok(existsSync(join(c.dir, "shots", "S01", "clip-v1.mp4")));
    assert.equal(readState(FILM).shots.S01.clip, "shots/S01/clip-v1.mp4");
    // 已花金额不变（建成了就是花了）；同一报价仍不能再提交
    assert.ok(Math.abs(readState(FILM).spentCNY - 0.75) < 1e-9);
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 已经提交过`]);
    assert.equal(c.gw.creates().length, 1);
    noKey(c);
  });
});

test("I2：reconcile --not-created 之后已花金额扣掉那一行；quote.ts 和闸门 6 用同一个数；闸门 7 照旧", async () => {
  await withFilm({ gw: { creates: ["crash"] } }, async (c) => {
    const id = await uncertainSubmit(c);
    assert.ok(Math.abs(readState(FILM).spentCNY - 0.75) < 1e-9);
    assert.equal(await main(["reconcile", FILM, "--quote", id, "--shot", "S01", "--not-created", "--note", "后台没有这个任务，也没扣费"]), 0);
    const rows = spendLines(c.dir);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].reconcile, "not-created");
    assert.equal(rows[1].task, undefined);
    assert.equal(rows[1].cny, undefined);
    assert.equal(readState(FILM).spentCNY, 0);
    assert.deepEqual(checkGates(FILM, id), [`报价 ${id} 已经提交过`]);
    // 新报价的"已花"是 0
    assert.equal(await quote([FILM, "--shots", "S01"]), 0);
    assert.match(c.out.at(-1)!, /已花 ¥0\.0，预算余 ¥100\.0$/);
    // 没建成的镜头没有任务可查
    const before = c.gw.requests.length;
    assert.equal(await main(["poll", FILM]), 0);
    assert.equal(c.gw.requests.length, before);
  });
});

test("I2：没有 uncertain 行时 reconcile 退出 1，不写任何东西", async () => {
  await withFilm({}, async (c) => {
    const id = await quoteAndApprove("S01,S02");
    assert.equal(await main(["reconcile", FILM, "--quote", id, "--shot", "S01", "--not-created", "--note", "x"]), 1);
    assert.equal(await main(["submit", FILM, "--quote", id]), 0);
    const before = readFileSync(join(c.dir, "spend.jsonl"), "utf8");
    c.out.length = 0;
    assert.equal(await main(["reconcile", FILM, "--quote", id, "--shot", "S01", "--task", "task_x", "--note", "x"]), 1);
    assert.match(c.out.at(-1)!, /没有结果不明/);
    assert.equal(readFileSync(join(c.dir, "spend.jsonl"), "utf8"), before);
  });
});

test("I2：同一镜头不能重复核对（无论哪种），退出 1", async () => {
  await withFilm({ gw: { creates: ["crash"] } }, async (c) => {
    const id = await uncertainSubmit(c);
    assert.equal(await main(["reconcile", FILM, "--quote", id, "--shot", "S01", "--not-created", "--note", "没建成"]), 0);
    c.out.length = 0;
    assert.equal(await main(["reconcile", FILM, "--quote", id, "--shot", "S01", "--not-created", "--note", "再来"]), 1);
    assert.match(c.out.at(-1)!, /已经核对过/);
    assert.equal(await main(["reconcile", FILM, "--quote", id, "--shot", "S01", "--task", "task_y", "--note", "再来"]), 1);
    assert.equal(spendLines(c.dir).length, 2);
    assert.equal(readState(FILM).spentCNY, 0);
  });
});

test("I2：reconcile 参数不对退出 2（缺 --note、两种都给、都不给、报价号不合法）", async () => {
  await withFilm({ gw: { creates: ["crash"] } }, async (c) => {
    const id = await uncertainSubmit(c);
    for (const argv of [
      ["reconcile", FILM, "--quote", id, "--shot", "S01", "--not-created"],
      ["reconcile", FILM, "--quote", id, "--shot", "S01", "--not-created", "--note", "  "],
      ["reconcile", FILM, "--quote", id, "--shot", "S01", "--task", "t1", "--not-created", "--note", "x"],
      ["reconcile", FILM, "--quote", id, "--shot", "S01", "--note", "x"],
      ["reconcile", FILM, "--quote", "q1", "--shot", "S01", "--not-created", "--note", "x"],
      ["reconcile", FILM, "--shot", "S01", "--not-created", "--note", "x"],
      ["reconcile", FILM, "--quote", id, "--shot", "S01", "--task", "a b", "--note", "x"],
    ]) {
      assert.equal(await main(argv), 2, JSON.stringify(argv));
    }
    assert.equal(spendLines(c.dir).length, 1);
  });
});
