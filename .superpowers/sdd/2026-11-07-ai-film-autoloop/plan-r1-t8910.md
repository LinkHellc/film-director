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
