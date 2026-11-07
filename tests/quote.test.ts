import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { billableSeconds, buildQuote, main } from "../scripts/quote.ts";
import { sha256File } from "../scripts/lib/hash.ts";
import type { FilmState } from "../scripts/lib/state.ts";

const FILM = "测试片";

/** 临时 FILM_ROOT（含一部片子）+ 环境变量恢复 + 捕获 console 输出。 */
async function withFilm(
  opts: { budget: number | null; shots: Record<string, number>; spent?: number[] },
  fn: (dir: string, out: string[]) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "film-quote-"));
  const saved = process.env.FILM_ROOT;
  const out: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    process.env.FILM_ROOT = root;
    const dir = join(root, "films", FILM);
    for (const d of ["reviews", "quotes"]) mkdirSync(join(dir, d), { recursive: true });
    const state: FilmState = {
      film: FILM,
      stage: "generate",
      settings: { seconds: 10, aspect: "16:9", budgetCNY: opts.budget, music: null, subtitles: false, model: "mini" },
      gates: {},
      shots: Object.fromEntries(
        Object.entries(opts.shots).map(([k, s]) => [k, { seconds: s, status: "ready", clip: null }]),
      ),
      spentCNY: 0,
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
    if (opts.spent) {
      writeFileSync(
        join(dir, "spend.jsonl"),
        opts.spent.map((cny, i) => JSON.stringify({ shot: `X${i}`, cny })).join("\n") + "\n",
      );
    }
    await fn(dir, out);
  } finally {
    console.log = log;
    console.error = err;
    if (saved === undefined) delete process.env.FILM_ROOT;
    else process.env.FILM_ROOT = saved;
    rmSync(root, { recursive: true, force: true });
  }
}

function review(dir: string, shot: string, n: number, verdict: "pass" | "fail"): string {
  const path = join(dir, "reviews", `pre-submit-${shot}-v${n}.json`);
  writeFileSync(
    path,
    JSON.stringify({ kind: "pre-submit", film: FILM, shot, verdict, at: new Date().toISOString(), files: {} }),
  );
  return path;
}

test("billableSeconds：向上取整，余量不足 0.5 秒再加 1 秒", () => {
  assert.equal(billableSeconds(4), 5);
  assert.equal(billableSeconds(4.4), 5);
  assert.equal(billableSeconds(4.5), 6);
  assert.equal(billableSeconds(4.6), 6);
  assert.equal(billableSeconds(0.3), 2);
});

test("两镜各 4.4 秒：mini 合计 5.0，2.5 合计 15.0；reviewHash 是最新审核文件的哈希", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4, S02: 4.4 } }, (dir) => {
    review(dir, "S01", 1, "pass");
    const latest = review(dir, "S01", 2, "pass");
    review(dir, "S02", 1, "pass");
    const q = buildQuote(FILM, ["S01", "S02"]);
    assert.equal(q.model, "mini");
    assert.equal(q.modelId, "doubao-seedance-2-0-mini-260615");
    assert.equal(q.totalCNY, 5.0);
    assert.equal(q.overBudget, false);
    assert.deepEqual(q.shots.map((s) => [s.shot, s.seconds, s.billable]), [["S01", 4.4, 5], ["S02", 4.4, 5]]);
    assert.equal(q.shots[0].reviewHash, sha256File(latest));
    const q25 = buildQuote(FILM, ["S01", "S02"], "2.5");
    assert.equal(q25.modelId, "doubao-seedance-2-5-260628");
    assert.equal(q25.totalCNY, 15.0);
  });
});

test("预算 10、已花 6、报价 5：overBudget，打印以超预算开头，退出码 2", async () => {
  await withFilm({ budget: 10, shots: { S01: 4.4, S02: 4.4 }, spent: [2.5, 3.5] }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    review(dir, "S02", 1, "pass");
    const q = buildQuote(FILM, ["S01", "S02"]);
    assert.equal(q.spentCNY, 6);
    assert.equal(q.budgetCNY, 10);
    assert.equal(q.overBudget, true);
    const code = await main([FILM, "--shots", "S01,S02"]);
    assert.equal(code, 2);
    assert.match(out.at(-1)!, /^超预算/);
    const saved = JSON.parse(readFileSync(join(dir, "quotes", "Q1.json"), "utf8"));
    assert.equal(saved.overBudget, true);
  });
});

test("镜头没有审核、最新审核不通过时报错", async () => {
  await withFilm({ budget: 100, shots: { S01: 4, S02: 4 } }, (dir) => {
    review(dir, "S02", 1, "pass");
    assert.throws(() => buildQuote(FILM, ["S01", "S02"]), /S01 还没有通过提交前审核/);
    review(dir, "S02", 2, "fail");
    assert.throws(() => buildQuote(FILM, ["S02"]), /S02 还没有通过提交前审核/);
    // v10 比 v9 新（数字比较，不是字符串比较）
    review(dir, "S01", 9, "fail");
    review(dir, "S01", 10, "pass");
    assert.equal(buildQuote(FILM, ["S01"]).totalCNY, 2.5);
  });
});

test("连续两次报价得到 Q1、Q2，打印报价句子", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4, S02: 4.4 }, spent: [1] }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    review(dir, "S02", 1, "pass");
    assert.equal(await main([FILM, "--shots", "S01,S02"]), 0);
    assert.equal(
      out.at(-1),
      "报价 Q1：2 镜 10 秒 mini 约 ¥5.0（估算，以账单为准）；已花 ¥1.0，预算余 ¥99.0",
    );
    assert.equal(await main([FILM, "--shots", "S01", "--model", "2.5"]), 0);
    assert.match(out.at(-1)!, /^报价 Q2：1 镜 5 秒 2\.5 约 ¥7\.5/);
    assert.deepEqual(readdirSync(join(dir, "quotes")).sort(), ["Q1.json", "Q2.json"]);
    const q2 = JSON.parse(readFileSync(join(dir, "quotes", "Q2.json"), "utf8"));
    assert.equal(q2.id, "Q2");
    assert.equal(q2.film, FILM);
    assert.equal(q2.model, "2.5");
  });
});

test("没设总预算、未知镜头、缺参数时退出码 2 且不写报价", async () => {
  await withFilm({ budget: null, shots: { S01: 4 } }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    assert.equal(await main([FILM, "--shots", "S01"]), 2);
    assert.match(out.at(-1)!, /还没有设总预算/);
    assert.deepEqual(readdirSync(join(dir, "quotes")), []);
  });
  await withFilm({ budget: 100, shots: { S01: 4 } }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    assert.equal(await main([FILM, "--shots", "S01,S09"]), 2);
    assert.match(out.at(-1)!, /没有这个镜头：S09/);
    assert.equal(await main([FILM]), 2);
    assert.equal(await main([FILM, "--shots", "S01", "--model", "3.0"]), 2);
    assert.deepEqual(readdirSync(join(dir, "quotes")), []);
  });
});
