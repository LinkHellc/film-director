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

test("I3: G4 docs say a bare option number is not approval; the person types 批准 Q<n>", () => {
  const g4 = gateSection("G4")!;
  const skill = read(join(SKILL, "SKILL.md"));
  for (const [name, text] of [["gates.md G4", g4], ["SKILL.md", skill]] as const) {
    assert.ok(text.includes("只回一个数字不算批准"), `${name} 要写明只回一个数字不算批准`);
    assert.ok(text.includes("原样打出 `批准 Q<n>`"), `${name} 要写明请本人原样打出 批准 Q<n>`);
  }
  for (const bad of ["拒绝批准 Q3", "批准 Q3？", "3"]) assert.ok(!saidApproves(bad, "Q3"), bad);
});

test(".gitattributes normalizes text to LF (cmd/ps1 CRLF) and gates.md is LF", () => {
  const ga = read(join(REPO, ".gitattributes"));
  for (const line of ["* text=auto eol=lf", "*.cmd text eol=crlf", "*.ps1 text eol=crlf"]) {
    assert.ok(ga.split(/\r?\n/).includes(line), `.gitattributes 缺少：${line}`);
  }
  assert.ok(!read(join(SKILL, "references", "gates.md")).includes("\r\n"), "gates.md 还是 CRLF");
});

test("M-fix: push-in crop example in 4-keyframes.md is centered", () => {
  const text = read(join(STAGES, "4-keyframes.md"));
  assert.ok(text.includes("l,t=(W-w)//2,(H-h)//2"), "推近镜头的裁切示例要居中");
  assert.ok(!text.includes("l,t=0,0"), "不能再默认裁左上角");
});

test("I2: SKILL.md and README explain reconcile; only after the person gives a task id or says 没建成 this turn", () => {
  const skill = read(join(SKILL, "SKILL.md"));
  const readme = read(join(REPO, "README.md"));
  for (const [name, text] of [["SKILL.md", skill], ["README.md", readme]] as const) {
    assert.ok(text.includes("seedance.ts reconcile"), `${name} 要写 reconcile 命令`);
    assert.ok(text.includes("--not-created"), `${name} 要写 --not-created`);
    assert.ok(text.includes("网关后台"), `${name} 要写本人去网关后台查`);
  }
  assert.ok(skill.includes("本人在这一轮明确给出任务号或说\"没建成\""), "SKILL.md 要写明只在本人当轮明确给出任务号或说没建成之后才运行");
});

test("misc: 继续做 handles an approved-but-not-submitted quote without re-running approve.ts", () => {
  const skill = read(join(SKILL, "SKILL.md"));
  const sec = skill.slice(skill.indexOf("## 继续做"), skill.indexOf("## 每一步怎么做"));
  assert.ok(sec.includes("approvals/Q<n>.json"), "继续做 要检查 approvals/Q<n>.json");
  assert.ok(sec.includes("Q<n> 之前批准过、还没提交，现在提交吗"), "继续做 要先问本人");
  assert.ok(sec.includes("不要再运行 `approve.ts`"), "继续做 要写明不要再运行 approve.ts");
});

// ---------- 试跑修复（D4–D8） ----------

test("D4: 硬性禁止 forbids in-place edits of artifacts (sed -i, > overwrite, Edit/Write on existing files)", () => {
  const skill = read(join(SKILL, "SKILL.md"));
  const sec = skill.slice(skill.indexOf("## 硬性禁止"), skill.indexOf("## 阶段索引"));
  for (const s of ["sed -i", "`>` 重定向覆盖", "Edit/Write", "另存为新版本", "`state.json`", "`requirements.md`（只追加）"]) {
    assert.ok(sec.includes(s), `硬性禁止 缺少：${s}`);
  }
});

test("D5: keyframe plan and prompts time the whole generated length, not the in-film length", () => {
  const kf = read(join(STAGES, "4-keyframes.md"));
  const pr = read(join(STAGES, "5-prompts.md"));
  const seven = read(join(SKILL, "references", "seven-part-prompt.md"));
  for (const [name, text] of [["4-keyframes.md", kf], ["5-prompts.md", pr], ["seven-part-prompt.md", seven]] as const) {
    assert.ok(text.includes("生成秒数"), `${name} 要写 生成秒数`);
    assert.ok(text.includes("尾帧对应的是**生成秒数**的最后一刻，不是片中时长的最后一刻"), `${name} 要写明尾帧对应生成秒数的最后一刻`);
    assert.ok(text.includes("静止，后期剪掉"), `${name} 要写明多出来的那段写成"静止，后期剪掉"`);
    assert.ok(text.includes("\"片中时间\"和\"生成秒数\"两个数都要带上"), `${name} 要写明两个数都要带上`);
  }
  assert.ok(seven.includes("【逐秒】的时间轴覆盖整个生成秒数"), "seven-part-prompt.md 要写明【逐秒】覆盖整个生成秒数");
  assert.ok(pr.includes("【逐秒】的时间轴覆盖整个生成秒数"), "5-prompts.md 要写明【逐秒】覆盖整个生成秒数");
});

test("D6: 3-style.md step 4 writes fixed features by looking at each sheet with Read", () => {
  const text = read(join(STAGES, "3-style.md"));
  const part2 = text.slice(text.indexOf("## 第二部分"), text.indexOf("## 产物"));
  const step4 = part2.split(/\r?\n/).find((l) => l.startsWith("4. "));
  assert.ok(step4, "第二部分要有第 4 步");
  for (const s of ["看图", "Read 打开每张设定图", "毛色或衣服、花纹位置、眼睛颜色、配饰", "不凭印象、不照抄提示词", "再和设定图对一遍"]) {
    assert.ok(step4.includes(s), `第 4 步缺少：${s}`);
  }
});

test("D7: SKILL.md opens every generated image/clip/cut with reveal_path, also before G3/G3b/G2/G5/G6", () => {
  const skill = read(join(SKILL, "SKILL.md"));
  const sec = skill.slice(skill.indexOf("## 每一步怎么做"), skill.indexOf("## 审核怎么做"));
  for (const s of ["mcp__ccd_host__reveal_path", "样帧、设定图、首尾帧、草图", "可点击的路径", "G3、G3b、G2、G5、G6 提问前先打开附带的文件"]) {
    assert.ok(sec.includes(s), `每一步怎么做 缺少：${s}`);
  }
});

test("D8: requirements.md lines replace line breaks in the person's words with ' / '", () => {
  const skill = read(join(SKILL, "SKILL.md"));
  const sec = skill.slice(skill.indexOf("## 每一步怎么做"), skill.indexOf("## 审核怎么做"));
  assert.ok(sec.includes("本人原话里有换行时，换成 ` / `，保持一条一行，原话其他部分不改"));
  assert.ok(skill.includes(" / "));
});

// ---------- 审查小问题修复（M1–M5） ----------

test("M1: keyframe-plan and pre-submit checklists accept the still tail before 判定标准", () => {
  const note = "时间轴说明：视频按\"生成秒数\"生成，它可能比片中时长长。提示词【逐秒】和首尾帧计划会写到生成秒数为止：片中用不到的那一段写成\"静止，后期剪掉\"，尾帧对应生成秒数的最后一刻。这样写是对的，不算对不上。";
  for (const name of ["keyframe-plan.md", "pre-submit.md"]) {
    const text = read(join(SKILL, "references", "reviews", name));
    assert.ok(text.includes("静止，后期剪掉"), `${name} 要含"静止，后期剪掉"`);
    assert.ok(text.includes("不算对不上"), `${name} 要含"不算对不上"`);
    const i = text.indexOf(note);
    assert.ok(i >= 0, `${name} 要含时间轴说明原文`);
    assert.ok(i < text.indexOf("判定标准："), `${name} 时间轴说明要在 判定标准 之前`);
  }
  const ps = read(join(SKILL, "references", "reviews", "pre-submit.md"));
  assert.ok(ps.includes("- 提交前审核额外从严：提示词和首尾帧对不上的任何一处（位置、左右、颜色、人数、道具数量、衣服、表情），以及首尾帧之间机位、大小、背景不一致，都算硬伤。"));
});

test("M2: shots that generate X seconds and cut the best N seconds write the full action, no still tail", () => {
  const s = "例外：分镜写明\"生成 X 秒、后期剪出最好的 N 秒\"的镜头，【逐秒】写满生成秒数里的完整动作，不写静止尾巴，后期在 `edl` 里写明剪哪一段。";
  for (const name of ["4-keyframes.md", "5-prompts.md"]) {
    const text = read(join(STAGES, name));
    assert.ok(text.includes("剪出最好的"), `${name} 要含"剪出最好的"`);
    assert.ok(text.includes(s), `${name} 要含例外原文`);
  }
  assert.ok(read(join(SKILL, "references", "seven-part-prompt.md")).includes(s), "seven-part-prompt.md 要含例外原文");
});

test("M3: 3-style.md step 4 says the last [设定] line for a character wins", () => {
  const text = read(join(STAGES, "3-style.md"));
  const part2 = text.slice(text.indexOf("## 第二部分"), text.indexOf("## 产物"));
  assert.ok(part2.includes("requirements.md 里同一角色有多条 [设定] 时，以时间最后的一条（含\"更正\"）为准。"));
  assert.ok(text.includes("以时间最后的一条"));
});

test("M4: 硬性禁止 only forbids > overwriting existing files", () => {
  const skill = read(join(SKILL, "SKILL.md"));
  const sec = skill.slice(skill.indexOf("## 硬性禁止"), skill.indexOf("## 阶段索引"));
  assert.ok(sec.includes("`>` 重定向覆盖已存在的文件"));
  assert.ok(skill.includes("覆盖已存在的文件"));
});

test("M5: SKILL.md loads the deferred reveal_path tool with ToolSearch before first use", () => {
  const skill = read(join(SKILL, "SKILL.md"));
  const sec = skill.slice(skill.indexOf("## 每一步怎么做"), skill.indexOf("## 审核怎么做"));
  assert.ok(sec.includes("`mcp__ccd_host__reveal_path` 是延迟加载的工具，第一次用之前先用 ToolSearch 加载（`select:mcp__ccd_host__reveal_path`）；加载不到或调用失败才退回给可点击路径。"));
  assert.ok(skill.includes("select:mcp__ccd_host__reveal_path"));
});
