# Task 3 报告：审核的准备与记录

Status: DONE
Commit: 05ccef9 `feat: 审核的准备与记录`（dev 分支，本地，未推送；未提交 PDF）

## 文件
- scripts/review.ts：`parseVerdict`、`materialsFor`、`ReviewKind`/`ReviewRecord`、CLI `prepare` / `record`
- config/reviews.json：五类模式，按简报原样
- .claude/skills/film-director/references/reviews/{story,keyframe-plan,keyframes,pre-submit,final}.md
- tests/review.test.ts：13 个测试

## TDD
- RED：先写测试，`node --test tests/review.test.ts` 失败（模块不存在）。
- GREEN：13/13 通过；`npm test` 一共 49/49 通过。

## 实现要点
- 模式规则：只有最后一段能用 `*`。`v*` 表示版本号（数字，取最大），其他 `*` 用来分组（例如 `sheet-*-v*.png` 每个角色各取最新）。以 `/` 结尾的模式（`out/final-v*-frames/`）取最新版本的目录，再列出里面全部 png/jpg/jpeg/webp，按名字排序。每个模式至少要匹配到一项，否则 prepare 退出 3，输出 `缺少资料：<替换好镜头的模式>、…`，一个文件也不写。缺 requirements.md 也算缺资料。
- 轮次编号：`nextRound` 在 `<base>-v<n>.(prompt.md|prompt.json|md|json)` 四种后缀里找最大 n 再加 1（没用 `nextVersionPath`）。有测试专门验证：目录里只有 `.prompt.md` 时，下一轮是 v2。
- 路径：`materialsFor`、提示词文本和 `.prompt.json`/`.json` 的 `files` 键，都是用 `/` 分隔的绝对路径（Windows 上 Read 和 sha256File 都能读）。prepare 还会检查资料里不能有 state.json 或 reviews/ 下的文件。
- 提示词拼接完全照简报（清单全文 + 资料 + 本人要求 + 最后一行要求），测试做了逐字比对。
- record：只认本片 `reviews/` 下的 `*-v<n>.prompt.md`，否则退出 2。会核对 `.prompt.json` 和文件名里的 kind/shot/n/film 是否一致，然后重算所有哈希；文件变了或不见了都退出 3，输出 `审核期间文件变了：<相对路径，多个用、分隔>`。`.md`/`.json` 用 wx 方式写，同一轮重复 record 时退出 2。`.json` 的键顺序是 `{kind,film,shot,verdict,at,files}`，story 和 final 的 shot 为 null。
- parseVerdict：去掉 `**`、`__`、所有空白和零宽字符，取最后一个非空行，恰好等于"通过"才算 pass。
- 集成测试：用 new-film `--no-emit` 开片，writeState 设好预算和 S01，跑 prepare 和 record（通过）之后，`buildQuote` 能报价，`reviewHash` 等于 v1.json 的哈希。

## 和简报不完全一样的地方 / 需要留意
1. `.prompt.json` 的 `files` 多算了 requirements.md 的哈希（审核也要读它，审核期间被改了也该拦下）。这个 `files` 会原样写进 ReviewRecord。quote.ts 不读 `files`，没有影响。
2. "提示词文件被改了一个字"我理解成视频提示词 `prompt-v*.txt`（方法论里材料的叫法），测试就是按这个写的。审核提示词 `.prompt.md` 本身没有记哈希：简报规定 `.prompt.json` 只有这五个字段，要拦它就得加字段。
3. 清单最后的"对照本人要求文件，列出被忘掉的要求。"放在了编号列表的最后一项，后面保留了原文的收尾句（"每条写：…"、"最后写通过/不通过"），没有放在整份文件的最后一行。测试检查的是"最后一个编号项"。
4. 清单的小改动：材料占位符 `[首帧]` 等改成"路径见下面的资料列表"；keyframes 删掉了"我同意了再改"，因为审核只读不改；pre-submit 把"不通过就逐条列出"改成"不通过就在前面逐条列出"，跟最后一行只写结论对得上；final 第 1 项补了一句"帧已经解码好放在资料列表里"；keyframe-plan 加了一段导语，说明 8 项要套用到计划写的画面上。
5. prepare 只打印提示词路径（`/` 分隔）一行，不是一整句中文，这样导演好直接拿来用。
6. final 的成片 mp4 和帧目录各自取最新版本，不会检查两者的 n 是否一致；只有帧目录落后于成片时才会对不上。
7. 不管有没有角色，keyframes/pre-submit 都要求至少一张 `style/sheet-*-v*.png`，所以没有角色的片子在这两类审核上会被判缺资料。
8. 镜头名的规则是 `^[A-Za-z0-9_]{1,20}$`。
