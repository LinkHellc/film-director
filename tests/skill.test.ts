import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { saidApproves } from "../scripts/approve.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(REPO, ".claude", "skills", "film-director");
const STAGES = join(SKILL, "references", "stages");
const STAGE_FILES = [
  "0-setup.md",
  "1-story.md",
  "2-board.md",
  "3-style.md",
  "4-keyframes.md",
  "5-prompts.md",
  "6-generate.md",
  "7-post.md",
  "8-wrap.md",
];
const GATES = ["G0", "G1", "G2", "G3", "G3b", "G4", "G5", "G6"];

function read(p: string): string {
  return readFileSync(p, "utf8");
}

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allFiles(p));
    else out.push(p);
  }
  return out;
}

function stageTexts(): { name: string; text: string }[] {
  return STAGE_FILES.map((name) => ({ name, text: read(join(STAGES, name)) }));
}

/** gates.md 里某个关口那一节（从它的标题到下一个同级标题）。 */
function gateSection(gate: string): string | null {
  const text = read(join(SKILL, "references", "gates.md"));
  const lines = text.split(/\r?\n/);
  const head = new RegExp(`^##\\s+${gate}(?![0-9A-Za-z])`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("SKILL.md has frontmatter with name film-director and a description", () => {
  const text = read(join(SKILL, "SKILL.md"));
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(m, "SKILL.md 开头要有 --- frontmatter ---");
  assert.match(m[1], /^name: film-director$/m);
  assert.match(m[1], /^description: .+/m);
});

test("every references/... path mentioned in SKILL.md exists", () => {
  const text = read(join(SKILL, "SKILL.md"));
  const refs = [...text.matchAll(/references\/[A-Za-z0-9_\-./]+/g)].map((m) => m[0].replace(/[.]+$/, ""));
  assert.ok(refs.length >= 12, `SKILL.md 应该列出各阶段手册和参考资料，只找到 ${refs.length} 个`);
  for (const r of refs) assert.ok(existsSync(join(SKILL, r)), `SKILL.md 提到的 ${r} 不存在`);
  for (const name of STAGE_FILES) assert.ok(refs.includes(`references/stages/${name}`), `SKILL.md 没列 ${name}`);
  for (const name of ["gates.md", "pitfalls.md", "seven-part-prompt.md"]) {
    assert.ok(refs.includes(`references/${name}`), `SKILL.md 没列 ${name}`);
  }
});

test("stages/ holds exactly the 9 stage files", () => {
  assert.deepEqual(readdirSync(STAGES).sort(), [...STAGE_FILES].sort());
});

test("gates.md has one section per gate G0–G6 (incl. G3b)", () => {
  for (const g of GATES) assert.ok(gateSection(g), `gates.md 缺少 ${g} 一节`);
});

test("G4 option '批准 Q<n>（¥合计）' is accepted by approve.ts for that quote only", () => {
  const g4 = gateSection("G4")!;
  assert.ok(g4.includes("批准 Q"), "G4 要有 批准 Q 选项");
  const m = /`(批准 Q<n>（¥[^`]*）)`/.exec(g4);
  assert.ok(m, "G4 选项要原样写成 `批准 Q<n>（¥合计）`");
  const sample = m[1].replace("<n>", "3").replace("合计", "1.2");
  assert.ok(saidApproves(sample, "Q3"), `approve.ts 不认 ${sample}`);
  assert.ok(!saidApproves(sample, "Q31"), "Q3 的选项不能被当成 Q31 的批准");
  assert.ok(g4.includes("先不拍"));
  assert.ok(g4.includes("改用 2.5 重新报价"));
  assert.ok(g4.includes("firstLastFrame"), "G4 要写明第二项只在 2.5 支持首尾帧时出现");
});

test("G5 says plainly that the director has not seen motion or heard sound", () => {
  assert.ok(gateSection("G5")!.includes("我没看过动态、没听过声音"));
});

test("stage files use the artifact patterns of config/reviews.json", () => {
  const cfg = JSON.parse(read(join(REPO, "config", "reviews.json"))) as Record<string, string[]>;
  const all = stageTexts().map((s) => s.text).join("\n");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const pattern of new Set(Object.values(cfg).flat())) {
    // 文档里的写法：v* → v<n>；<镜头> → <镜头> 或 S01；其余 * → <名字>
    let src = "";
    const segs = pattern.split("/");
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) src += "/";
      const seg = segs[i];
      if (seg === "<镜头>") {
        src += "(?:<镜头>|S\\d{2,3})";
        continue;
      }
      const parts = seg.split("*");
      for (let j = 0; j < parts.length; j++) {
        src += esc(parts[j]);
        if (j === parts.length - 1) break;
        src += parts[j].endsWith("v") ? "<n>" : "<[^>/\\s`]+>";
      }
    }
    assert.match(all, new RegExp(src), `阶段手册里没有出现 ${pattern} 的写法`);

    // 同名产物不能写到别的目录
    const last = segs.at(-1)!.replace(/\/$/, "");
    const stem = last.split("*")[0]; // 如 "storyboard-v"、"sheet-"
    if (!stem.endsWith("-v")) continue;
    const dirSrc = segs.slice(0, -1).join("/");
    const re = new RegExp(`([A-Za-z0-9_<>\\u4e00-\\u9fa5/]+)/${esc(stem)}<n>`, "g");
    for (const m of all.matchAll(re)) {
      const dir = m[1].replace(/^.*films\/<片名>\//, "").replace(/^films\/[^/]+\//, "");
      const want = new RegExp(`^${esc(dirSrc).replace(esc("<镜头>"), "(?:<镜头>|S\\d{2,3})")}$`);
      assert.match(dir, want, `${m[0]} 的目录应是 ${dirSrc}`);
    }
  }
});

test("every stage file with a gate points to gates.md", () => {
  for (const { name, text } of stageTexts()) {
    if (/G\d/.test(text)) assert.ok(text.includes("gates.md"), `${name} 提到关口但没引用 gates.md`);
  }
});

test("commands named in the Skill exist", () => {
  const texts = allFiles(SKILL).filter((p) => p.endsWith(".md")).map(read).join("\n");
  for (const m of texts.matchAll(/scripts\/((?:py\/)?[a-z0-9-]+\.(?:ts|py))/g)) {
    assert.ok(existsSync(join(REPO, "scripts", m[1])), `Skill 提到的 scripts/${m[1]} 不存在`);
  }
});

test("no Skill text contains forbidden strings", () => {
  for (const p of allFiles(SKILL)) {
    const text = read(p);
    for (const bad of ["SEEDANCE_API_KEY=", "ARK_API_KEY", "agent-autoloop"]) {
      assert.ok(!text.includes(bad), `${relative(REPO, p)} 里出现了 ${bad}`);
    }
  }
});

test("trial batch: G5 (human motion check) comes before quoting the remaining shots", () => {
  const gen = read(join(STAGES, "6-generate.md"));
  const g5 = gen.search(/^###\s*\d+\.\s*问 G5/m);
  const rest = gen.indexOf("再给其余镜头报价");
  assert.ok(g5 >= 0, "6-generate.md 要有「问 G5」一步");
  assert.ok(rest >= 0, "6-generate.md 要写「再给其余镜头报价」");
  assert.ok(g5 < rest, "6-generate.md 里问 G5 要在给其余镜头报价之前");
  assert.ok(gen.includes('试拍的镜头本人在 G5 看过、选了"都可以"后，再给其余镜头报价'));

  const prompts = read(join(STAGES, "5-prompts.md"));
  const p5 = prompts.indexOf("G5");
  const pRest = prompts.indexOf("才给其余镜头报价");
  assert.ok(p5 >= 0 && pRest > p5, "5-prompts.md 要写明试拍先过 G5 再给其余镜头报价");

  const gate = gateSection("G5")!;
  assert.ok(gate.includes("试拍"), "gates.md 的 G5 要写明试拍那批也要问");
  assert.ok(!gate.includes("进后期`"), "G5 的选项不能只适用于最后一批");
});

test("C1: project agent film-reviewer exists, read-only, inherits the session model", () => {
  const p = join(REPO, ".claude", "agents", "film-reviewer.md");
  assert.ok(existsSync(p), ".claude/agents/film-reviewer.md 不存在");
  const text = read(p);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  assert.ok(m, "film-reviewer.md 开头要有 frontmatter");
  const fm = m[1];
  assert.match(fm, /^name: film-reviewer$/m);
  assert.match(fm, /^description: .*只读.*不改文件/m);
  assert.match(fm, /^tools: Read, Glob, Grep$/m);
  assert.match(fm, /^model: inherit$/m);
  const body = m[2];
  for (const s of ["只读不改", "reviews/", "state.json", "Read", '"通过"或"不通过"']) {
    assert.ok(body.includes(s), `film-reviewer.md 正文缺少：${s}`);
  }
});

test('C1: the Skill dispatches reviews to film-reviewer, never "Explore"', () => {
  const texts = allFiles(SKILL).filter((p) => p.endsWith(".md")).map(read).join("\n");
  assert.ok(!texts.includes('"Explore"'), 'Skill 里还有 "Explore"');
  assert.ok(read(join(SKILL, "SKILL.md")).includes('subagent_type: "film-reviewer"'), "SKILL.md 要用 film-reviewer 派审核");
});
