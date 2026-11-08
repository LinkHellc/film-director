import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWS = join(REPO, ".claude", "skills", "film-director", "references", "reviews");
const KINDS = ["story", "keyframe-plan", "keyframes", "pre-submit", "final"];

function read(p: string): string {
  return readFileSync(p, "utf8");
}

test("五份清单都有判定标准：只有硬伤才不通过，其他写成建议", () => {
  for (const k of KINDS) {
    const text = read(join(REVIEWS, `${k}.md`));
    for (const s of ["判定标准", "硬伤", "建议"]) {
      assert.ok(text.includes(s), `${k}.md 缺少：${s}`);
    }
    assert.ok(text.includes('只有"硬伤"才判"不通过"'), `${k}.md 缺少硬伤门槛`);
  }
});

test("提交前审核额外从严", () => {
  assert.ok(read(join(REVIEWS, "pre-submit.md")).includes("额外从严"), "pre-submit.md 缺少：额外从严");
});

test("film-reviewer 正文也有判定标准", () => {
  const body = read(join(REPO, ".claude", "agents", "film-reviewer.md"));
  for (const s of ["判定标准", "硬伤", "建议"]) {
    assert.ok(body.includes(s), `film-reviewer.md 缺少：${s}`);
  }
});
