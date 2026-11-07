import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main, materialsFor, parseVerdict, type ReviewKind } from "../scripts/review.ts";
import { main as newFilm } from "../scripts/new-film.ts";
import { buildQuote } from "../scripts/quote.ts";
import { readState, writeState } from "../scripts/lib/state.ts";
import { sha256File } from "../scripts/lib/hash.ts";

const FILM = "审核片";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fwd(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 临时 FILM_ROOT + 一部用 new-film 开好的片子 + 捕获 console 输出。 */
async function withFilm(fn: (dir: string, out: string[]) => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "film-review-"));
  const saved = process.env.FILM_ROOT;
  const out: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    process.env.FILM_ROOT = root;
    assert.equal(await newFilm([FILM, "一只猫偷鱼", "--no-emit"]), 0);
    const dir = join(root, "films", FILM);
    const st = readState(FILM);
    st.settings.budgetCNY = 100;
    st.shots.S01 = { seconds: 4.4, status: "ready", clip: null };
    writeState(st);
    out.length = 0;
    await fn(dir, out);
  } finally {
    console.log = log;
    console.error = err;
    if (saved === undefined) delete process.env.FILM_ROOT;
    else process.env.FILM_ROOT = saved;
    rmSync(root, { recursive: true, force: true });
  }
}

function put(dir: string, rel: string, data = rel): string {
  const p = join(dir, ...rel.split("/"));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

/** pre-submit 需要的全部资料（含旧版本，用来验证"取最新"）。 */
function preSubmitMaterials(dir: string, opts: { first?: boolean } = {}): void {
  put(dir, "shots/S01/prompt-v1.txt", "旧提示词");
  put(dir, "shots/S01/prompt-v2.txt", "【画风】…");
  if (opts.first !== false) {
    put(dir, "shots/S01/first-v1.png");
    put(dir, "shots/S01/first-v10.png");
    put(dir, "shots/S01/first-v9.png");
  }
  put(dir, "shots/S01/last-v1.png");
  put(dir, "style/sheet-猫-v1.png");
  put(dir, "style/sheet-猫-v2.png");
  put(dir, "style/sheet-鱼贩-v1.png");
  put(dir, "board/storyboard-v1.md");
  put(dir, "board/palette-v1.md");
}

function reviewFiles(dir: string): string[] {
  return readdirSync(join(dir, "reviews")).sort();
}

test("parseVerdict：只看去掉空白和加粗后的最后一个非空行", () => {
  assert.equal(parseVerdict("镜头 1 没问题\n通过"), "pass");
  assert.equal(parseVerdict("镜头 1 没问题\n\n  **通过**  \n\n"), "pass");
  assert.equal(parseVerdict("说明\r\n通过\r\n"), "pass");
  assert.equal(parseVerdict("镜头 1 有问题\n不通过"), "fail");
  assert.equal(parseVerdict("还行\n基本通过"), "fail");
  assert.equal(parseVerdict("通过\n还有一条建议"), "fail");
  assert.equal(parseVerdict(""), "fail");
  assert.equal(parseVerdict("\n  \n"), "fail");
});

test("五份清单都在：开头说只读，结尾要求对照本人要求", () => {
  const cfg = JSON.parse(readFileSync(join(REPO, "config", "reviews.json"), "utf8"));
  const kinds: ReviewKind[] = ["story", "keyframe-plan", "keyframes", "pre-submit", "final"];
  assert.deepEqual(Object.keys(cfg).sort(), [...kinds].sort());
  for (const k of kinds) {
    const text = readFileSync(join(REPO, ".claude", "skills", "film-director", "references", "reviews", `${k}.md`), "utf8");
    assert.ok(
      text.startsWith("你是第一次看这些材料的审核，只读不改，不要写或改任何文件。图片要用 Read 打开放大看。"),
      `${k} 开头不对`,
    );
    const items = text.split(/\r?\n/).filter((l) => /^\d+\. /.test(l));
    assert.match(items.at(-1)!, /^\d+\. 对照本人要求文件，列出被忘掉的要求。$/, `${k} 最后一项不对`);
  }
});

test("materialsFor：每类模式取最新版本，每个角色的设定图各取最新", async () => {
  await withFilm((dir) => {
    preSubmitMaterials(dir);
    const got = materialsFor("pre-submit", FILM, "S01").map(fwd);
    const want = [
      "shots/S01/prompt-v2.txt",
      "shots/S01/first-v10.png",
      "shots/S01/last-v1.png",
      "style/sheet-猫-v2.png",
      "style/sheet-鱼贩-v1.png",
      "board/storyboard-v1.md",
      "board/palette-v1.md",
    ].map((r) => fwd(join(dir, r)));
    assert.deepEqual([...got].sort(), [...want].sort());
    for (const p of got) assert.ok(existsSync(p));
  });
});

test("materialsFor final：最新成片和对应帧目录下的全部图片", async () => {
  await withFilm((dir) => {
    put(dir, "out/final-v1.mp4");
    put(dir, "out/final-v2.mp4");
    put(dir, "out/final-v1-frames/0001.png");
    put(dir, "out/final-v2-frames/0001.png");
    put(dir, "out/final-v2-frames/0002.jpg");
    put(dir, "out/final-v2-frames/notes.txt");
    const got = materialsFor("final", FILM).map(fwd).sort();
    const want = ["out/final-v2.mp4", "out/final-v2-frames/0001.png", "out/final-v2-frames/0002.jpg"]
      .map((r) => fwd(join(dir, r)))
      .sort();
    assert.deepEqual(got, want);
  });
});

test("prepare：写出 .prompt.md 和 .prompt.json，列出提示词、首帧、尾帧绝对路径，不含 state.json 和 reviews/", async () => {
  await withFilm(async (dir, out) => {
    preSubmitMaterials(dir);
    assert.equal(await main(["prepare", "pre-submit", FILM, "--shot", "S01"]), 0);
    assert.deepEqual(reviewFiles(dir), ["pre-submit-S01-v1.prompt.json", "pre-submit-S01-v1.prompt.md"]);
    const promptPath = join(dir, "reviews", "pre-submit-S01-v1.prompt.md");
    assert.equal(out.at(-1)!.includes(fwd(promptPath)), true);
    assert.equal(out.at(-1)!.includes("\\"), false);

    const text = readFileSync(promptPath, "utf8");
    const checklist = readFileSync(
      join(REPO, ".claude", "skills", "film-director", "references", "reviews", "pre-submit.md"),
      "utf8",
    );
    assert.ok(text.startsWith(checklist + "\n\n资料（只读这些文件，不要读别的）：\n"));
    for (const r of ["shots/S01/prompt-v2.txt", "shots/S01/first-v10.png", "shots/S01/last-v1.png"]) {
      assert.ok(text.includes(fwd(join(dir, r))), `缺 ${r}`);
    }
    assert.ok(text.includes(`\n本人要求：${fwd(join(dir, "requirements.md"))}`));
    assert.ok(text.endsWith(`\n\n最后一行只写"通过"或"不通过"。`));
    assert.equal(text.includes("state.json"), false);
    assert.equal(text.includes("reviews/"), false);
    assert.equal(text.includes("first-v9.png"), false);

    const meta = JSON.parse(readFileSync(join(dir, "reviews", "pre-submit-S01-v1.prompt.json"), "utf8"));
    assert.deepEqual(Object.keys(meta), ["kind", "film", "shot", "n", "files"]);
    assert.equal(meta.kind, "pre-submit");
    assert.equal(meta.film, FILM);
    assert.equal(meta.shot, "S01");
    assert.equal(meta.n, 1);
    const first = fwd(join(dir, "shots/S01/first-v10.png"));
    assert.equal(meta.files[first], sha256File(first));
  });
});

test("prepare：缺首帧时退出 3，输出以\"缺少资料：\"开头，不写任何文件", async () => {
  await withFilm(async (dir, out) => {
    preSubmitMaterials(dir, { first: false });
    assert.equal(await main(["prepare", "pre-submit", FILM, "--shot", "S01"]), 3);
    assert.match(out.at(-1)!, /^缺少资料：.*first-v\*\.png/);
    assert.deepEqual(reviewFiles(dir), []);
  });
});

test("prepare：参数不对退出 2", async () => {
  await withFilm(async () => {
    assert.equal(await main(["prepare", "nope", FILM]), 2);
    assert.equal(await main(["prepare", "pre-submit", FILM]), 2); // 缺 --shot
    assert.equal(await main(["prepare", "story", FILM, "--shot", "S01"]), 2); // story 不分镜头
    assert.equal(await main(["prepare", "pre-submit", FILM, "--shot", "../x"]), 2);
    assert.equal(await main([]), 2);
  });
});

async function prepareAndRecord(dir: string, reply: string): Promise<number> {
  const before = new Set(reviewFiles(dir));
  assert.equal(await main(["prepare", "pre-submit", FILM, "--shot", "S01"]), 0);
  const prompt = reviewFiles(dir).find((f) => !before.has(f) && f.endsWith(".prompt.md"))!;
  const replyPath = put(dir, `tmp/reply-${prompt}.txt`, reply);
  return main(["record", FILM, "--prompt", join(dir, "reviews", prompt), "--reply", replyPath]);
}

test("record：末行\"通过\"退出 0，写出 .md（回复原文）和 .json（ReviewRecord）", async () => {
  await withFilm(async (dir, out) => {
    preSubmitMaterials(dir);
    const reply = "1. 对得上\n2. 一致\n\n**通过**\n";
    assert.equal(await prepareAndRecord(dir, reply), 0);
    assert.equal(out.at(-1), "审核 pre-submit：通过（reviews/pre-submit-S01-v1.md）");
    assert.equal(readFileSync(join(dir, "reviews", "pre-submit-S01-v1.md"), "utf8"), reply);
    const rec = JSON.parse(readFileSync(join(dir, "reviews", "pre-submit-S01-v1.json"), "utf8"));
    assert.deepEqual(Object.keys(rec), ["kind", "film", "shot", "verdict", "at", "files"]);
    assert.equal(rec.kind, "pre-submit");
    assert.equal(rec.film, FILM);
    assert.equal(rec.shot, "S01");
    assert.equal(rec.verdict, "pass");
    assert.ok(!Number.isNaN(Date.parse(rec.at)));
    const meta = JSON.parse(readFileSync(join(dir, "reviews", "pre-submit-S01-v1.prompt.json"), "utf8"));
    assert.deepEqual(rec.files, meta.files);
  });
});

test("record：不通过退出 1；连续两轮得到 -v1 和 -v2，名字不互相干扰", async () => {
  await withFilm(async (dir, out) => {
    preSubmitMaterials(dir);
    assert.equal(await prepareAndRecord(dir, "首帧多了个水壶\n不通过"), 1);
    assert.equal(out.at(-1), "审核 pre-submit：不通过（reviews/pre-submit-S01-v1.md）");
    assert.equal(await prepareAndRecord(dir, "通过"), 0);
    assert.equal(out.at(-1), "审核 pre-submit：通过（reviews/pre-submit-S01-v2.md）");
    assert.deepEqual(reviewFiles(dir), [
      "pre-submit-S01-v1.json",
      "pre-submit-S01-v1.md",
      "pre-submit-S01-v1.prompt.json",
      "pre-submit-S01-v1.prompt.md",
      "pre-submit-S01-v2.json",
      "pre-submit-S01-v2.md",
      "pre-submit-S01-v2.prompt.json",
      "pre-submit-S01-v2.prompt.md",
    ]);
    const meta2 = JSON.parse(readFileSync(join(dir, "reviews", "pre-submit-S01-v2.prompt.json"), "utf8"));
    assert.equal(meta2.n, 2);
  });
});

test("版本号：只有 .prompt.md 时下一轮也是 v2（不被 .prompt.md 名字迷惑）", async () => {
  await withFilm(async (dir) => {
    put(dir, "story/shots-v1.md", "S01 猫看鱼");
    assert.equal(await main(["prepare", "story", FILM]), 0);
    assert.equal(await main(["prepare", "story", FILM]), 0);
    assert.deepEqual(reviewFiles(dir), [
      "story-v1.prompt.json",
      "story-v1.prompt.md",
      "story-v2.prompt.json",
      "story-v2.prompt.md",
    ]);
    const meta = JSON.parse(readFileSync(join(dir, "reviews", "story-v2.prompt.json"), "utf8"));
    assert.equal(meta.shot, null);
  });
});

test("record：prepare 和 record 之间提示词文件被改了一个字 → 退出 3，不写记录", async () => {
  await withFilm(async (dir, out) => {
    preSubmitMaterials(dir);
    assert.equal(await main(["prepare", "pre-submit", FILM, "--shot", "S01"]), 0);
    appendFileSync(join(dir, "shots", "S01", "prompt-v2.txt"), "字");
    const replyPath = put(dir, "tmp/reply.txt", "通过");
    const code = await main([
      "record", FILM, "--prompt", join(dir, "reviews", "pre-submit-S01-v1.prompt.md"), "--reply", replyPath,
    ]);
    assert.equal(code, 3);
    assert.equal(out.at(-1), "审核期间文件变了：shots/S01/prompt-v2.txt");
    assert.deepEqual(reviewFiles(dir), ["pre-submit-S01-v1.prompt.json", "pre-submit-S01-v1.prompt.md"]);
  });
});

test("record：提示词文件不在本片 reviews/ 下或不是 .prompt.md 时退出 2", async () => {
  await withFilm(async (dir) => {
    const replyPath = put(dir, "tmp/reply.txt", "通过");
    const elsewhere = put(dir, "tmp/x-v1.prompt.md", "x");
    put(dir, "tmp/x-v1.prompt.json", "{}");
    assert.equal(await main(["record", FILM, "--prompt", elsewhere, "--reply", replyPath]), 2);
    assert.equal(await main(["record", FILM, "--prompt", join(dir, "reviews", "nope-v1.prompt.md"), "--reply", replyPath]), 2);
    assert.equal(await main(["record", FILM, "--reply", replyPath]), 2);
  });
});

test("集成：record 一份 pre-submit 通过之后，buildQuote 能对这个镜头报价", async () => {
  await withFilm(async (dir) => {
    preSubmitMaterials(dir);
    assert.throws(() => buildQuote(FILM, ["S01"]), /还没有通过提交前审核/);
    assert.equal(await prepareAndRecord(dir, "通过"), 0);
    const q = buildQuote(FILM, ["S01"]);
    assert.equal(q.shots[0].shot, "S01");
    assert.equal(q.shots[0].reviewHash, sha256File(join(dir, "reviews", "pre-submit-S01-v1.json")));
  });
});
