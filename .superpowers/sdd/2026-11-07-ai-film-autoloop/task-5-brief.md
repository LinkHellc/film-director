### Task 5: Seedance（第三方网关）提交、查询、等待、下载（R1）

**Files:**
- Create: `scripts/lib/video-api.ts`、`scripts/seedance.ts`、`tests/fakes/video-server.ts`
- Modify: `config/pricing.json`、`tests/quote.test.ts`（期望金额随新单价调整）
- Test: `tests/seedance.test.ts`

**Interfaces:**
- Consumes: Task 0–4（`readState`、`writeState`、`Quote`、`ReviewRecord`、`readApproval`、`sha256File`、`nextVersionPath`）
- Produces:
  ```ts
  createTask(req: { model: string; prompt: string; firstFrame: string; lastFrame: string; seconds: number; resolution: "720p" }): Promise<{ id: string }>
  getTask(id: string): Promise<{ status: "queued"|"running"|"succeeded"|"failed"; videoUrl?: string; error?: string }>
  downloadVideo(id: string, url: string | undefined, dest: string): Promise<void>
  class ArrearsError extends Error {}     // 余额或额度不足
  checkGates(film: string, quoteId: string): string[]   // 空数组 = 通过
  ```
- `config/pricing.json` 改为：
  ```json
  { "default": "mini",
    "models": {
      "mini": { "id": "seedance-2.0-mini", "cnyPerSecond720p": 0.15, "firstLastFrame": true },
      "2.5":  { "id": "seedance-2.5",      "cnyPerSecond720p": 0.55, "firstLastFrame": false } } }
  ```
  `firstLastFrame` 只有在 Step 1 从网关或 new-api 文档确认支持后，才能改成 true。
- 命令：
  - `seedance.ts submit <片名> --quote Q3`：
    - 先调 `checkGates`，有原因就逐条打印，退出 1，不发任何请求；
    - 通过后逐镜头用最新的 `prompt-v*.txt`、`first-v*.png`、`last-v*.png` 建任务；
    - 每成功一个，就向 `spend.jsonl` 追加一行 `{"at","quote","shot","task","model","billable","cny"}`，并更新 `state.spentCNY` 和 `state.shots[镜头].status = "generating"`；
    - 遇到 `ArrearsError` 立即停止，打印 `欠费：已提交 <n> 镜，其余未提交`，退出 4。
  - `poll <片名>`：查询所有还没下载的任务；全部结束退出 0，还有在跑的退出 10；`--json` 输出数组。
  - `fetch <片名>`：把成功的视频下载到 `shots/<镜头>/clip-v<n>.mp4`，更新 `state.shots[镜头].clip`；失败的任务打印原因。
  - `wait <片名> [--interval 30] [--timeout 3600]`：反复 poll 直到全部结束，然后 fetch；结束退出 0，超时退出 6 并输出 `还没出完，稍后再 wait`。导演在后台运行它。
- `checkGates` 的检查顺序和文案：
  1. `报价 Q3 不存在` / `报价 Q3 超预算，不能提交`
  2. `模型 <id> 不支持首尾帧`（pricing 里 `firstLastFrame` 不为 true）
  3. `S01 的提交前审核不是"通过"`
  4. `S01 审核后改过文件：<相对路径>`：最新审核记录里的哈希和现在的文件不一致，或者现在最新的提示词、首帧、尾帧已经不是当时审核的那个
  5. `报价 Q3 还没有本人批准`：`readApproval` 返回 null，或批准记录的 `totalCNY` 和报价对不上
  6. `花费会超预算：已花 ¥x + 本次 ¥y > 预算 ¥z`
  7. `报价 Q3 已经提交过`：`spend.jsonl` 里已有 `quote === "Q3"` 的行
- 环境变量：
  - `SEEDANCE_BASE_URL`：默认 `https://newapi.dragon3api.com`；
  - `SEEDANCE_API_KEY`：没设就退出 1，输出 `没有设置 SEEDANCE_API_KEY`；
  - Key 永远不出现在任何输出、日志或文件里。

- [ ] **Step 1:** 核实网关接口，**不发任何会扣费的请求**。
  - 资料：
    - `.superpowers/sdd/2026-11-07-ai-film-autoloop/gateway-notes.md` 和 `gateway-pricing.json`；
    - new-api 官方文档和源码（https://github.com/QuantumNous/new-api，视频任务的 relay 部分，以及豆包/Seedance 适配器）；
    - 网关首页公开的文档页（如果有）。
  - 要查清：
    - `POST /v1/videos` 的请求格式：JSON 还是 multipart；模型、提示词、时长 `seconds`、分辨率怎么写；首帧和尾帧怎么传（base64 data URL 还是网址，用什么字段名）；
    - 查询接口和下载接口；
    - 余额或额度不足时返回的 HTTP 状态码和错误文案；
    - 允许的时长范围，据此修正 Task 2 里 `billableSeconds` 的 2 秒下限；
    - `seedance-2.5` 是否支持首尾帧。
  - 结论写进 `scripts/lib/video-api.ts` 顶部注释，附来源链接。查不清的标"未核实"，按最保守的方式实现。
- [ ] **Step 2: 写失败测试**。假网关 `tests/fakes/video-server.ts` 要能记录收到的请求，能配置成返回成功、失败或欠费，也能单独运行（`node tests/fakes/video-server.ts --port <n> --video <mp4>`，Task 9 要用）。测试项：
  - `checkGates` 的 7 项，各自单独不满足时返回对应原因；全部满足时返回 `[]`。
  - `rejects files changed after review`：审核后往 `prompt-v1.txt` 追加一个字 → 被拒；审核后新增 `prompt-v2.txt` → 也被拒。
  - `rejects quote already submitted`：Q1 提交成功后再提交一次 → 退出 1，假网关只收到第一次的请求，`spend.jsonl` 行数不变。
  - `stops batch on arrears`：报价 3 镜，第 2 个请求返回欠费 → 退出 4，`spend.jsonl` 只有 1 行，假网关只收到 2 个请求。
  - 请求头是 `Authorization: Bearer <SEEDANCE_API_KEY>`；stdout 和 stderr 里都不出现 Key 原文。
  - `poll`：有任务在跑时退出 10。
  - `wait`：假网关第 3 次查询返回成功 → 下载出 `clip-v1.mp4`，退出 0；`--timeout 1` 时退出 6。
  - 重拍后得到 `clip-v2.mp4`，`clip-v1.mp4` 还在。
  - `tests/quote.test.ts` 按新单价改期望值：两镜各 4.4 秒用 mini → `1.5`，用 2.5 → `5.5`。
- [ ] **Step 3:** `node --test tests/seedance.test.ts tests/quote.test.ts`，预期 FAIL。
- [ ] **Step 4:** 实现。
- [ ] **Step 5:** 预期 PASS，`npm test` 全部通过。
- [ ] **Step 6:** 提交 `feat: Seedance 第三方网关与花钱闸门`。

