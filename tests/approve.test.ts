import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, readApproval } from "../scripts/approve.ts";
import type { Quote } from "../scripts/quote.ts";

const FILM = "测试片";

/** 临时 FILM_ROOT（含一部片子，没有 approvals/ 目录）+ 环境变量恢复 + 捕获 console 输出。 */
async function withFilm(fn: (dir: string, out: string[]) => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "film-approve-"));
  const saved = process.env.FILM_ROOT;
  const out: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    process.env.FILM_ROOT = root;
    const dir = join(root, "films", FILM);
    mkdirSync(join(dir, "quotes"), { recursive: true });
    await fn(dir, out);
  } finally {
    console.log = log;
    console.error = err;
    if (saved === undefined) delete process.env.FILM_ROOT;
    else process.env.FILM_ROOT = saved;
    rmSync(root, { recursive: true, force: true });
  }
}

function writeQuote(dir: string, id: string, over: Partial<Quote> = {}): Quote {
  const q: Quote = {
    id,
    film: FILM,
    model: "mini",
    modelId: "doubao-seedance-2-0-mini-260615",
    shots: [
      { shot: "S01", seconds: 4.4, billable: 5, reviewHash: "a".repeat(64) },
      { shot: "S02", seconds: 4.4, billable: 5, reviewHash: "b".repeat(64) },
    ],
    totalCNY: 5,
    spentCNY: 1,
    budgetCNY: 100,
    overBudget: false,
    createdAt: "2026-11-07T00:00:00.000Z",
    ...over,
  };
  writeFileSync(join(dir, "quotes", `${id}.json`), JSON.stringify(q, null, 2) + "\n");
  return q;
}

function approvals(dir: string): string[] {
  try {
    return readdirSync(join(dir, "approvals"));
  } catch {
    return [];
  }
}

test("成功：写 approvals/Q3.json，打印已记下批准，readApproval 能读回", async () => {
  await withFilm(async (dir, out) => {
    const q = writeQuote(dir, "Q3");
    const said = "好的，批准 Q3，开始生成吧";
    assert.equal(await main([FILM, "Q3", "--said", said]), 0);
    assert.equal(out.at(-1), "已记下批准：Q3 ¥5.0");
    const a = JSON.parse(readFileSync(join(dir, "approvals", "Q3.json"), "utf8"));
    assert.equal(a.quote, "Q3");
    assert.equal(a.totalCNY, 5);
    assert.equal(a.model, "mini");
    assert.deepEqual(a.shots, q.shots);
    assert.equal(a.said, said);
    assert.ok(!Number.isNaN(Date.parse(a.at)));
    const r = readApproval(FILM, "Q3");
    assert.ok(r);
    assert.equal(r.quote, "Q3");
    assert.equal(r.totalCNY, 5);
    assert.equal(r.said, said);
    assert.equal(r.at, a.at);
  });
});

test("报价不存在：退出 1，不写文件；readApproval 返回 null", async () => {
  await withFilm(async (dir, out) => {
    assert.equal(await main([FILM, "Q3", "--said", "批准 Q3"]), 1);
    assert.equal(out.at(-1), "报价 Q3 不存在");
    assert.deepEqual(approvals(dir), []);
    assert.equal(readApproval(FILM, "Q3"), null);
  });
});

test("报价超预算：退出 1，不写文件", async () => {
  await withFilm(async (dir, out) => {
    writeQuote(dir, "Q3", { overBudget: true });
    assert.equal(await main([FILM, "Q3", "--said", "批准 Q3"]), 1);
    assert.equal(out.at(-1), "报价 Q3 超预算，不能批准");
    assert.deepEqual(approvals(dir), []);
  });
});

test("原话里没有“批准 Q3”：退出 1，不写文件（含全角空格、无空格、别的报价号）", async () => {
  await withFilm(async (dir, out) => {
    writeQuote(dir, "Q3");
    for (const said of ["好的", "批准Q3", "批准　Q3", "批准 Q2", "批准 q3", ""]) {
      assert.equal(await main([FILM, "Q3", "--said", said]), 1, said);
      assert.equal(out.at(-1), '本人原话里没有"批准 Q3"');
    }
    assert.deepEqual(approvals(dir), []);
  });
});

test("Q3 与 Q31：“批准 Q31” 不能批准 Q3，“批准 Q3” 不能批准 Q31", async () => {
  await withFilm(async (dir, out) => {
    writeQuote(dir, "Q3");
    writeQuote(dir, "Q31");
    assert.equal(await main([FILM, "Q3", "--said", "批准 Q31"]), 1);
    assert.equal(out.at(-1), '本人原话里没有"批准 Q3"');
    assert.equal(await main([FILM, "Q31", "--said", "批准 Q3"]), 1);
    assert.equal(out.at(-1), '本人原话里没有"批准 Q31"');
    assert.deepEqual(approvals(dir), []);
    assert.equal(await main([FILM, "Q3", "--said", "批准 Q31，也批准 Q3。"]), 0);
    assert.equal(await main([FILM, "Q31", "--said", "批准 Q31"]), 0);
    assert.deepEqual(approvals(dir).sort(), ["Q3.json", "Q31.json"]);
  });
});

test("已经批准过：退出 1，原批准文件不变", async () => {
  await withFilm(async (dir, out) => {
    writeQuote(dir, "Q3");
    assert.equal(await main([FILM, "Q3", "--said", "批准 Q3"]), 0);
    const before = readFileSync(join(dir, "approvals", "Q3.json"), "utf8");
    assert.equal(await main([FILM, "Q3", "--said", "再次批准 Q3"]), 1);
    assert.equal(out.at(-1), "报价 Q3 已经批准过");
    assert.equal(readFileSync(join(dir, "approvals", "Q3.json"), "utf8"), before);
  });
});

test("参数不对：退出 2（报价号格式、缺 --said、多余参数、片名不合法）", async () => {
  await withFilm(async (dir) => {
    writeQuote(dir, "Q3");
    for (const argv of [
      [FILM, "q3", "--said", "批准 q3"],
      [FILM, "Q", "--said", "批准 Q"],
      [FILM, "Q3x", "--said", "批准 Q3x"],
      [FILM, "../Q3", "--said", "批准 ../Q3"],
      [FILM, "Q3"],
      [FILM, "Q3", "--said"],
      [FILM, "Q3", "--said", "批准 Q3", "--extra"],
      [FILM],
      [],
      ["../x", "Q3", "--said", "批准 Q3"],
    ]) {
      assert.equal(await main(argv), 2, JSON.stringify(argv));
    }
    assert.deepEqual(approvals(dir), []);
  });
});

test("readApproval：报价号不合法时抛错", async () => {
  await withFilm(() => {
    assert.throws(() => readApproval(FILM, "../Q3"), /报价号不合法/);
  });
});

test("原话里否定了批准：退出 1，不写文件（不批准、别批准、先不要批准、没批准、未批准、勿批准）", async () => {
  await withFilm(async (dir, out) => {
    writeQuote(dir, "Q3");
    for (const said of ["不批准 Q3", "别批准 Q3", "先不要批准 Q3", "没批准 Q3", "还未批准 Q3", "勿批准 Q3", "不，别急着批准 Q3"]) {
      assert.equal(await main([FILM, "Q3", "--said", said]), 1, said);
      assert.equal(out.at(-1), '本人原话里没有"批准 Q3"');
    }
    assert.deepEqual(approvals(dir), []);
  });
});

test("卡片选项原文“批准 Q3（¥1.5）”可以批准", async () => {
  await withFilm(async (dir) => {
    writeQuote(dir, "Q3");
    assert.equal(await main([FILM, "Q3", "--said", "批准 Q3（¥1.5）"]), 0);
    assert.deepEqual(approvals(dir), ["Q3.json"]);
  });
});
