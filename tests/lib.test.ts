import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { projectRoot, filmDir, assertFilmName } from "../scripts/lib/paths.ts";
import { nextVersionPath, writeNew } from "../scripts/lib/versioned.ts";
import { sha256File } from "../scripts/lib/hash.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "film-lib-"));
}

test("nextVersionPath 空目录返回 v1", () => {
  const dir = tempDir();
  try {
    const p = nextVersionPath(dir, "plan", "md");
    assert.equal(basename(p), "plan-v1.md");
    assert.equal(resolve(p), resolve(join(dir, "plan-v1.md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nextVersionPath 已有 v1、v3 时返回 v4，忽略其他文件", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "plan-v1.md"), "a");
    writeFileSync(join(dir, "plan-v3.md"), "b");
    writeFileSync(join(dir, "plan-v9.txt"), "other ext");
    writeFileSync(join(dir, "xplan-v7.md"), "other base");
    assert.equal(basename(nextVersionPath(dir, "plan", "md")), "plan-v4.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeNew 写已存在文件时抛错且原内容不变", () => {
  const dir = tempDir();
  try {
    const p = join(dir, "a.txt");
    writeNew(p, "原内容");
    assert.equal(readFileSync(p, "utf8"), "原内容");
    assert.throws(() => writeNew(p, "新内容"));
    assert.equal(readFileSync(p, "utf8"), "原内容");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("assertFilmName 合法与不合法", () => {
  assert.doesNotThrow(() => assertFilmName("雨夜邮差"));
  assert.throws(() => assertFilmName("../x"), { message: "片名不合法：../x" });
  assert.throws(() => assertFilmName(""), { message: "片名不合法：" });
});

test("projectRoot 优先用 FILM_ROOT，filmDir 位于 films/<片名>", () => {
  const dir = tempDir();
  const old = process.env.FILM_ROOT;
  try {
    process.env.FILM_ROOT = dir;
    assert.equal(projectRoot(), resolve(dir));
    assert.equal(filmDir("雨夜邮差"), join(resolve(dir), "films", "雨夜邮差"));
    assert.throws(() => filmDir("../x"), { message: "片名不合法：../x" });
  } finally {
    if (old === undefined) delete process.env.FILM_ROOT;
    else process.env.FILM_ROOT = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("未设 FILM_ROOT 时 projectRoot 为仓库根（与 cwd 无关）", () => {
  const old = process.env.FILM_ROOT;
  try {
    delete process.env.FILM_ROOT;
    const repoRoot = resolve(import.meta.dirname, "..");
    assert.equal(projectRoot(), repoRoot);
  } finally {
    if (old !== undefined) process.env.FILM_ROOT = old;
  }
});

test("sha256File 对 abc 返回小写十六进制", () => {
  const dir = tempDir();
  try {
    const p = join(dir, "abc.txt");
    writeFileSync(p, "abc");
    assert.equal(
      sha256File(p),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
