### Task 3: 审核的准备与记录（R1）

**Files:**
- Create: `scripts/review.ts`、`config/reviews.json`、`.claude/skills/film-director/references/reviews/story.md`、`keyframe-plan.md`、`keyframes.md`、`pre-submit.md`、`final.md`
- Test: `tests/review.test.ts`

**Interfaces:**
- Consumes: Task 0（`filmDir`、`nextVersionPath`、`writeNew`、`sha256File`）、Task 2 读审核记录的约定
- Produces:
  ```ts
  type ReviewKind = "story"|"keyframe-plan"|"keyframes"|"pre-submit"|"final";
  parseVerdict(text: string): "pass"|"fail"
  materialsFor(kind: ReviewKind, film: string, shot?: string): string[]   // 绝对路径，按 config/reviews.json 取每类模式下最新版本
  interface ReviewRecord { kind: ReviewKind; film: string; shot: string|null; verdict: "pass"|"fail"; at: string; files: Record<string, string> } // 绝对路径 → sha256
  ```
  - `review.ts prepare <类型> <片名> [--shot S03]`：
    - 取下一个编号 n，写 `reviews/<类型>[-<镜头>]-v<n>.prompt.md`；
    - 内容 = 清单全文 + `\n\n资料（只读这些文件，不要读别的）：\n` + 每行一个绝对路径 + `\n本人要求：` + `requirements.md` 绝对路径 + `\n\n最后一行只写"通过"或"不通过"。`；
    - 同时写同名 `.prompt.json` = `{ kind, film, shot, n, files: {路径: sha256} }`；
    - 打印提示词文件路径（`/` 分隔），退出 0；
    - 资料缺失时退出 3，输出以 `缺少资料：` 开头，不写任何文件；
    - 提示词里不能出现 `state.json` 或 `reviews/` 下的任何路径。
  - `review.ts record <片名> --prompt <prompt.md 路径> --reply <回复文件>`：
    - 读同名 `.prompt.json`，逐个重算哈希，有变化就退出 3，输出 `审核期间文件变了：<相对路径>`；
    - 否则写 `reviews/<类型>[-<镜头>]-v<n>.md`（回复原文）和 `.json`（`ReviewRecord`，`files` 取自 `.prompt.json`）；
    - 打印 `审核 <类型>：通过|不通过（reviews/...md）`；通过退出 0，不通过退出 1。
  - `config/reviews.json` 的模式（相对片子目录，`*` 取最新版本），同原 Task 3：
    - story → `story/shots-v*.md`
    - keyframe-plan → `shots/<镜头>/plan-v*.md`、`board/storyboard-v*.md`
    - keyframes → `shots/<镜头>/first-v*.png`、`last-v*.png`、`style/sheet-*-v*.png`（每个角色取最新）、`shots/<镜头>/plan-v*.md`
    - pre-submit → `shots/<镜头>/prompt-v*.txt`、`first-v*.png`、`last-v*.png`、`style/sheet-*-v*.png`、`board/storyboard-v*.md`、`board/palette-v*.md`
    - final → `out/final-v*.mp4` 和 `out/final-v*-frames/` 下的全部图片

- [ ] **Step 1:** 写 5 份清单，内容取方法论原文（`.superpowers/sdd/2026-11-07-ai-film-autoloop/methodology.txt`）：
  - story = PDF 第 6 页"这是一支短片的逐镜头故事…"清单；
  - keyframe-plan = 第 10 页"先写首帧画什么、尾帧画什么、中间发生什么"，套用 keyframes 的 8 项；
  - keyframes = 第 10–11 页 8 项检查；
  - pre-submit = 第 12–13 页"你是审核，只读不改…"清单；
  - final = 第 14 页全片复核清单。
  - 每份开头写：`你是第一次看这些材料的审核，只读不改，不要写或改任何文件。图片要用 Read 打开放大看。`
  - 每份结尾加一项：`对照本人要求文件，列出被忘掉的要求。`
- [ ] **Step 2: 写失败测试**：
  - `parseVerdict`：
    - `"…\n通过"` → pass；
    - `"…\n不通过"`、`"…\n基本通过"`、`"通过\n还有一条建议"`、`""` → fail；
    - 规则：只看去掉空白和 Markdown 加粗后的最后一个非空行，它恰好等于"通过"才算 pass。
  - `prepare`：写出 `.prompt.md` 和 `.prompt.json`；提示词里列出提示词、首帧、尾帧的绝对路径；不含 `state.json` 或 `reviews/` 路径；缺首帧时退出 3 且不写文件。
  - `record`：
    - 回复末行"通过"时退出 0，写出 `.md` 和 `.json`，`.json` 字段与 `ReviewRecord` 一致；
    - 在 prepare 和 record 之间往提示词文件追加一个字 → 退出 3，输出含 `审核期间文件变了`；
    - 连续两轮得到 `-v1` 和 `-v2`。
  - 集成：record 一份 pre-submit 通过之后，Task 2 的 `buildQuote` 能对这个镜头报价，不抛错。
- [ ] **Step 3:** `node --test tests/review.test.ts`，预期 FAIL。
- [ ] **Step 4:** 实现。
- [ ] **Step 5:** 预期 PASS，`npm test` 全部通过。
- [ ] **Step 6:** 提交 `feat: 审核的准备与记录`。

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

