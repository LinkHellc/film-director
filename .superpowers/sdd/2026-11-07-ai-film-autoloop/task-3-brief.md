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

