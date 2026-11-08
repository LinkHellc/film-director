### Task 2: 报价

**Files:**
- Create: `scripts/quote.ts`
- Test: `tests/quote.test.ts`

**Interfaces:**
- Consumes: `readState`、`nextVersionPath`、`writeNew`、`sha256File`、`config/pricing.json`
- Produces:
  ```ts
  billableSeconds(seconds: number): number
  interface Quote { id: string; film: string; model: "mini"|"2.5"; modelId: string;
    shots: { shot: string; seconds: number; billable: number; reviewHash: string }[];
    totalCNY: number; spentCNY: number; budgetCNY: number; overBudget: boolean; createdAt: string }
  buildQuote(film: string, shots: string[], model?: "mini"|"2.5"): Quote
  ```
  `quote.ts <片名> --shots S01,S02 [--model mini|2.5]` 写 `quotes/Q<n>.json`（n 递增，从 1 开始），打印 `报价 Q<n>：<镜头数> 镜 <秒> 秒 <模型> 约 ¥<合计>（估算，以账单为准）；已花 ¥x，预算余 ¥y`。超预算时 `overBudget: true`，打印以 `超预算` 开头，退出码 2。`reviewHash` 是该镜头最新 `pre-submit` 审核 `.json` 文件的哈希；没有通过的审核时 `buildQuote` 抛错 `S0x 还没有通过提交前审核`。`spentCNY` 取自 `spend.jsonl` 各行 `cny` 之和。

- [ ] **Step 1: 写失败测试**：`billableSeconds(4) === 5`、`(4.4) === 5`、`(4.5) === 6`、`(4.6) === 6`、`(0.3) === 2`；两镜各 4.4 秒用 mini 合计 `5.0`；用 2.5 合计 `15.0`；预算 10、已花 6、报价 5 时 `overBudget === true` 且退出码 2；镜头没有审核时报错信息包含 `还没有通过提交前审核`；连续两次报价得到 `Q1`、`Q2`。
- [ ] **Step 2:** `node --test tests/quote.test.ts`，预期 FAIL。
- [ ] **Step 3:** 实现；金额保留 1 位小数（`Math.round(x*10)/10`）。
- [ ] **Step 4:** 预期 PASS。
- [ ] **Step 5:** 提交 `feat: 报价`。

