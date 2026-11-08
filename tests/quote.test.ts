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

test("billableSeconds：向上取整，余量不足 0.5 秒再加 1 秒；最少 4 秒（网关 Seedance 最短 4 秒）", () => {
  assert.equal(billableSeconds(4), 5);
  assert.equal(billableSeconds(4.4), 5);
  assert.equal(billableSeconds(4.5), 6);
  assert.equal(billableSeconds(4.6), 6);
  assert.equal(billableSeconds(0.3), 4);
  assert.equal(billableSeconds(2.6), 4);
  assert.equal(billableSeconds(3.2), 4);
  assert.equal(billableSeconds(3.5), 5);
});

test("两镜各 4.4 秒：mini 合计 1.5，2.5 合计 5.5；reviewHash 是最新审核文件的哈希", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4, S02: 4.4 } }, (dir) => {
    review(dir, "S01", 1, "pass");
    const latest = review(dir, "S01", 2, "pass");
    review(dir, "S02", 1, "pass");
    const q = buildQuote(FILM, ["S01", "S02"]);
    assert.equal(q.model, "mini");
    assert.equal(q.modelId, "seedance-2.0-mini");
    assert.equal(q.totalCNY, 1.5);
    assert.equal(q.overBudget, false);
    assert.deepEqual(q.shots.map((s) => [s.shot, s.seconds, s.billable]), [["S01", 4.4, 5], ["S02", 4.4, 5]]);
    assert.equal(q.shots[0].reviewHash, sha256File(latest));
  });
});

test("预算 7、已花 6、报价 1.5：overBudget，打印以超预算开头，退出码 2", async () => {
  await withFilm({ budget: 7, shots: { S01: 4.4, S02: 4.4 }, spent: [2.5, 3.5] }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    review(dir, "S02", 1, "pass");
    const q = buildQuote(FILM, ["S01", "S02"]);
    assert.equal(q.spentCNY, 6);
    assert.equal(q.budgetCNY, 7);
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
    assert.equal(buildQuote(FILM, ["S01"]).totalCNY, 0.8);
  });
});

test("连续两次报价得到 Q1、Q2，打印报价句子", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4, S02: 4.4 }, spent: [1] }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    review(dir, "S02", 1, "pass");
    assert.equal(await main([FILM, "--shots", "S01,S02"]), 0);
    assert.equal(
      out.at(-1),
      "报价 Q1：2 镜 10 秒 mini 约 ¥1.5（估算，以账单为准）；已花 ¥1.0，预算余 ¥99.0",
    );
    assert.equal(await main([FILM, "--shots", "S01"]), 0);
    assert.match(out.at(-1)!, /^报价 Q2：1 镜 5 秒 mini 约 ¥0\.8/);
    assert.deepEqual(readdirSync(join(dir, "quotes")).sort(), ["Q1.json", "Q2.json"]);
    const q2 = JSON.parse(readFileSync(join(dir, "quotes", "Q2.json"), "utf8"));
    assert.equal(q2.id, "Q2");
    assert.equal(q2.film, FILM);
    assert.equal(q2.model, "mini");
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

test("billableSeconds：0、负数、非有限数抛错", () => {
  assert.throws(() => billableSeconds(0), /秒数不合法/);
  assert.throws(() => billableSeconds(-3), /秒数不合法/);
  assert.throws(() => billableSeconds(Number.NaN), /秒数不合法/);
  assert.throws(() => billableSeconds(Infinity), /秒数不合法/);
});

test("spend.jsonl 有坏的 cny 行：报错、退出 2、不写报价", async () => {
  for (const bad of [{ shot: "X" }, { cny: "3" }, { cny: -1 }]) {
    await withFilm({ budget: 100, shots: { S01: 4 } }, async (dir, out) => {
      review(dir, "S01", 1, "pass");
      writeFileSync(join(dir, "spend.jsonl"), JSON.stringify({ cny: 1 }) + "\n" + JSON.stringify(bad) + "\n");
      assert.throws(() => buildQuote(FILM, ["S01"]), /spend\.jsonl 第 2 行/);
      assert.equal(await main([FILM, "--shots", "S01"]), 2);
      assert.match(out.at(-1)!, /spend\.jsonl 第 2 行的 cny 不合法/);
      assert.deepEqual(readdirSync(join(dir, "quotes")), []);
    });
  }
  await withFilm({ budget: 100, shots: { S01: 4 } }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    writeFileSync(join(dir, "spend.jsonl"), "{not json\n");
    assert.equal(await main([FILM, "--shots", "S01"]), 2);
    assert.match(out.at(-1)!, /spend\.jsonl 第 1 行不是合法的 JSON/);
    assert.deepEqual(readdirSync(join(dir, "quotes")), []);
  });
});

test("镜头秒数缺失或不是数：报错、退出 2、不写报价", async () => {
  await withFilm({ budget: 100, shots: { S01: 4 } }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    const sp = join(dir, "state.json");
    const st = JSON.parse(readFileSync(sp, "utf8"));
    delete st.shots.S01.seconds;
    writeFileSync(sp, JSON.stringify(st));
    assert.throws(() => buildQuote(FILM, ["S01"]), /S01 的秒数不合法/);
    assert.equal(await main([FILM, "--shots", "S01"]), 2);
    assert.match(out.at(-1)!, /S01 的秒数不合法/);
    assert.deepEqual(readdirSync(join(dir, "quotes")), []);
  });
});

test("预算比较用未四舍五入的已花：已花 6.04 + 报价 1.5 > 预算 7.5", async () => {
  await withFilm({ budget: 7.5, shots: { S01: 4.4, S02: 4.4 }, spent: [3, 3.04] }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    review(dir, "S02", 1, "pass");
    const q = buildQuote(FILM, ["S01", "S02"]);
    assert.equal(q.totalCNY, 1.5);
    assert.equal(q.spentCNY, 6.0);
    assert.equal(q.overBudget, true);
    assert.equal(await main([FILM, "--shots", "S01,S02"]), 2);
    assert.match(out.at(-1)!, /^超预算/);
  });
});

test("不支持首尾帧的模型（2.5）不报价：退出 2，不写报价", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4 } }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    assert.throws(() => buildQuote(FILM, ["S01"], "2.5"), /^Error: 模型 seedance-2\.5 不支持首尾帧，不能用于本流程$/);
    assert.equal(await main([FILM, "--shots", "S01", "--model", "2.5"]), 2);
    assert.equal(out.at(-1), "模型 seedance-2.5 不支持首尾帧，不能用于本流程");
    assert.deepEqual(readdirSync(join(dir, "quotes")), []);
  });
});

test("计费秒数超过模型单镜上限（mini 15 秒）：退出 2，不写报价；正好 15 秒可以", async () => {
  await withFilm({ budget: 100, shots: { S01: 14.6, S02: 14.4 } }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    review(dir, "S02", 1, "pass");
    assert.equal(await main([FILM, "--shots", "S02,S01"]), 2);
    assert.equal(out.at(-1), "S01 计费 16 秒，超过 seedance-2.0-mini 单镜上限 15 秒，请拆镜头");
    assert.deepEqual(readdirSync(join(dir, "quotes")), []);
    assert.equal(buildQuote(FILM, ["S02"]).shots[0].billable, 15);
  });
});

test("I2：spentFromRows 扣掉核对为没建成的 uncertain 行，不会变成负数；核对行本身不算钱", async () => {
  const { spentFromRows } = await import("../scripts/quote.ts");
  const rows = [
    { quote: "Q1", shot: "S01", task: "t1", cny: 0.75 },
    { quote: "Q2", shot: "S01", task: null, uncertain: true, cny: 0.75 },
    { quote: "Q2", shot: "S02", task: null, uncertain: true, cny: 1.5 },
    { quote: "Q2", shot: "S01", reconcile: "not-created", note: "x", cny: 0 },
    { quote: "Q2", shot: "S02", reconcile: "created", task: "t9", note: "x", cny: 0 },
  ];
  assert.ok(Math.abs(spentFromRows(rows as any) - 2.25) < 1e-9);
  assert.equal(spentFromRows([{ quote: "Q3", shot: "S01", reconcile: "not-created", note: "x", cny: 0 }] as any), 0);
});

test("I2：spend.jsonl 里的核对行（没有 cny）可以读；坏的核对行报错", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4 } }, (dir) => {
    const lines = [
      { quote: "Q1", shot: "S01", task: null, uncertain: true, cny: 0.75 },
      { at: "2026-11-08T00:00:00Z", quote: "Q1", shot: "S01", reconcile: "not-created", note: "没建成" },
    ];
    writeFileSync(join(dir, "spend.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    review(dir, "S01", 1, "pass");
    assert.equal(buildQuote(FILM, ["S01"]).spentCNY, 0);
    writeFileSync(join(dir, "spend.jsonl"), JSON.stringify({ quote: "Q1", shot: "S01", reconcile: "maybe", note: "x" }) + "\n");
    assert.throws(() => buildQuote(FILM, ["S01"]), /spend\.jsonl 第 1 行/);
    writeFileSync(join(dir, "spend.jsonl"), JSON.stringify({ quote: "Q1", shot: "S01", reconcile: "not-created", note: "x", cny: -1 }) + "\n");
    assert.throws(() => buildQuote(FILM, ["S01"]), /spend\.jsonl 第 1 行/);
  });
});

test("2.0（seedance-2.0 满血）：两镜各 4.4 秒，每镜计费 5 秒，合计 10 × 0.45 = 4.5", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4, S02: 4.4 } }, (dir) => {
    review(dir, "S01", 1, "pass");
    review(dir, "S02", 1, "pass");
    const q = buildQuote(FILM, ["S01", "S02"], "2.0");
    assert.equal(q.model, "2.0");
    assert.equal(q.modelId, "seedance-2.0");
    assert.deepEqual(q.shots.map((s) => s.billable), [5, 5]);
    assert.equal(q.totalCNY, 4.5);
    assert.equal(q.overBudget, false);
  });
});

test("--model 2.0 写出报价文件，modelId 是 seedance-2.0；单镜上限 15 秒", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4, S02: 14.6 } }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    review(dir, "S02", 1, "pass");
    assert.equal(await main([FILM, "--shots", "S01", "--model", "2.0"]), 0);
    const q = JSON.parse(readFileSync(join(dir, "quotes", "Q1.json"), "utf8"));
    assert.equal(q.model, "2.0");
    assert.equal(q.modelId, "seedance-2.0");
    assert.equal(q.totalCNY, 2.3);
    assert.match(out.at(-1)!, /^报价 Q1：1 镜 5 秒 2\.0 约 ¥2\.3/);
    assert.equal(await main([FILM, "--shots", "S02", "--model", "2.0"]), 2);
    assert.equal(out.at(-1), "S02 计费 16 秒，超过 seedance-2.0 单镜上限 15 秒，请拆镜头");
    assert.deepEqual(readdirSync(join(dir, "quotes")), ["Q1.json"]);
  });
});

test("--model 只接受 mini、2.0、2.5；用法里写着 mini|2.0|2.5", async () => {
  await withFilm({ budget: 100, shots: { S01: 4.4 } }, async (dir, out) => {
    review(dir, "S01", 1, "pass");
    assert.equal(await main([FILM, "--shots", "S01", "--model", "2"]), 2);
    assert.match(out.at(-1)!, /--model mini\|2\.0\|2\.5/);
    assert.deepEqual(readdirSync(join(dir, "quotes")), []);
  });
});
