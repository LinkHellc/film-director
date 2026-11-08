# 审查小问题修复（一次修完）

仓库：E:/05_AI/04_Claude短片流，分支：dev。

规则：
- 每一项都先写失败测试，再改。Skill 的文字改动用 `tests/skill.test.ts` 里的字符串断言来测。
- 只在本地提交，不推送。
- 不碰 `films/` 目录，不碰那个未纳入版本库的 PDF。
- 改完要跑两套测试，都得通过：`npm test`，以及 `.venv/Scripts/python -m unittest discover -s tests/py`。

## M1 审核清单要认得"静止尾巴"（最要紧）
文件：`.claude/skills/film-director/references/reviews/keyframe-plan.md` 和 `pre-submit.md`。

在两份清单的"判定标准"之前各加一条说明，内容如下：

> 时间轴说明：视频按"生成秒数"生成，它可能比片中时长长。提示词【逐秒】和首尾帧计划会写到生成秒数为止：片中用不到的那一段写成"静止，后期剪掉"，尾帧对应生成秒数的最后一刻。这样写是对的，不算对不上。

`pre-submit.md` 原来那条"额外从严"保持不变。

## M2 "剪出最好的 N 秒"的例外
文件：`4-keyframes.md`、`5-prompts.md`（或 `seven-part-prompt.md`），也就是上一轮 D5 加的那条规则。

在 D5 那条后面补一句：

> 例外：分镜写明"生成 X 秒、后期剪出最好的 N 秒"的镜头，【逐秒】写满生成秒数里的完整动作，不写静止尾巴，后期在 `edl` 里写明剪哪一段。

## M3 设定以最后一条为准
文件：`3-style.md` 第二部分第 4 步，以及 `SKILL.md` 里说【人物】照抄设定的地方（如果有）。

补一句：

> requirements.md 里同一角色有多条 [设定] 时，以时间最后的一条（含"更正"）为准。

## M4 措辞：不是禁止所有 `>`
文件：`SKILL.md`，D4 那条。

把"`>` 重定向覆盖"改成"`>` 重定向覆盖已存在的文件"。写新文件可以用 `>`。

## M5 自动打开工具要先加载
文件：`SKILL.md`，D7 那条。

补一句：

> `mcp__ccd_host__reveal_path` 是延迟加载的工具，第一次用之前先用 ToolSearch 加载（`select:mcp__ccd_host__reveal_path`）；加载不到或调用失败才退回给可点击路径。

## M6 开新片时想法里有换行
文件：`scripts/new-film.ts`。

写 `requirements.md` 第一条（想法原文）时，把换行（`\r?\n`）换成 ` / `。`brief.md` 保持原文不变。

测试：想法写成"第一行\n第二行"时，`requirements.md` 里是一行，内容为 `- 第一行 / 第二行`；`brief.md` 里仍是两行。

## 测试断言汇总（tests/skill.test.ts 或新测试文件）
- `keyframe-plan.md`、`pre-submit.md`：都含"静止，后期剪掉"和"不算对不上"。
- `4-keyframes.md` 或 `5-prompts.md`：含"剪出最好的"。
- `3-style.md`：含"以时间最后的一条"。
- `SKILL.md`：含"覆盖已存在的文件"和"select:mcp__ccd_host__reveal_path"。
- `new-film`：测试见 M6。

## 报告
写到 `.superpowers/sdd/2026-11-07-ai-film-autoloop/minor-fix-report.md`。逐项写清楚：改了什么、覆盖它的测试、运行的命令、命令输出。
