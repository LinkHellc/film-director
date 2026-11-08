# 审查小问题修复报告（M1–M6）

分支 dev，本地提交，未推送。未碰 `films/`、`~/.claude`、未纳入版本库的 PDF。

提交：
- `61cad80` docs(skill): M1–M5（Skill 文字 + tests/skill.test.ts）
- `066ffde` fix(new-film): M6（scripts/new-film.ts + tests/new-film.test.ts）

## 流程（TDD）
先在 `tests/skill.test.ts` 末尾加 M1–M5 五个测试、在 `tests/new-film.test.ts` 末尾加 M6 一个测试，跑 `npm test`：

```
✖ 想法里有换行时 requirements.md 第一条换成 ' / '，brief.md 保持原文
✖ M1: keyframe-plan and pre-submit checklists accept the still tail before 判定标准
✖ M2: shots that generate X seconds and cut the best N seconds write the full action, no still tail
✖ M3: 3-style.md step 4 says the last [设定] line for a character wins
✖ M4: 硬性禁止 only forbids > overwriting existing files
✖ M5: SKILL.md loads the deferred reveal_path tool with ToolSearch before first use
ℹ tests 159
ℹ pass 153
ℹ fail 6
```

再改文件，重跑。

## 逐项

### M1 审核清单认得"静止尾巴"
- 改动：`references/reviews/keyframe-plan.md`、`references/reviews/pre-submit.md` 在"判定标准："之前各加一段"时间轴说明：……这样写是对的，不算对不上。"（逐字照 brief）。`pre-submit.md` 的"提交前审核额外从严"一条未动。清单原有 1–9 / 1–6 项未动。
- 测试：`M1: ...`——两份文件都含"静止，后期剪掉""不算对不上"、含说明全文且位置在"判定标准："之前；pre-submit 仍含"额外从严"原句全文。

### M2 "剪出最好的 N 秒"的例外
- 改动：例外句（逐字照 brief）加在 D5 规则后面，三处：`stages/4-keyframes.md`（"时间轴按生成秒数写"列表新增一条）、`stages/5-prompts.md`（D5 那条末尾）、`seven-part-prompt.md`（D5 那条末尾）。
- 测试：`M2: ...`——4-keyframes.md、5-prompts.md 含"剪出最好的"和例外全文；seven-part-prompt.md 含例外全文。

### M3 设定以最后一条为准
- 改动：`stages/3-style.md` 第二部分第 4 步末尾加"requirements.md 里同一角色有多条 [设定] 时，以时间最后的一条（含"更正"）为准。"。SKILL.md 里没有"【人物】照抄设定"的说法（已 grep 确认），所以未改 SKILL.md。
- 测试：`M3: ...`——第二部分含该句全文，文件含"以时间最后的一条"。

### M4 不是禁止所有 `>`
- 改动：SKILL.md 硬性禁止 D4 那条："`>` 重定向覆盖"→"`>` 重定向覆盖已存在的文件"。
- 测试：`M4: ...`——硬性禁止一节含"`>` 重定向覆盖已存在的文件"，全文含"覆盖已存在的文件"。原 D4 测试（子串"`>` 重定向覆盖"）仍通过。

### M5 reveal_path 先加载
- 改动：SKILL.md"每一步怎么做"D7 那条，在"给出可点击的路径。"之后加 brief 原句。
- 测试：`M5: ...`——"每一步怎么做"一节含该句全文，全文含"select:mcp__ccd_host__reveal_path"。

### M6 开新片时想法里有换行
- 改动：`scripts/new-film.ts` 写 requirements.md 第一条时 `idea.replace(/\r?\n/g, " / ")`；brief.md 仍写原文。
- 测试：`想法里有换行时 requirements.md 第一条换成 ' / '，brief.md 保持原文`——分别用 `"第一行\n第二行"` 和 `"第一行\r\n第二行"`：requirements.md 里 `- ` 开头的行只有 `- 第一行 / 第二行`，没有单独的"第二行"行；brief.md 等于原文 + `\n`（两行）。

## 运行的命令与输出

`npm test`：
```
ℹ tests 159
ℹ pass 159
ℹ fail 0
```

`.venv/Scripts/python -m unittest discover -s tests/py`：
```
Ran 24 tests in 8.062s

OK
```

## 自查与顾虑
- 4-keyframes.md 里的例外句照 brief 原文写的是"【逐秒】"，而该阶段的产物是首尾帧计划（"中间发生什么"）。意思能对上（例外镜头不写静止尾巴，尾帧是完整动作的最后一刻），但字面上指的是提示词段；若想更贴切可后续改成"'中间发生什么'和【逐秒】都写满……"。
- M6 只处理 `\r?\n`，单独的 `\r` 不转换（按 brief）。
