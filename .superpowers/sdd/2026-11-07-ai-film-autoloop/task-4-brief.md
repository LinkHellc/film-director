### Task 4: 批准记录（R1，替代原"中台批准核对"）

**Files:**
- Create: `scripts/approve.ts`
- Test: `tests/approve.test.ts`

**Interfaces:**
- Consumes: Task 0；Task 2 的 `Quote` 和 `quotes/Q<n>.json`
- Produces：
  - `approve.ts <片名> Q3 --said "<本人在对话里的原话>"`：
    - 用 `writeNew` 写 `approvals/Q3.json` = `{ quote: "Q3", totalCNY, model, shots: [...], said, at }`，已存在就报错；
    - 下面几种情况都退出 1，且不写文件：
      - 报价不存在 → `报价 Q3 不存在`；
      - 报价 `overBudget: true` → `报价 Q3 超预算，不能批准`；
      - `said` 里不含 `批准 Q3` → `本人原话里没有"批准 Q3"`；
      - 已经批准过 → `报价 Q3 已经批准过`；
    - 成功时打印 `已记下批准：Q3 ¥<合计>`。
  - 导出 `readApproval(film: string, quoteId: string): { quote: string; totalCNY: number; said: string; at: string } | null`，给 Task 5 用。

- [ ] **Step 1: 写失败测试**：每种拒绝情况各一条，成功一条；`readApproval` 对不存在的报价返回 null。
- [ ] **Step 2:** `node --test tests/approve.test.ts`，预期 FAIL。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 预期 PASS。
- [ ] **Step 5:** 提交 `feat: 批准记录`。

