# Task 2 报告：报价

Status: DONE
Commit: 8afee77 `feat: 报价`（branch dev，本地，未 push；PDF 未提交）

## 文件
- scripts/quote.ts：`billableSeconds`、`Quote`、`buildQuote`、`main`
- tests/quote.test.ts：6 个测试

## TDD
- RED：模块不存在，`node --test tests/quote.test.ts` 失败。
- GREEN：quote 6/6 通过；`npm test` 22/22 通过。

## 实现要点
- 价格表按 `scripts/quote.ts` 位置解析 `../config/pricing.json`，与 FILM_ROOT 无关。
- 模型：参数 > `state.settings.model` > `pricing.default`。
- reviewHash：`reviews/pre-submit-<镜>-v<n>.json` 中 n 最大者（数字比较，测试覆盖 v10 > v9），verdict 必须为 pass，否则抛 `S0x 还没有通过提交前审核`。
- spentCNY = spend.jsonl 各行 cny 之和（文件不存在为 0）；不读 state.spentCNY。
- overBudget = spent + total > budget。预算余 = budget − spent（不扣本次报价）。
- 报价 id：扫 `quotes/Q<n>.json` 取最大 n+1，`writeNew` 写入。
- 校验顺序：模型 → 镜头非空/不重复/存在（`没有这个镜头：S09`）→ 预算为 null（`还没有设总预算`）→ 审核。所有 buildQuote 错误与参数错误退出 2，不写文件。
- 超预算：仍写 `quotes/Q<n>.json`（含 `overBudget: true`），stderr 打印 `超预算：报价 Q<n>：…（已写 <路径>，不能提交）`，退出 2。

## 判断/疑点
1. `billableSeconds`：spec 说"向上取整，余量不足 0.5 秒再加 1 秒"。为满足 brief 的精确值做了两处解释：
   - 4.5 → 6：余量恰为 0.5 也加 1（按"≤ 0.5"实现，带 1e-9 容差）。
   - 0.3 → 2：按规则只得 1，故加了"最少 2 秒"下限。spec 未提最低秒数；若 Seedance 实际最短时长不同（如 4 秒），需改此下限。
2. 超预算仍写报价文件（Quote 有 overBudget 字段，推断应留记录）；Task 5 的 checkGates 需拒绝 overBudget 报价。
3. 重复镜头（`--shots S01,S01`）报 `镜头重复：S01` 退出 2——brief 未规定，自行加的。

## Fix round 1 (review: 2 Important)

Commit: 3ad866b `fix: 报价坏数据报错、预算比较用未取整金额`

### 改动（scripts/quote.ts）
1. 坏数据 fail-closed：
   - `billableSeconds` 非 number / 非有限 / ≤ 0 抛 `秒数不合法：<值>`（0、-3、NaN、Infinity 都抛）。
   - `buildQuote` 把它包成 `<镜> 的秒数不合法：<值>`（秒数缺失也走这里）。
   - `spentFromLog`：非 JSON 行抛 `spend.jsonl 第 n 行不是合法的 JSON`；cny 不是有限数或 < 0 抛 `spend.jsonl 第 n 行的 cny 不合法：<值>`。
   - 加：总预算非有限数或 < 0 抛 `总预算不合法`；合计非有限（单价坏）抛 `单价不合法`。
   - `overBudget = !(rawSpent + rawTotal <= budget + EPS)`，NaN 时为 true。
   - 以上都在写文件前抛出 → main 退出 2，不写 quotes/Q<n>.json。
2. 预算比较用未取整的 spent/total；`spentCNY`/`totalCNY` 只在写入 Quote（存储/显示）时 round1。

### 新增测试（tests/quote.test.ts）
- `billableSeconds：0、负数、非有限数抛错`
- `spend.jsonl 有坏的 cny 行：报错、退出 2、不写报价`（缺 cny、字符串 "3"、-1、非 JSON 行）
- `镜头秒数缺失或不是数：报错、退出 2、不写报价`
- `预算比较用未四舍五入的已花：已花 6.04 + 报价 5.0 > 预算 11`（spentCNY 存 6.0，overBudget true，exit 2，输出以超预算开头）

RED：新增 4 个测试中 4 个失败（6 pass / 4 fail）。

### 命令与输出
- `node --test tests/quote.test.ts` → tests 10, pass 10, fail 0
- `npm test` → tests 26, pass 26, fail 0
