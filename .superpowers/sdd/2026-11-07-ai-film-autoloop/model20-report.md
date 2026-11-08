# 加入模型 seedance-2.0（满血版）报告

状态：DONE（核实通过，firstLastFrame = true）。分支 dev，只在本地提交，没有推送；没碰 `films/`，没提交未跟踪的 PDF。

## 提交

- `8a00b64` feat(quote)：pricing.json 加 `"2.0"`；quote.ts `Model`、`--model`、USAGE；state.ts 的 `settings.model` 类型；video-api.ts 顶部注释写核实结论；quote / seedance 测试。
- `cd3cce8` docs(skill)：gates.md G4、5-prompts.md、SKILL.md 速查、README 模型表；skill 测试。

## 第 1 步：核实（不花钱）

只用 curl 对公开文档页发了不带鉴权的 GET（WebFetch 工具本轮不可用），并读了仓库里的价目副本。没有向 newapi.dragon3api.com 发任何请求，没读任何 Key 或环境变量。

来源：
- [G] https://docs.dragon3api.com/video-references
- [A] 网关公开价目副本 `.superpowers/sdd/2026-11-07-ai-film-autoloop/gateway-pricing.json`（原地址 GET https://newapi.dragon3api.com/api/pricing，本轮没重新拉）
- 也看了 https://docs.dragon3api.com/videos 、https://docs.dragon3api.com/model/video-more-models-generation ：这两页没有 seedance-2.0 专门的内容；文档里也没有 2.0 满血版自己的模型页。

| 问题 | 结论 | 依据 |
|---|---|---|
| 1. 时长范围 | 4–15 秒 | [G] "当前范围"表：seedance-2.0 支持 480p、720p、1080p、4K，时长 4–15 秒 |
| 2. 首尾帧 | 支持，请求格式和 mini 一样 | [G] "首帧、首尾帧和自适应比例"表里 seedance-2.0 的首帧/首尾帧一栏有价（720p 0.45）；不提供首帧模式的只列了 seedance-2.5 和 seedance-1.5-pro。`task_mode: "first_last_frame"`、content 依次放 `first_frame`、`last_frame`（完整 data URL），这段写法对所有型号通用。[A] 的说明也写着首帧/首尾帧 720p ¥0.45/秒 |
| 3. 720p 单价 | ¥0.45/秒 | [A] billing_expr 的 720p 标准档是 seconds × 0.45；[G] 表里文生/参考素材和首帧/首尾帧两栏都是 720p 0.45，还有算例：seedance-2.0、720p、输出 5 秒 + 参考视频 5 秒 = 0.45 × 5 + 0.45 × 5 = 4.50 元 |

其他情况：
- 预扣：[G] 写"2.0 系列 15 秒"，所以 2.0 提交时每镜先扣 15 × 0.45 = ¥6.75，账户余额要够。
- [G] 写 9:16 的 720p 首帧是 ¥0.15/秒，更便宜；本流程按 0.45 报价，竖屏只会多报，不会少报。
- [G] 说自己只实测过"Mini 720p、4 秒单图参考生成"。2.0 的首尾帧网关没有实测，本轮也没有实测（按规定不能实测）。

## 第 2 步：实现

- `config/pricing.json`：`"2.0": { "id": "seedance-2.0", "cnyPerSecond720p": 0.45, "firstLastFrame": true, "maxSeconds": 15 }`；`default` 仍是 `"mini"`。
- `scripts/quote.ts`：`Model = "mini" | "2.0" | "2.5"`；`--model` 接受 `2.0`；USAGE 改为 `[--model mini|2.0|2.5]`。
  计费下限：2.0 最短也是 4 秒，按要求的条件（"不是 4 秒才要改"）不加 `minSeconds`，`billableSeconds` 不动。mini 和 2.5 的行为不变。
- `scripts/lib/state.ts`：`settings.model` 类型加 `"2.0"`。这里只是类型，不影响运行。
- `scripts/seedance.ts`：没改。闸门 1、2 按 `pricing.models[q.model]` 查，对所有模型一样；提交请求体的 `model` 取报价里的 `modelId`。两点都有新测试证明。
- `scripts/lib/video-api.ts`：只在顶部注释加了"seedance-2.0 核实结果"一段，写明来源。
- Skill：
  - gates.md G4 加了选项`改用 2.0 重新报价`。出现条件：本次报价不是 2.0，并且 `models["2.0"].firstLastFrame` 为 true。附了检查命令、选中后跑的命令（`--model 2.0`），并提醒 2.0 的单价是 mini 的 3 倍。原来"2.5 那项不出现，只问两项"的说法已经不对，改掉了。说明模板改成"mini、2.0 或 2.5"，预扣写"mini、2.0 每镜 15 秒"。
  - 5-prompts.md：第 3 节写明用 2.0 时报价加 `--model 2.0`；第 4 节给出完整命令 `node scripts/quote.ts <片名> --shots S01,S02 --model 2.0`。
  - SKILL.md 速查里 quote 那一行：`[--model mini\|2.0\|2.5]`。
  - README 模型表加了 2.0 一行（brief 没要求，但不加文档就和代码对不上）。

## 测试（先写测试、确认失败，再改代码）

新增测试：
- quote：用 2.0 给两镜各 4.4 秒报价，每镜计费 [5, 5]，合计 4.5，`modelId` 是 seedance-2.0。`--model 2.0` 写出 Q1.json（`modelId` seedance-2.0，单镜 4.4 秒的金额是 2.3）。计费 16 秒超过 2.0 的 15 秒上限时退出 2。`--model 2` 退出 2，用法里写着 `mini|2.0|2.5`。
- seedance：2.0 报价批准后 `checkGates` 返回 `[]`，没有"不支持首尾帧"。用假网关提交：请求体 `model` 是 `seedance-2.0`，task_mode 是 first_last_frame，图片角色依次是 first_frame、last_frame；spend 每行记 2.25，合计 4.5；输出里没有 Key。
- skill：G4 里有`改用 2.0 重新报价`、`models["2.0"].firstLastFrame` 和 `--model 2.0`；5-prompts 里有 `quote.ts … --model 2.0`；SKILL.md 速查有 `mini\|2.0\|2.5`。

结果：`npm test` 165 个全过；Python `.venv/Scripts/python -m unittest discover -s tests/py` 24 个全过。mini 和 2.5 原有的测试一个没改。

## 自查与顾虑

- 7 道闸门、锁、只追加的日志、退出码、不打印 Key：这些代码都没改。
- 有一个测试偶尔失败：全量跑了大约 15 次，"提交时连接断开（结果不明）"这条 mini 用例失败过 1 次，之后连跑 14 次都通过。改动前的基线连跑 6 次也都通过，样本太少，没能复现。这条用例本轮没改，走的也不是 2.0 的路径，猜测是假网关断开连接时的时序问题。没有修，建议以后看一下。
- 2.0 首尾帧只按文档核实过，网关自己也没实测。第一批试拍（1–2 镜）可以当作实测。
- 2.0 每镜预扣 ¥6.75，账户余额不够时网关会拒绝（402/403，按欠费处理，退出 4）。
- `default` 仍是 mini。本人要正片用 2.0 的话，导演要在报价时加 `--model 2.0`（5-prompts 已写明），或在 G4 选"改用 2.0 重新报价"。没有脚本能改 `state.settings.model`。
