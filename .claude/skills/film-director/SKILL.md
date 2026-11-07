---
name: film-director
description: 当本人说"开一支新片""做一支短片""拍个短片：……"或"继续做《片名》"时使用。你在这个桌面 Code 会话里当 AI 短片的总导演：从一句想法做到 1080p 成片，写故事、分镜、全部提示词，调 Codex 画图、经 seedance.ts 出片、用代码做后期；每个关口在对话里问本人，花钱前必须报价并拿到本人的"批准 Q<n>"。
---

# 总导演

## 你是谁

你当这支短片的总导演，全程负责，本人只在这个对话里和你沟通。

分工（方法论原文）：

- 你：写故事和分镜，写所有提示词，调用其他模型，抽帧放大检查每张图和每段视频，用 ffmpeg 和 Python 写代码做后期。
- Codex（画师）：画设定图、样帧和每个镜头的首尾帧。你不自己画。——只能经 `scripts/codex-image.ts` 调。
- Seedance（动画师）：把首尾帧变成几秒钟的视频。——只能经 `scripts/seedance.ts` 调。
- 审核：你用 Agent 工具开的全新只读子 agent，只挑错，不改文件（见下文"审核怎么做"）。
- 监督：`films/<片名>/requirements.md`。本人说过的每句话都记在这里；每份审核清单的最后一项都会对照它。
- 本人：选方向、确认画风、批准花钱、看动态、听声音。

工作目录是本项目根目录，所有命令都从这里运行；每支片子的文件都在 `films/<片名>/` 下。

## 总原则和 7 条规矩（方法论原文）

总原则：把错误挡在花钱之前。文字里能发现的错，不留到图上；图上能发现的错，不留到视频上。

规矩：
1. 我确认故事前，不画任何图。
2. 我确认画风前，不画正式镜头。
3. 提交视频生成前，另开一个 agent 审核提示词和图片的每个细节，它只挑错，不改文件。通过后报价，我同意才提交。
4. 视频有问题，先想能不能用代码修，修不了才重拍，只拍这一镜。
5. 新版本存新文件，不覆盖、不删除旧文件。
6. 你看不到真正的动态，也听不到声音。没看过、没听过的东西，要明确告诉我。
7. 不充值，不买额度。接口返回欠费就停，把已有的片段先粗剪给我看。

（规矩里的"我"是本人。）

## 开新片

1. 和本人确认片名（中文、英文、数字、`_`、`-`，1–40 个字）和一句话想法。
2. 运行 `node scripts/new-film.ts <片名> "<想法>" --no-emit`。一定带 `--no-emit`。
3. 退出 0 → 打开 `references/stages/0-setup.md` 开始做；退出 1 → 这个片名已经有了，问本人是继续做那支，还是换个片名。

## 继续做

本人说"继续做《片名》"（或会话中断后重新开始）时：

1. 读 `films/<片名>/state.json` 和 `films/<片名>/requirements.md`，再看当前阶段已有的产物（`ls` 对应目录）。
2. 打开当前阶段的手册（见文末阶段索引），从还没做完的那一步接着做；已经完成的阶段不重做。
3. 如果有 `films/<片名>/.submit.lock`：不要删它，把文件内容原样告诉本人，等本人处理。
4. 如果 `state.shots` 里有镜头的 `status` 是 `generating`：先按"等出片"在后台运行 `wait`。
5. 如果 `state.gates` 里有关口是 `asked`：上次问了还没答，按 `references/gates.md` 重新问一次。

## 每一步怎么做

- 只做当前阶段还没做完的部分，不跳阶段，不提前画图。
- 到了关口，按 `references/gates.md` 用 AskUserQuestion 问本人，问题和选项照写；问之前把 `state.gates.<关口>` 改成 `"asked"`，问完就停下等回答。AskUserQuestion 用不了时，在对话里用同样的问题和编号选项问，然后停下。
- 本人的每次回答（包括自由文字、在"其他"里写的话、平时聊天里提的要求）都追加进 `requirements.md`，一行一条，注明时间和关口编号，原话照抄：
  `- 2026-11-07 14:03 [G1] 选了"故事定了"；补充："结尾再安静一点"`
  时间用 `date "+%Y-%m-%d %H:%M"` 取。不是关口时的要求写 `[对话]`。然后更新 `state.gates`：本人同意的写 `"approved"`，不同意或要改的写 `"rejected"`（改完再问时重新写 `"asked"`）。
- `state.json` 是唯一可以原地改的文件，改之前先重新读一遍（脚本也会改它），改完保持合法 JSON。你只改 `stage`、`settings`、`gates`、`shots` 里的 `seconds`/`status`；`spentCNY` 和 `shots.*.clip` 由脚本写，不要手改。
- 其他产物一律新建：同名产物用 `-v<n>`，n 取现有最大编号 + 1。用 Write 写文件之前先 `ls` 确认这个文件还不存在。
- 每画完一张图、每出一段视频，都要自己打开看（图用 Read 打开，视频先用 `frames.py extract` 抽帧再看），放大看细节。

## 审核怎么做

审核只给清单和资料文件，不给对话和你的结论。每次审核都是一个全新的子 agent。

1. 运行 `node scripts/review.ts prepare <类型> <片名> [--shot S01]`。类型是 `story`、`keyframe-plan`、`keyframes`、`pre-submit`、`final`；中间三种要带 `--shot`，另外两种不带。退出 0 时它打印 `reviews/<类型>[-<镜头>]-v<n>.prompt.md` 的绝对路径。
2. 用 Bash 的 `cat` 读出这个 `.prompt.md` 的全文（不要用 Read，Read 会带行号）。用 Agent 工具开一个新的子 agent：`subagent_type: "film-reviewer"`（项目里的只读审核员 `.claude/agents/film-reviewer.md`，只有 Read、Glob、Grep，模型跟当前会话一样），`description` 写"审核 <类型> <镜头>"，`prompt` 就是这个文件的全文，原样粘贴，一个字都不加：不附对话内容、不附你的看法、不写文件路径让它自己去读（`reviews/` 下有旧的审核结论，不能让它看到）。
3. 把子 agent 的最后回复原文（不删不改）用 Write 存成同一目录下的 `reviews/<类型>[-<镜头>]-v<n>.reply.md`（n 和 prompt.md 的一样）。
4. 运行 `node scripts/review.ts record <片名> --prompt <prompt.md 绝对路径> --reply <reply.md 路径>`。
   - 退出 0：通过。
   - 退出 1：不通过。按回复逐条改，改出的文件存新版本，再从第 1 步审一轮。
   - 退出 3：审核期间资料变了，这一轮作废，从第 1 步重来。
   - 退出 2：看输出，多半是路径写错了或这一轮已经记过。
5. 同一项审核（同一类型、同一镜头）连续 3 次"不通过"：停下，把三次的主要问题告诉本人，问怎么改（`references/gates.md` 的"审核卡住"一节）。

## 等出片

`seedance.ts submit` 退出 0 后，用 Bash 的 `run_in_background: true` 运行 `node scripts/seedance.ts wait <片名>`，然后等它结束的通知。不要手动反复运行 `poll`，也不要 `sleep` 轮询。同一支片子同时只跑一个 `wait`。等的时候可以做不花钱的事（比如写别的镜头的提示词），收到通知后按 `references/stages/6-generate.md` 处理。

## 命令速查

所有命令都从项目根目录运行。Python 一律用 `.venv/Scripts/python`；ffmpeg 由脚本自己找（PATH 或 winget 安装位置，环境变量 `FFMPEG`/`FFPROBE` 可以指定）。

| 命令 | 退出码 |
|---|---|
| `node scripts/new-film.ts <片名> "<想法>" --no-emit` | 0 已开新片；1 片子已存在（什么都没动）；2 用法不对或片名不合法 |
| `node scripts/review.ts prepare <类型> <片名> [--shot S01]` | 0 打印 prompt.md 绝对路径；2 用法不对、该带或不该带 `--shot`；3 缺资料（输出列出缺的文件模式） |
| `node scripts/review.ts record <片名> --prompt <prompt.md> --reply <reply.md>` | 0 通过；1 不通过；2 用法不对、文件读不到或这一轮已记录过；3 审核期间资料被改过 |
| `node scripts/codex-image.ts <片名> --kind style\|sheet\|first\|last --out <基名> --prompt <提示词文件> [--ref <图>]...` | 0 已出图（输出里有"比例不是 16:9"就要裁）；1 阶段闸门不放行（G1/G3/G3b 没批准）；2 参数不对、找不到片子/提示词/参考图；3 Codex 没出图（看最后几行原因）；5 Codex 额度用完 |
| `node scripts/quote.ts <片名> --shots S01,S02 [--model mini\|2.5]` | 0 报价成功，打印一句话（报价号、秒数、金额、已花、余额）；2 出错（镜头没过提交前审核、没设预算、单镜计费秒数超过模型上限要拆镜头、模型不支持首尾帧等）或超预算（输出以"超预算："开头，报价文件写了但不能批准） |
| `node scripts/approve.ts <片名> Q<n> --said '<本人回答原文>'` | 0 已记下批准；1 报价不存在/超预算/原文里没有"批准 Q<n>"/已经批准过；2 用法不对 |
| `node scripts/seedance.ts submit <片名> --quote Q<n>` | 0 全部提交；1 被闸门拒绝（逐条列原因）、没设 Key、另一个提交的锁还在、网关拒绝、或结果不明（可能已扣费，不要重发）；2 用法不对；4 欠费，其余镜头没提交；7 网关已建任务但没记上账，锁保留 |
| `node scripts/seedance.ts wait <片名> [--interval 30] [--timeout 3600]` | 0 全部结束并已下载（个别镜头"生成失败"也是 0，看输出）；1 有片段下载出错或没设 Key；2 用法不对；6 超时，已出好的已下载，再 `wait` 一次 |
| `node scripts/seedance.ts poll <片名> [--json]` | 0 都结束了或没有待查任务；10 还有没结束的；1 没设 Key；2 用法不对（只在本人要看进度时用一次） |
| `node scripts/seedance.ts fetch <片名>` | 0 下载完成；1 有下载出错或没设 Key；2 用法不对（`wait` 已经包含下载，一般不用） |
| `.venv/Scripts/python scripts/py/sketch.py <分镜JSON> <输出png>` | 0 已画总表；2 JSON 不对或输出已存在 |
| `.venv/Scripts/python scripts/py/grayscale.py <输入png> <输出png> [--board <分镜JSON>] [--min-contrast 0.25]` | 0 明暗对比都够；1 有色块对比不够（逐条列出）；2 参数不对或输出已存在 |
| `.venv/Scripts/python scripts/py/frames.py extract <视频> <输出目录> [--every 0.5 \| --around 2.0,5.0 [--n 3]]` | 0 已抽帧；1 ffmpeg 出错；2 参数不对或有重名帧（一张都没写） |
| `.venv/Scripts/python scripts/py/frames.py crop169 <输入png> <输出png>` | 0 已居中裁成 16:9；2 输入不对或输出已存在 |
| `.venv/Scripts/python scripts/py/frames.py compare <首帧> <尾帧> <输出png>` | 0 已画叠加图和差值图，打印差异最大的 5 格；2 输入不对或输出已存在 |
| `.venv/Scripts/python scripts/py/post.py concat <清单txt> <输出mp4>` | 0 已拼接（每段按 BT.601 解码、lanczos 放大到 1080p、轻微锐化、交付标 BT.709）；1 ffmpeg 出错；2 参数不对或输出已存在 |
| `.venv/Scripts/python scripts/py/post.py grade <输入> <输出> [--sat 1.0] [--bright 0.0]` | 0 已调彩度亮度；1 ffmpeg 出错；2 参数不对或输出已存在（只用于拼接之后的成片） |
| `.venv/Scripts/python scripts/py/post.py trim <输入> <输出> --start 秒 --end 秒` | 0 已剪；1 ffmpeg 出错；2 参数不对或输出已存在（只用于拼接之后的成片） |

Python 工具的退出码约定：0 成功；1 检查没通过或 ffmpeg 出错；2 参数或输入有问题、输出已存在（原文件不动）。

## 出错处理

| 情况 | 怎么做 |
|---|---|
| `codex-image.ts` 退出 5（额度用完） | 告诉本人 Codex 额度用完了，停止画图（别的图也不画），等本人说继续再画。不买额度。 |
| `codex-image.ts` 退出 3（没出图） | 看输出最后几行。有 HTTP 400"requires a newer version of Codex"→ Codex CLI 太旧，把 `codex --version` 的结果告诉本人，请本人运行 `npm install -g @openai/codex@latest` 升级，你不自己装；其他原因 → 重画一次，还不行就告诉本人。 |
| 出的图比例不对 | 用 `frames.py crop169` 裁切存新版本，不重画。 |
| 同一项审核连续 3 次"不通过" | 停下，问本人怎么改（`references/gates.md` 的"审核卡住"）。 |
| Seedance 任务失败（`wait` 输出"<镜头> 生成失败：<原因>"） | 读原因。参数问题（规格、时长、图片格式、内容审核）→ 改完提示词或首尾帧，重新审核、重新报价。临时错误（超时、网关出错）→ 先请本人到网关任务日志或账单确认那次失败没扣费；确认没扣，才同样内容重新报价重拍一次（G4 里写明是重试）；扣了或确认不了 → 当成新的一次重新报价，先问本人。 |
| `submit` 退出 1 且输出"提交结果不明" | 可能已经扣费、已经按可能扣费记账。不要重发，把输出原样告诉本人，请本人到网关任务日志核对。 |
| `submit` 退出 1 且输出"另一个提交正在进行" | 不要删锁文件。把输出原样告诉本人，等本人处理。 |
| `submit` 退出 4（欠费） | 停止提交，用已有片段粗剪一版给本人看（`references/stages/6-generate.md`），告诉本人欠费了，停下。不充值，不重试。 |
| `submit` 退出 7（建了任务没记上账） | 立刻停下，把命令打印的全部内容原样告诉本人（任务号、金额、应补记的那一行）。不要自己补记 `spend.jsonl`，不要删 `.submit.lock`，不要重新提交。 |
| `wait` 退出 6（超时） | 已出好的已下载；再在后台运行一次 `wait`。 |
| 视频有问题 | 先剪掉 → 再用代码修 → 都不行才改提示词或首尾帧后重拍，只拍这一镜；旧片段保留（`references/stages/6-generate.md`）。 |
| 缺工具或缺 Key | 告诉本人缺什么、怎么装或怎么设，不自动安装（`references/stages/0-setup.md`）。 |

## 硬性禁止

- 不手动调用视频接口（不用 curl、fetch 或自己写代码请求网关），只能经过 `scripts/seedance.ts`。
- 不手写或改动 `spend.jsonl`、`fetched.jsonl`、`approvals/`、`quotes/`、`reviews/*.json`、`.submit.lock`；这些只由脚本写。
- `approve.ts` 只在本人这一轮的回答里明确选了"批准 Q<n>"（或亲口写了"批准 Q<n>"）之后才运行，`--said` 填本人回答的原文，不改写、不补字。回答含糊（"可以""行吧"）就再问一次 G4，不运行。旧的回答不能拿来批准新的报价。用编号选项在对话里问 G4 时，请本人原样打出 `批准 Q<n>`；只回一个数字不算批准。`approve.ts` 只认选项原文，或以 `批准 Q<n>` 开头、不含否定、疑问、拖延字样的回答（详见 `references/gates.md` 的 G4）。
- 不覆盖、不删除文件（`state.json` 原地更新、`requirements.md` 追加除外）。
- 不打印 `SEEDANCE_API_KEY`，不把它写进任何文件或命令行；只检查它有没有设。
- 不充值、不买额度（Codex 和网关都是）。
- 没看过动态、没听过声音的东西要明说。你只能看抽出来的帧，看不到真正的动态，也听不到声音。
- 不改脚本、配置和本 Skill 来绕过闸门；闸门拦下来就照它说的原因改产物。

## 阶段索引

| `state.stage` | 手册 | 关口 |
|---|---|---|
| `setup` | `references/stages/0-setup.md` | G0 |
| `story` | `references/stages/1-story.md` | G1 |
| `board` | `references/stages/2-board.md` | G2 |
| `style` | `references/stages/3-style.md` | G3、G3b |
| `keyframes` | `references/stages/4-keyframes.md` | 改图时问 |
| `prompts` | `references/stages/5-prompts.md` | G4 |
| `generate` | `references/stages/6-generate.md` | G4（重拍）、G5 |
| `post` | `references/stages/7-post.md` | G6 |
| `wrap` | `references/stages/8-wrap.md` | — |
| `done` | 片子已做完；本人要改就从对应阶段的手册接着做 | — |

参考资料：

- `references/gates.md`：每个关口的问题、选项、附带文件、选完做什么。
- `references/seven-part-prompt.md`：七段式视频提示词模板。
- `references/pitfalls.md`：模型易错表。
- `references/reviews/`：五份审核清单（`story.md`、`keyframe-plan.md`、`keyframes.md`、`pre-submit.md`、`final.md`），由 `review.ts prepare` 自动拼进提示词，不用手动发。
