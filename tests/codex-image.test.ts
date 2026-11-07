import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main, PROMPT_PREFIX, pngSize, parseOut } from "../scripts/codex-image.ts";
import type { FilmState, GateId } from "../scripts/lib/state.ts";

const FILM = "画图片";
const FAKE = resolve(dirname(fileURLToPath(import.meta.url)), "fakes", "codex.ts");

interface Ctx {
  root: string;
  dir: string;
  images: string;
  log: string;
  out: string[];
  calls: () => { argv: string[]; stdin: string }[];
}

const ENV_KEYS = ["FILM_ROOT", "FILM_CODEX_CMD", "FILM_CODEX_IMAGES", "FAKE_CODEX_LOG", "FAKE_CODEX_MODE", "FAKE_CODEX_SIZE"];

async function withFilm(
  opts: { gates: GateId[]; mode?: string; size?: string },
  fn: (c: Ctx) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "film-codex-"));
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const out: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    const dir = join(root, "films", FILM);
    const images = join(root, "codex-images");
    const logPath = join(root, "codex-log.jsonl");
    mkdirSync(dir, { recursive: true });
    mkdirSync(images, { recursive: true });
    const state: FilmState = {
      film: FILM,
      stage: "style",
      settings: { seconds: 10, aspect: "16:9", budgetCNY: 100, music: null, subtitles: false, model: "mini" },
      gates: Object.fromEntries(opts.gates.map((g) => [g, "approved"])),
      shots: {},
      spentCNY: 0,
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
    writeFileSync(join(root, "prompt.txt"), "雨夜的小镇邮局，暖黄灯光，电影感。");
    process.env.FILM_ROOT = root;
    process.env.FILM_CODEX_CMD = JSON.stringify([process.execPath, FAKE]);
    process.env.FILM_CODEX_IMAGES = images;
    process.env.FAKE_CODEX_LOG = logPath;
    if (opts.mode) process.env.FAKE_CODEX_MODE = opts.mode;
    else delete process.env.FAKE_CODEX_MODE;
    if (opts.size) process.env.FAKE_CODEX_SIZE = opts.size;
    else delete process.env.FAKE_CODEX_SIZE;
    const calls = () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
    await fn({ root, dir, images, log: logPath, out, calls });
  } finally {
    console.log = log;
    console.error = err;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

function args(c: Ctx, kind: string, out: string, extra: string[] = []): string[] {
  return [FILM, "--kind", kind, "--out", out, "--prompt", join(c.root, "prompt.txt"), ...extra];
}

const text = (c: Ctx) => c.out.join("\n");

test("G1 not approved: refuses every kind without calling codex", async () => {
  for (const [kind, out] of [["style", "style/look"], ["sheet", "style/hero"], ["first", "shots/S01/first"], ["last", "shots/S01/last"]]) {
    await withFilm({ gates: [] }, async (c) => {
      assert.equal(await main(args(c, kind, out)), 1);
      assert.match(text(c), /故事还没确认，不画图/);
      assert.equal(c.calls().length, 0);
      assert.equal(existsSync(c.log), false);
    });
  }
});

test("G3 not approved: only style frames allowed", async () => {
  for (const [kind, out] of [["sheet", "style/hero"], ["first", "shots/S01/first"], ["last", "shots/S01/last"]]) {
    await withFilm({ gates: ["G1"] }, async (c) => {
      assert.equal(await main(args(c, kind, out)), 1);
      assert.match(text(c), /画风还没确认，只能画样帧/);
      assert.equal(c.calls().length, 0);
    });
  }
});

test("G3b not approved: no first/last keyframes", async () => {
  for (const [kind, out] of [["first", "shots/S01/first"], ["last", "shots/S01/last"]]) {
    await withFilm({ gates: ["G1", "G3"] }, async (c) => {
      assert.equal(await main(args(c, kind, out)), 1);
      assert.match(text(c), /设定图还没确认/);
      assert.equal(c.calls().length, 0);
    });
  }
  // G3 批准、G3b 未批准时设定图仍可以画
  await withFilm({ gates: ["G1", "G3"] }, async (c) => {
    assert.equal(await main(args(c, "sheet", "style/hero")), 0);
    assert.ok(existsSync(join(c.dir, "style", "hero-v1.png")));
  });
});

test("style frame: copies to style/look-v1.png, then -v2; prints path and size", async () => {
  await withFilm({ gates: ["G1"] }, async (c) => {
    assert.equal(await main(args(c, "style", "style/look")), 0);
    assert.ok(existsSync(join(c.dir, "style", "look-v1.png")));
    assert.match(text(c), /style\/look-v1\.png/);
    assert.match(text(c), /1920×1080/);
    assert.doesNotMatch(text(c), /比例不是 16:9/);
    assert.equal(await main(args(c, "style", "style/look")), 0);
    assert.ok(existsSync(join(c.dir, "style", "look-v2.png")));
    assert.deepEqual(pngSize(readFileSync(join(c.dir, "style", "look-v2.png"))), { width: 1920, height: 1080 });
    assert.deepEqual(readdirSync(join(c.dir, "style")).sort(), ["look-v1.png", "look-v2.png"]);
  });
});

test("command line: exec flags, refs in order with -i, prompt on stdin with fixed prefix once", async () => {
  await withFilm({ gates: ["G1", "G3", "G3b"] }, async (c) => {
    const a = join(c.dir, "style", "look-v1.png");
    const b = join(c.dir, "style", "hero-v1.png");
    mkdirSync(dirname(a), { recursive: true });
    writeFileSync(a, "x");
    writeFileSync(b, "y");
    assert.equal(await main(args(c, "first", "shots/S01/first", ["--ref", a, "--ref", b])), 0);
    const [call] = c.calls();
    assert.deepEqual(call.argv, ["exec", "--skip-git-repo-check", "-s", "read-only", "-i", a, "-i", b, "-"]);
    assert.ok(call.stdin.startsWith(PROMPT_PREFIX));
    assert.match(call.stdin, /雨夜的小镇邮局/);
    assert.ok(existsSync(join(c.dir, "shots", "S01", "first-v1.png")));

    // 文件里已经有固定开头就不重复加
    writeFileSync(join(c.root, "prompt.txt"), `${PROMPT_PREFIX}\n尾帧：邮差推门而出。`);
    assert.equal(await main(args(c, "last", "shots/S01/last")), 0);
    const second = c.calls()[1];
    assert.equal(second.stdin.split(PROMPT_PREFIX).length - 1, 1);
    assert.ok(existsSync(join(c.dir, "shots", "S01", "last-v1.png")));
  });
});

test("missing ref is an error and codex is not called", async () => {
  await withFilm({ gates: ["G1"] }, async (c) => {
    assert.equal(await main(args(c, "style", "style/look", ["--ref", join(c.root, "nope.png")])), 2);
    assert.equal(c.calls().length, 0);
  });
});

test("quota error exits 5", async () => {
  await withFilm({ gates: ["G1"], mode: "quota" }, async (c) => {
    assert.equal(await main(args(c, "style", "style/look")), 5);
    assert.match(text(c), /Codex 额度用完/);
    assert.equal(existsSync(join(c.dir, "style")), false);
  });
});

test("no image exits 3, ignoring older images in the image folder", async () => {
  await withFilm({ gates: ["G1"], mode: "noid,noimage" }, async (c) => {
    const old = join(c.images, "old-session", "exec-old.png");
    mkdirSync(dirname(old), { recursive: true });
    writeFileSync(old, readFileSync(FAKE)); // 内容无所谓
    const past = new Date(Date.now() - 3600_000);
    utimesSync(old, past, past);
    assert.equal(await main(args(c, "style", "style/look")), 3);
    assert.match(text(c), /Codex 没有出图/);
    assert.equal(existsSync(join(c.dir, "style")), false);
  });
});

test("no session id: falls back to newest image modified after start", async () => {
  await withFilm({ gates: ["G1"], mode: "noid", size: "1280x720" }, async (c) => {
    assert.equal(await main(args(c, "style", "style/look")), 0);
    assert.deepEqual(pngSize(readFileSync(join(c.dir, "style", "look-v1.png"))), { width: 1280, height: 720 });
  });
});

test("1024x1024 image warns about 16:9", async () => {
  await withFilm({ gates: ["G1"], size: "1024x1024" }, async (c) => {
    assert.equal(await main(args(c, "style", "style/look")), 0);
    assert.match(text(c), /1024×1024/);
    assert.match(text(c), /比例不是 16:9，提交视频前要裁切/);
  });
});

test("parseOut: --out is <subfolder>/<base> relative to the film dir and must match --kind", () => {
  assert.deepEqual(parseOut("style", "style/look"), { dir: "style", base: "look" });
  assert.deepEqual(parseOut("sheet", "style/主角"), { dir: "style", base: "主角" });
  assert.deepEqual(parseOut("first", "shots/S01/first"), { dir: "shots/S01", base: "first" });
  assert.deepEqual(parseOut("last", "shots/S12/last"), { dir: "shots/S12", base: "last" });
  for (const [kind, out] of [
    ["style", "look"], // 缺子目录
    ["style", "shots/S01/first"], // 子目录不对
    ["sheet", "style/a/b"],
    ["first", "style/look"],
    ["first", "shots/S01/last"], // 首帧的基名必须是 first
    ["last", "shots/S01/first"],
    ["first", "shots/../first"],
    ["first", "shots/S01"],
    ["style", "style/../look"],
    ["style", "style\\look"],
    ["style", "/style/look"],
    ["style", "style/look.png"],
    ["style", "style/"],
  ]) {
    assert.equal(parseOut(kind as "style", out), null, `${kind} ${out}`);
  }
});

test("bad arguments exit 2 without calling codex", async () => {
  await withFilm({ gates: ["G1", "G3", "G3b"] }, async (c) => {
    assert.equal(await main(args(c, "first", "style/look")), 2);
    assert.equal(await main(args(c, "poster", "style/look")), 2);
    assert.equal(await main([FILM, "--kind", "style", "--out", "style/look"]), 2);
    assert.equal(await main(args(c, "style", "style/look", ["--prompt"])), 2);
    assert.equal(c.calls().length, 0);
  });
});

test("pngSize reads IHDR and rejects non-PNG", () => {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(640, 16);
  buf.writeUInt32BE(360, 20);
  assert.deepEqual(pngSize(buf), { width: 640, height: 360 });
  assert.equal(pngSize(Buffer.from("GIF89a-----------------------------")), null);
});
