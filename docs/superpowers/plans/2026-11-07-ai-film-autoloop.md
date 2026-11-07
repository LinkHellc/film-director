# AI 短片制作系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把方法论落成 agent-autoloop 的场景模板：一条导演规则 + 导演 Skill + 一组带闸门的脚本，本人只靠卡片拍板就能从一句想法做到 1080p 成片。

**Architecture:** agent-autoloop 中台按 `recipe/rules.json` 把 `film.new` 事件派给 Claude Code（导演），导演每轮读 `films/<片名>/state.json` 推进一个阶段，用 `ask` 卡片过关口、用 `later` 等出片。画图、审核、报价、提交视频、后期都是 `scripts/` 里的命令，花钱和阶段规矩在脚本里强制检查。审核是导演这一轮里另起的只读 `claude -p` 进程。

**Tech Stack:** Node 24（直接跑 `.ts`，内置 `node:test`，零 npm 依赖），Python 3.14 + Pillow（项目 `.venv`），ffmpeg，agent-autoloop，Claude Code 2.1.x，Codex CLI 0.77，火山方舟 Seedance API。

**Spec:** `docs/superpowers/specs/2026-11-07-ai-film-autoloop-design.md`（以"修订 R1"一节为准）

## Global Constraints

- 所有产物只新建、不覆盖、不删除；同名产物用 `-v<n>` 递增。唯一例外是 `state.json`（状态文件，原地更新）和追加写的 `spend.jsonl`、`requirements.md`。
- 默认模型 `seedance-2.0-mini`（网关价 720p ¥0.15/秒）；可选 `seedance-2.5`（¥0.55/秒，首尾帧支持核实前不可用）。单价只放在 `config/pricing.json`。（R1）
- 计费秒数：片中时长向上取整；若 `取整值 − 片中时长 < 0.5` 再加 1 秒。
- 视频接口：第三方 new-api 网关 `POST {SEEDANCE_BASE_URL}/v1/videos`，`SEEDANCE_BASE_URL` 默认 `https://newapi.dragon3api.com`；Key 只从环境变量 `SEEDANCE_API_KEY` 读，永不打印、不进日志、不写文件。（R1）
- Codex 调用：`codex exec --skip-git-repo-check -s read-only -i <参考图> - < <提示词>`，提示词开头固定为 `Use your image generation tool to create exactly ONE image. Do not run shell commands.`
- 审核：导演会话开的只读子 agent；`review.ts` 只做 prepare/record，不启动模型。（R1）
- 外部命令可用环境变量覆盖成 JSON 数组（测试用假程序）：`FILM_CODEX_CMD`；Codex 出图目录用 `FILM_CODEX_IMAGES` 覆盖（默认 `~/.codex/generated_images`）。
- 项目根用 `FILM_ROOT` 覆盖（默认仓库根），测试一律在临时目录里跑。
- 导演是本人在 Claude 桌面端开的 Code 会话（工作目录 = 本项目），Skill 在 `.claude/skills/film-director/`；agent-autoloop 不参与制作流程。（R1）
- 事项编号固定为 `film:<片名>`；片名只允许 `[A-Za-z0-9_\-\u4e00-\u9fa5]{1,40}`。
- 不充值、不买额度；Seedance 返回欠费即停。
- 测试命令：`node --test tests/`（Node），`.venv/Scripts/python -m unittest discover -s tests/py`（Python）。

## Review Focus

1. **审核后又改了文件**：提示词或首尾帧在 `pre-submit` 审核之后被改过，提交必须被拒绝。由 Task 5 的 `rejects files changed after review` 测试覆盖。
2. **同一份报价重复提交**：导演在不同轮次里对同一个 `Q<n>` 调了两次 `submit`，第二次必须被拒绝，`spend.jsonl` 里不能多出一行。由 Task 5 的 `rejects quote already submitted` 测试覆盖。
3. **卡片的回答不是"批准"**：本人选了"先不拍"或写了自由文字，或者卡片属于别的片子（`lane` 不同），都不能算批准。由 Task 4 的三条 `findApproval` 测试覆盖。
4. **中途欠费**：一批 3 个镜头提交到第 2 个时接口返回欠费。第 1 个的花费要记下，第 2、3 个不提交，命令以非零码退出并输出"欠费"。由 Task 5 的 `stops batch on arrears` 测试覆盖。
5. **审核输出没有明确结论**：模型最后一行写"基本通过"或者干脆没写，都必须记为"不通过"。由 Task 3 的 `parseVerdict` 测试覆盖。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json` | `"type": "module"`，`scripts.test = "node --test tests/"`，无依赖 |
| `.gitignore` | `films/`、`.venv/`、`*.env`、`node_modules/` |
| `config/pricing.json` | 模型 id → 每秒单价、默认模型 |
| `config/reviews.json` | 每类审核需要的资料文件模式 |
| `scripts/lib/paths.ts` | 项目根、片子目录、片名校验 |
| `scripts/lib/versioned.ts` | 取下一个版本路径、只新建写入 |
| `scripts/lib/hash.ts` | 文件 SHA-256 |
| `scripts/lib/state.ts` | `state.json` 的类型、读写、关口判断 |
| `scripts/lib/proc.ts` | 按环境变量覆盖解析外部命令并运行 |
| `scripts/lib/hub.ts` | 读中台状态、核对卡片批准、发事件 |
| `scripts/lib/ark.ts` | 方舟接口：建任务、查任务、下载 |
| `scripts/new-film.ts` | 开新片 |
| `scripts/quote.ts` | 报价 |
| `scripts/review.ts` | 隔离审核 |
| `scripts/seedance.ts` | `submit` / `poll` / `fetch` |
| `scripts/codex-image.ts` | 画一张图（带阶段闸门） |
| `scripts/py/sketch.py` `grayscale.py` `frames.py` `post.py` | 色块草图、黑白检查、抽帧/裁切、后期 |
| `skills/film-director/**` | 导演 Skill 和方法论参考资料 |
| `recipe/rules.json`、`README.md` | autoloop 规则与启用说明 |
| `tests/*.test.ts`、`tests/fakes/*`、`tests/py/test_*.py` | 测试与假程序 |

所有 CLI 脚本都遵循同一约定：`export async function main(argv: string[]): Promise<number>` 返回退出码；文件末尾 `if (import.meta.main) process.exit(await main(process.argv.slice(2)))`；面向导演的输出是中文一句话，机器可读结果用 `--json` 输出。测试直接调 `main` 或导出的纯函数。

---

### Task 0: 项目骨架与基础库

**Files:**
- Create: `package.json`、`.gitignore`、`config/pricing.json`、`scripts/lib/paths.ts`、`scripts/lib/versioned.ts`、`scripts/lib/hash.ts`
- Test: `tests/lib.test.ts`

**Interfaces:**
- Produces:
  - `projectRoot(): string`（`FILM_ROOT` 优先）
  - `filmDir(film: string): string`；`assertFilmName(film: string): void`（不合法时抛错 `片名不合法：<片名>`）
  - `nextVersionPath(dir: string, base: string, ext: string): string`，返回 `<dir>/<base>-v<n>.<ext>`，n 为已有最大值 +1，从 1 开始
  - `writeNew(path: string, data: string | Uint8Array): void`，用 `flag: "wx"`，已存在就抛错
  - `sha256File(path: string): string`（小写十六进制）

- [ ] **Step 1:** 执行前问本人是否用 git 管理本项目；同意则 `git init` 并在后续每个任务末尾提交，不同意则跳过所有提交步骤。
- [ ] **Step 2: 写失败测试** `tests/lib.test.ts`：
  - `nextVersionPath` 在空目录返回 `plan-v1.md`；已有 `plan-v1.md`、`plan-v3.md` 时返回 `plan-v4.md`。
  - `writeNew` 写已存在的文件抛错，原内容不变。
  - `assertFilmName("雨夜邮差")` 不抛；`assertFilmName("../x")`、`assertFilmName("")` 抛错。
  - `sha256File` 对内容 `abc` 返回 `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`。
- [ ] **Step 3:** 运行 `node --test tests/lib.test.ts`，预期 FAIL（模块不存在）。
- [ ] **Step 4:** 实现上述函数；写 `config/pricing.json`：
  ```json
  { "default": "mini",
    "models": {
      "mini": { "id": "doubao-seedance-2-0-mini-260615", "cnyPerSecond720p": 0.5 },
      "2.5":  { "id": "doubao-seedance-2-5-260628",      "cnyPerSecond720p": 1.5 } } }
  ```
- [ ] **Step 5:** 运行 `node --test tests/lib.test.ts`，预期 PASS。
- [ ] **Step 6:** 提交 `chore: 项目骨架与基础库`。

### Task 1: 片子状态与开新片

**Files:**
- Create: `scripts/lib/state.ts`、`scripts/lib/hub.ts`（只先写 `emitEvent`）、`scripts/new-film.ts`
- Test: `tests/state.test.ts`、`tests/new-film.test.ts`

**Interfaces:**
- Consumes: Task 0 全部
- Produces:
  ```ts
  type Stage = "setup"|"story"|"board"|"style"|"keyframes"|"prompts"|"generate"|"post"|"wrap"|"done";
  type GateId = "G0"|"G1"|"G2"|"G3"|"G3b"|"G4"|"G5"|"G6";
  type GateState = "pending"|"asked"|"approved"|"rejected";
  interface Shot { seconds: number; status: string; clip: string | null }
  interface FilmState {
    film: string; stage: Stage;
    settings: { seconds: number|null; aspect: string; budgetCNY: number|null; music: string|null; subtitles: boolean; model: "mini"|"2.5" };
    gates: Partial<Record<GateId, GateState>>;
    shots: Record<string, Shot>;   // 键形如 "S01"
    spentCNY: number;
  }
  readState(film: string): FilmState
  writeState(state: FilmState): void            // 先写 state.json.tmp 再 rename
  isApproved(state: FilmState, gate: GateId): boolean
  emitEvent(event: { id: string; type: string; subject: string; summary: string }): Promise<{ event: number }>
  ```
  `new-film.ts <片名> "<一句话想法>" [--no-emit]`：建 `films/<片名>/` 及子目录 `story board style shots reviews quotes approvals post out`，写 `brief.md`（想法原文）、`requirements.md`（首行 `# 本人要求`，第一条为想法原文）、`state.json`（`stage: "setup"`，`settings.aspect: "16:9"`，`model: "mini"`，其余为 null/空），然后发事件 `{ id: "film.new:<片名>", type: "film.new", subject: "film:<片名>", summary: <想法前 200 字> }`。

- [ ] **Step 1: 写失败测试**：
  - `writeState` 再 `readState` 得到同一对象；`isApproved` 对缺失关口返回 false。
  - `new-film` 带 `--no-emit` 在临时 `FILM_ROOT` 下建出全部目录和三个文件，`state.stage === "setup"`。
  - 片子目录已存在时 `main` 返回非零，且不改动已有文件。
  - 不带 `--no-emit` 时，对本地假中台（`node:http` 起在随机端口，`AGENT_AUTOLOOP_URL` 指向它）发出的请求体 `subject === "film:测试片"`、`Authorization: Bearer <AGENT_AUTOLOOP_FILM_KEY>`。
  - 没设 `AGENT_AUTOLOOP_FILM_KEY` 时目录照建，退出码非零并输出 `没有发出事件：缺少 AGENT_AUTOLOOP_FILM_KEY`。
- [ ] **Step 2:** `node --test tests/state.test.ts tests/new-film.test.ts`，预期 FAIL。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 同一命令，预期 PASS。
- [ ] **Step 5:** 提交 `feat: 片子状态与开新片`。

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

### Task 6: Codex 画图

**Files:**
- Create: `scripts/codex-image.ts`、`tests/fakes/codex.ts`
- Test: `tests/codex-image.test.ts`

**Interfaces:**
- Consumes: `readState`、`isApproved`、`resolveCommand`、`run`、`nextVersionPath`、`writeNew`
- Produces: `codex-image.ts <片名> --kind style|sheet|first|last --out <相对片子目录的基名> --prompt <提示词文件> [--ref <图>]...`
  - 闸门：G1 未批准 → 任何 `kind` 都拒绝，输出 `故事还没确认，不画图`；G3 未批准 → 只允许 `style`，输出 `画风还没确认，只能画样帧`；G3b 未批准 → 不允许 `first|last`，输出 `设定图还没确认`。被拒退出 1。
  - 提示词文件内容前面自动加上 Global Constraints 里的固定开头（文件里已有就不重复加）。
  - 运行 `resolveCommand("FILM_CODEX_CMD", ["codex"])` + `exec --skip-git-repo-check -s read-only` + 每个 `-i <ref>` + `-`，提示词走 stdin。
  - 从输出里用 `/session id:\s*([0-9a-f-]{8,})/i` 取 session id，在 `<FILM_CODEX_IMAGES>/<id>/` 找本次新出现的图片；取不到 id 时退而找出图目录下启动之后修改过的最新图片。没有图片就退出 3，输出 `Codex 没有出图`；输出里有额度相关字样（`quota`、`rate limit`、`额度`）时退出 5，输出 `Codex 额度用完`。
  - 结果复制到 `nextVersionPath(dir, base, "png")`，打印相对路径和图片宽高。宽高比与 16:9 相差超过 1% 时追加一句 `比例不是 16:9，提交视频前要裁切`。

- [ ] **Step 1:** 手动跑一次真 codex 画一张小图，确认 0.77 版输出里 session id 的格式和出图目录。按实际情况调整正则；把一段脱敏的真实输出存成 `tests/fakes/codex-output.txt` 供假程序使用。
- [ ] **Step 2: 写失败测试**：三种闸门各自拒绝、且不调用 codex（假程序写的日志为空）；正常出图得到 `style/look-v1.png`，再画一次得到 `-v2`；参考图按顺序以 `-i` 传入；假程序输出额度报错时退出 5；1024×1024 的图会打印 `比例不是 16:9`。
- [ ] **Step 3:** `node --test tests/codex-image.test.ts`，预期 FAIL。
- [ ] **Step 4:** 实现。宽高从 PNG 文件头读（IHDR），不引入依赖。
- [ ] **Step 5:** 预期 PASS。
- [ ] **Step 6:** 提交 `feat: Codex 画图与阶段闸门`。

### Task 7: Python 图像与后期工具

**Files:**
- Create: `requirements.txt`（`Pillow`）、`scripts/py/sketch.py`、`grayscale.py`、`frames.py`、`post.py`
- Test: `tests/py/test_sketch.py`、`test_grayscale.py`、`test_frames.py`、`test_post.py`

**Interfaces:**
- Produces（全部只新建文件，输出路径由调用方给，已存在则报错退出）：
  - `sketch.py <分镜JSON> <输出png>`：分镜 JSON 是 `[{ "shot":"S01", "blocks":[{"x":0.62,"y":0.4,"w":0.1,"h":0.5,"color":"#c0392b","label":"邮差"}], "bg":"#1d2a3a" }]`，坐标为画面比例。每镜画 1920×1080：背景色、色块、标签，在 x=38% 和 62% 画竖线；拼成每行 3 张的总表（缩放到每张 640×360，镜头号写在左上角）。
  - `grayscale.py <输入png> <输出png> [--min-contrast 0.25]`：转灰度存图；对 sketch 的每个色块计算块内与周围背景的亮度差（0–1），低于阈值的列出，以退出码 1 表示"明暗对比不够"。分镜 JSON 用 `--board` 传入。
  - `frames.py extract <视频> <输出目录> [--every 0.5] [--around 2.0,5.0 --n 3]`：用 ffmpeg 抽帧；`--around` 在给定时间点前后各取 n 帧。`frames.py crop169 <输入png> <输出png>`：居中裁成 16:9。`frames.py compare <首帧> <尾帧> <输出png>`：50% 叠加图 + 差值图并排，打印差异最大的 5 个区域（按 8×8 网格）。
  - `post.py concat <清单txt> <输出mp4>`：按清单顺序拼接，解码按 BT.601（`-colorspace bt470bg` 输入解释），中间文件用 FFV1 无损 mkv，最终用 `scale=1920:1080:flags=lanczos,unsharp=5:5:0.3` 放大，输出 H.264 并标 `-colorspace bt709 -color_primaries bt709 -color_trc bt709`。`post.py grade <输入> <输出> --sat 1.0 --bright 0.0`：只调彩度和亮度（`eq=saturation=..:brightness=..`），不动色相。`post.py trim <输入> <输出> --start s --end s`。
- 转场（运动模糊切 8–16 份）和卡点因片而异，不做成固定命令，由导演按 `references/stages/7-post.md` 现写 ffmpeg/Python 代码。

- [ ] **Step 1:** 问本人后安装 ffmpeg（`winget install Gyan.FFmpeg`），确认 `ffmpeg -version` 可用；建 `.venv` 并 `.venv/Scripts/python -m pip install -r requirements.txt`。
- [ ] **Step 2: 写失败测试**：sketch 输出总表尺寸 1920×360（3 镜时）且 x=38% 处像素是竖线色；grayscale 对"深红块在深蓝背景上"报出该块、退出码 1，对"白块在黑背景上"退出 0；frames 用 ffmpeg 生成 3 秒测试视频（`testsrc`），`--every 0.5` 得到 6 张，`--around 1.5 --n 3` 得到 7 张；crop169 把 1024×1024 裁成 1024×576；post concat 两段 1 秒 720p 视频得到约 2 秒 1920×1080、`color_space=bt709` 的文件（用 ffprobe 断言）；任何命令输出已存在时退出非零且原文件不变。
- [ ] **Step 3:** `.venv/Scripts/python -m unittest discover -s tests/py`，预期 FAIL。
- [ ] **Step 4:** 实现。
- [ ] **Step 5:** 预期 PASS。
- [ ] **Step 6:** 提交 `feat: 图像与后期工具`。

### Task 8: 导演 Skill（R1：在桌面会话里推进）

**Files:**
- Create: `.claude/skills/film-director/SKILL.md`
- Create: `.claude/skills/film-director/references/stages/0-setup.md` … `8-wrap.md`（共 9 个，文件名同原计划）
- Create: `.claude/skills/film-director/references/pitfalls.md`、`seven-part-prompt.md`、`gates.md`
- Test: `tests/skill.test.ts`

**内容要求：**
- `SKILL.md`：
  - frontmatter：`name: film-director`；`description` 写清什么时候用，即本人说"开一支新片 / 做一支短片 / 继续做《片名》"时。
  - 身份：总导演，本人只在这个对话里和你沟通。
  - 方法论 7 条规矩原文（PDF 第 4 页），总原则"把错误挡在花钱之前"。
  - 开新片：`node scripts/new-film.ts <片名> "<想法>" --no-emit`。
  - 继续做：读 `state.json`、`requirements.md`，再打开当前阶段的手册。
  - 每一步怎么做：
    - 只做当前阶段还没做完的部分；
    - 到了关口，按 `gates.md` 用 AskUserQuestion 问本人，问题和选项照写；
    - 本人的每次回答（包括自由文字）都追加进 `requirements.md`，注明时间和关口编号，并更新 `state.gates`。
  - 审核怎么做：
    1. 运行 `node scripts/review.ts prepare …`；
    2. 用 Agent 工具开一个新的子 agent（`subagent_type: "Explore"`，只读），prompt 只写 `读这个文件并照做：<prompt.md 绝对路径>`，不附任何对话内容和结论；
    3. 把子 agent 的最后回复原文存成 `reviews/…-v<n>.reply.md`；
    4. 运行 `node scripts/review.ts record …`。
  - 等出片：用 Bash 的 `run_in_background` 运行 `node scripts/seedance.ts wait <片名>`，等完成通知，不要手动反复查。
  - 命令速查：每条命令一行，写明各退出码的含义。
  - 出错处理（spec §9）：
    - `codex-image.ts` 退出 5（额度用完）→ 告诉本人，停止画图，等本人说继续；
    - 同一项审核连续 3 次"不通过" → 问本人怎么改；
    - Seedance 任务失败 → 读原因：参数问题改完重新报价；临时错误先确认那次失败没扣费，确认没扣才重试一次，否则重新报价；
    - 比例不对用 `frames.py crop169` 裁切，不重画。
  - 硬性禁止：
    - 不手动调用视频接口，只能经过 `seedance.ts`；
    - 不手写或改动 `spend.jsonl`、`approvals/`、`reviews/*.json`；
    - `approve.ts` 只在本人这一轮的回答里明确选了"批准 Q<n>"之后才运行，`--said` 填本人回答的原文；
    - 不覆盖、不删除文件；
    - 不打印 `SEEDANCE_API_KEY`；
    - 不充值、不买额度；
    - 没看过动态、没听过声音的东西要明说。
- 9 个阶段文件：要求同原 Task 8，写清每个阶段做什么、产物文件名、要调的审核和命令、完成后 `state` 怎么改。与原 Task 8 不同的地方：
  - 关口一律引用 `gates.md`；
  - 0-setup：检查 `SEEDANCE_API_KEY` 有没有设（只输出"有"或"没有"），不再检查 `ARK_API_KEY`；
  - 5-prompts：报价后问 G4，本人选了"批准"才运行 `approve.ts`，再运行 `seedance.ts submit`；
  - 6-generate：用 `wait` 代替 `later`；退出 4（欠费）→ 粗剪已有片段，告诉本人，停下。
- `gates.md`：G0–G6 每个关口一节，写清：
  - 问题原文和选项原文。G4 的选项固定为 `批准 Q<n>（¥合计）`、`改用 2.5 重新报价`、`先不拍`；2.5 不支持首尾帧时，不出现第二项；
  - 要附带的文件路径；
  - 选完之后做什么。
  - G5 必须写明"我没看过动态、没听过声音"。
- `pitfalls.md`、`seven-part-prompt.md`：要求同原 Task 8。易错表的原图是 `.superpowers/sdd/2026-11-07-ai-film-autoloop/pitfalls-table.png`，右栏被截断，补全的文字标 `〔补〕`。

- [ ] **Step 1: 写失败测试** `tests/skill.test.ts`，断言：
  - `SKILL.md` 有 frontmatter，且 `name: film-director`；
  - `SKILL.md` 里提到的每个 `references/...` 路径都存在；
  - `stages/` 下恰好 9 个文件；
  - G0、G1、G2、G3、G3b、G4、G5、G6 在 `gates.md` 里各有一节；
  - `gates.md` 里出现 `批准 Q`，与 `approve.ts` 的匹配规则一致；
  - 各阶段文件里出现的产物文件模式与 `config/reviews.json` 一致；
  - 所有文本里都不出现 `SEEDANCE_API_KEY=`、`ARK_API_KEY`、`agent-autoloop`。
- [ ] **Step 2:** `node --test tests/skill.test.ts`，预期 FAIL。
- [ ] **Step 3:** 写全部 Skill 文件。
- [ ] **Step 4:** 预期 PASS。
- [ ] **Step 5:** 提交 `feat: 导演 Skill 与方法论参考资料`。

### Task 9: 启用说明与不花钱的整流程试跑（R1）

**Files:**
- Create: `README.md`

- [ ] **Step 1:** 写 `README.md`，包括：
  - 系统是什么（一段话）；
  - 前置条件：Claude 桌面端、Codex 已登录、ffmpeg、`.venv`、`SEEDANCE_API_KEY` 和 `SEEDANCE_BASE_URL`；
  - 开一支新片：在桌面端新开 Code 会话，目录选本项目，说"开一支新片：……"；
  - 怎么继续做一支片子；
  - 进展看哪里：片子目录和 `state.json`；
  - 花钱规则；
  - 常见问题：Codex 额度用完、欠费、会话关了怎么接着做；
  - 可选的后台模式：`scripts/bin/claude-official.*` 和 agent-autoloop，注明"未启用"。
- [ ] **Step 2:** 不花钱的整流程试跑：主控会话在本会话里照 Skill 执行，本人回答关口。
  - 启动假网关：`node tests/fakes/video-server.ts --port 3399 --video <用 ffmpeg testsrc 生成的 5 秒 720p 视频>`；
  - 设 `SEEDANCE_BASE_URL=http://127.0.0.1:3399`、`SEEDANCE_API_KEY=test`；
  - 开片 `试跑`：想法是"一只橘猫在窗台上看雨，雨停后跳下窗台"，5 秒，1 个镜头；
  - 预期得到 `films/试跑/out/final-v1.mp4`（1920×1080、BT.709）和 `lessons.md`，`spend.jsonl` 里有 1 行；
  - 这一步会用到真实的 Codex 额度，不花视频网关的钱。每发现一个问题都记下来，回到对应 Task 去修。
- [ ] **Step 3:** 提交 `docs: 启用说明`。

### Task 10: 真实冒烟（花真钱，按网关价约 ¥1）

- [ ] **Step 1:** 先问本人两件事：`SEEDANCE_API_KEY` 和 `SEEDANCE_BASE_URL` 设好了没有；同不同意用 `seedance-2.0-mini` 跑一支 5 秒的片子，约 ¥1（5 秒 × ¥0.15）。不同意就停在 Task 9。
- [ ] **Step 2:** 用真网关走完全流程，G4 由本人亲自批准。
- [ ] **Step 3:** 核对：
  - `spend.jsonl` 的金额与网关后台账单一致；
  - 成片 1920×1080、标 BT.709（用 `ffprobe` 查）；
  - G5 的问题里写明了"没看过动态、没听过声音"。
  - 把实际花费和发现的问题写进 `films/冒烟/lessons.md`；单价有出入就修正 `config/pricing.json`。
- [ ] **Step 4:** 提交 `chore: 真实冒烟修正`。
