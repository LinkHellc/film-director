import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, writeState, isApproved, type FilmState } from "../scripts/lib/state.ts";
import { filmDir } from "../scripts/lib/paths.ts";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "film-state-"));
  const old = process.env.FILM_ROOT;
  try {
    process.env.FILM_ROOT = root;
    fn(root);
  } finally {
    if (old === undefined) delete process.env.FILM_ROOT;
    else process.env.FILM_ROOT = old;
    rmSync(root, { recursive: true, force: true });
  }
}

function sample(): FilmState {
  return {
    film: "测试片",
    stage: "board",
    settings: { seconds: 30, aspect: "16:9", budgetCNY: 50, music: null, subtitles: true, model: "mini" },
    gates: { G0: "approved", G1: "asked" },
    shots: { S01: { seconds: 4.4, status: "planned", clip: null } },
    spentCNY: 2.5,
  };
}

test("writeState 再 readState 得到同一对象，且不留 .tmp", () => {
  withRoot(() => {
    mkdirSync(filmDir("测试片"), { recursive: true });
    const s = sample();
    writeState(s);
    assert.deepEqual(readState("测试片"), s);
    // 原地更新
    s.stage = "style";
    s.gates.G1 = "approved";
    writeState(s);
    assert.deepEqual(readState("测试片"), s);
    assert.equal(existsSync(join(filmDir("测试片"), "state.json.tmp")), false);
  });
});

test("isApproved 对缺失关口返回 false，只有 approved 算批准", () => {
  const s = sample();
  assert.equal(isApproved(s, "G0"), true);
  assert.equal(isApproved(s, "G1"), false);
  assert.equal(isApproved(s, "G3b"), false);
  s.gates.G2 = "rejected";
  assert.equal(isApproved(s, "G2"), false);
});

test("readState 片名不合法时抛错", () => {
  assert.throws(() => readState("../x"), { message: "片名不合法：../x" });
});
