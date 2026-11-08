# 审核判定门槛（只有硬伤才不通过）— 报告

Status: DONE。Commit 4b3005c on dev（未 push）。`feat: 审核加判定门槛（只有硬伤才不通过）`

## 改动
- 五份清单 `.claude/skills/film-director/references/reviews/*.md` 各加一段"判定标准"（三条通用规则：硬伤定义 a/b/c；其他写"建议"不影响通过；每条标"硬伤"或"建议"，没有硬伤最后一行写"通过"）。原有条目一字未改。
  - story.md：插在最后一段"每条写：镜头、问题、建议改法……最后写通过或不通过"之前。
  - keyframe-plan.md、keyframes.md：文件里本来没有末行指令（由 review.ts prepare 追加），所以加在文件末尾，紧挨 prepare 追加的末行指令之前。
  - pre-submit.md：插在"最后只写通过或不通过……"之前，并多一条"提交前审核额外从严：……都算硬伤。"
  - final.md：加在"分硬伤和小问题"之后，并多一条映射："上面分的硬伤就是这里的硬伤，有一条就判不通过；小问题就是建议，不影响通过。"
- `.claude/agents/film-reviewer.md` 正文末尾加同样的通用判定标准（在"最后一行只写通过或不通过"之后）。
- scripts/review.ts 未改。

## 测试（TDD）
- 新增 tests/review-threshold.test.ts（3 个测试）：五份清单含 判定标准/硬伤/建议 及门槛句；pre-submit 含"额外从严"；film-reviewer.md 含 判定标准/硬伤/建议。先跑 3 个全红，改后全绿。
- 现有 review.test.ts 仍通过，包括 prepare 输出以 `最后一行只写"通过"或"不通过"。` 结尾、清单最后一个编号项是"对照本人要求文件"。
- npm test：145/145 通过。

## 注意
- final.md 原文要求"分硬伤和小问题"，通用规则写"标硬伤或建议"；用映射条说明二者等价，审核员两种标法都可能出现，不影响 parseVerdict（只读末行）。
- 未碰 films/ 和未跟踪的 PDF。
