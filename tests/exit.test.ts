// D1：CLI 不能用 process.exit() 结束（Windows 上 fetch 的连接还在关时调用会触发 libuv 断言，退出码变 127）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/lib/proc.ts";
import { startVideoServer } from "./fakes/video-server.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEEDANCE = join(REPO, "scripts", "seedance.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|js)$/.test(name)) out.push(p);
  }
  return out;
}

test("D1 静态检查：scripts 下的 .ts/.js 不用 process.exit(（claude-official.js 转发子进程退出码那一处例外）", () => {
  const files = walk(join(REPO, "scripts"));
  assert.ok(files.some((f) => f.endsWith("seedance.ts")));
  const hits: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.includes("process.exit(")) return;
      const rel = f.slice(REPO.length + 1).replace(/\\/g, "/");
      if (rel === "scripts/bin/claude-official.js" && line.trim() === "process.exit(signal ? 1 : (code ?? 1));") return;
      hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
  // 例外那一处还在（转发子进程退出码不受影响）
  assert.match(readFileSync(join(REPO, "scripts", "bin", "claude-official.js"), "utf8"), /child\.on\("exit"[\s\S]*process\.exit\(signal \? 1 : \(code \?\? 1\)\)/);
});

test("D1 子进程真跑：seedance.ts wait 下载完退出码 0，10 秒内自己结束；缺参数仍退出 2", async () => {
  const root = mkdtempSync(join(tmpdir(), "film-exit-"));
  const gw = await startVideoServer({ known: ["task_known01"], succeedAfter: 2 });
  try {
    const film = "退出片";
    const dir = join(root, "films", film);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        film,
        stage: "generate",
        settings: { seconds: 5, aspect: "16:9", budgetCNY: 100, music: null, subtitles: false, model: "mini" },
        gates: {},
        shots: { S01: { seconds: 5, status: "generating", clip: null } },
        spentCNY: 0.9,
      }),
    );
    writeFileSync(
      join(dir, "spend.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), quote: "Q1", shot: "S01", model: "seedance-2.0-mini", billable: 6, cny: 0.9, baseUrl: gw.url, task: "task_known01" }) + "\n",
    );
    const saved = { FILM_ROOT: process.env.FILM_ROOT, SEEDANCE_BASE_URL: process.env.SEEDANCE_BASE_URL, SEEDANCE_API_KEY: process.env.SEEDANCE_API_KEY };
    process.env.FILM_ROOT = root;
    process.env.SEEDANCE_BASE_URL = gw.url;
    process.env.SEEDANCE_API_KEY = "test";
    try {
      // run() 是异步 spawn，不挡住本进程里的假网关；超过 10 秒就杀掉并返回 124
      const t0 = Date.now();
      const r = await run([process.execPath, SEEDANCE, "wait", film, "--interval", "0.2", "--timeout", "30"], { timeoutMs: 10_000 });
      assert.equal(r.code, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
      assert.ok(Date.now() - t0 < 10_000);
      assert.match(r.stdout, /S01 已下载：shots\/S01\/clip-v1\.mp4/);
      assert.ok(!r.stderr.includes("Assertion failed"), r.stderr);

      const bad = await run([process.execPath, SEEDANCE, "wait"], { timeoutMs: 10_000 });
      assert.equal(bad.code, 2, bad.stderr);
      assert.match(bad.stderr, /用法/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  } finally {
    await gw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
