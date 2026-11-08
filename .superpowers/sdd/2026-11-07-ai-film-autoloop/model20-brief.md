# 加入模型 seedance-2.0（满血版）

本人要求正片调用 Seedance 2.0。仓库在 E:/05_AI/04_Claude短片流，分支 dev。

## 规则

- 每一项都先写失败的测试，再改代码。
- 只在本地提交，不推送；不碰 `films/`。
- `npm test` 和 Python 测试两套都要通过。
- **不发任何可能扣费的请求。** 只允许读公开文档。

## 第 1 步：核实（不花钱）

资料：
- `.superpowers/sdd/2026-11-07-ai-film-autoloop/gateway-pricing.json`（网关公开价目）。其中 `seedance-2.0` 一项写着：首帧/首尾帧 720p ¥0.45/秒，支持参考素材。
- 网关公开文档 docs.dragon3api.com（尤其是 video-references 页；上一轮就是在这里查到 mini 的请求格式）。
- `scripts/lib/video-api.ts` 顶部注释（mini 和 2.5 的已核实结论）。

要查清 3 件事：
1. `seedance-2.0` 允许的时长范围，也就是单镜最短、最长几秒。
2. 是否支持 `task_mode: first_last_frame` 加首尾帧，请求格式是否和 mini 相同。
3. 720p 单价是否是 ¥0.45/秒。

结论写进 `video-api.ts` 顶部注释，附来源链接。
- 查不清就标"未核实"，按最保守的方式处理：`firstLastFrame` 设成 `false`，这样 2.0 就不能用。然后停下来，报告 NEEDS_CONTEXT，说明查到了什么。

## 第 2 步：实现

1. **`config/pricing.json`**：加一项 `"2.0": { "id": "seedance-2.0", "cnyPerSecond720p": <核实的单价>, "firstLastFrame": <核实结果>, "maxSeconds": <核实的上限> }`。`default` 保持 `"mini"` 不变。
2. **`scripts/quote.ts`**：
   - `Model` 类型改为 `"mini" | "2.0" | "2.5"`；
   - `--model` 接受 `2.0`，USAGE 文案同步更新；
   - 计费下限：如果 2.0 的最短时长不是 4 秒，`billableSeconds` 要按模型取下限。现在写死的 4 秒下限要改成每个模型各自的值，写在 pricing.json 里，例如加一个 `minSeconds` 字段。mini 和 2.5 原有的行为不能变。
3. **`scripts/seedance.ts`**：确认闸门 1、2（报价存在、首尾帧支持）和提交请求对 2.0 一样适用，不需要为它单独写分支。
4. **Skill**：
   - `gates.md` 的 G4：说明里加一项"改用 2.0 重新报价"，出现条件和 2.5 那项一样，即当前报价不是 2.0、并且 2.0 的 `firstLastFrame` 为 true；
   - `5-prompts.md`：写明怎么用 2.0 报价，命令是 `quote.ts … --model 2.0`；
   - SKILL.md 命令速查里 quote 那一行：`--model mini|2.0|2.5`。

## 测试要求

- 用 2.0 给两个各 4.4 秒的镜头报价：每镜计费 5 秒，合计 = 10 秒 × 单价。如果单价核实为 0.45，合计就是 `4.5`。
- `--model 2.0` 能写出报价文件，文件里的 `modelId` 是 `seedance-2.0`。
- 2.0 的 `firstLastFrame` 为 true 时，`checkGates` 不报"不支持首尾帧"。
- 提交请求体里的 `model` 是 `seedance-2.0`，用假网关测试。
- mini 和 2.5 原有的全部测试不改、照样通过。
- skill.test：`gates.md` 里出现"改用 2.0 重新报价"。

## 报告

写到 `.superpowers/sdd/2026-11-07-ai-film-autoloop/model20-report.md`。
