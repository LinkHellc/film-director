# Task 4 报告：批准记录（approve.ts）

**状态：** DONE
**提交：** e9c6de2 `feat: 批准记录`（dev 分支，本地，未推送；未提交的 PDF 未动）

## 文件
- `scripts/approve.ts`（新建）
- `tests/approve.test.ts`（新建）

## 接口
- CLI：`approve.ts <片名> Q<n> --said "<原话>"`
  - 成功：`writeNew` 写 `films/<片名>/approvals/Q<n>.json` = `{ quote, totalCNY, model, shots, said, at }`（先 `mkdirSync(recursive)`），打印 `已记下批准：Q3 ¥5.0`（合计按 `toFixed(1)`，与 quote.ts 一致），退出 0。
  - 退出 1 且不写文件：`报价 Q3 不存在`；`报价 Q3 超预算，不能批准`；`本人原话里没有"批准 Q3"`；`报价 Q3 已经批准过`（靠 `writeNew` 的 EEXIST，不先查再写，无竞态）。
  - 退出 2（用法）：报价号不匹配 `^Q\d+$`、缺 `--said`/缺值、多余参数、片名不合法。
- 导出 `readApproval(film, quoteId)`：不存在返回 null；报价号不合法抛 `报价号不合法`。
- 额外导出 `saidApproves(said, quoteId)` 与 `Approval` 类型；`Quote` 从 quote.ts 以 `import type` 引入。

## 设计取舍
- 原话匹配用 `批准 ${id}(?!\d)`：半角空格必需；`批准 Q31` 不满足 Q3；`批准 Q3` 也不满足 Q31；大小写敏感（`批准 q3` 不算）；全角空格不算。
- 检查顺序：报价存在 → 内容完整 → 超预算 → 原话 → 已批准过。
- 失败即关：`overBudget !== false`（缺字段或坏值）一律按超预算拒绝。报价 JSON 坏 / `totalCNY` 非有限数 / `shots` 非数组 → 退出 1（`报价 Q3 不是合法的 JSON` / `报价 Q3 内容不完整`），这两条消息不在 brief 里，属于补充。

## 测试
`node --test tests/approve.test.ts`：先 RED（模块不存在），实现后 8/8 通过；`npm test` 全套 57/57 通过。
覆盖：成功+readApproval 读回；报价不存在（+readApproval 返回 null）；超预算；原话不含（多种变体）；Q3 vs Q31 双向；已批准过（原文件不变）；用法错误退出 2；readApproval 非法报价号抛错。

## 关注点
- `readApproval` 只做 JSON.parse，不校验内容结构；Task 5 闸门若要严格，可再校验 `quote === quoteId`、`totalCNY` 与当前报价一致等。
- 批准文件不校验报价的 `film` 字段是否等于片名（报价由 quote.ts 写在本片目录下，视为可信）。
