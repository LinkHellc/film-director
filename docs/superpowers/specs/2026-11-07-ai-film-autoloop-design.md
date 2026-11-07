# AI 短片制作系统设计（agent-autoloop 场景模板）

日期：2026-11-07
状态：待本人审阅

## 1. 目标

把《Claude code/Codex+Seedance AI视频：从一个想法到成片的全流程》（下称"方法论"，即 `视频方法论.pdf`）落成一个可重复使用的制作系统：本人只给一句想法、在关口拍板，其余由 Claude Code 当总导演完成。系统运行在 [agent-autoloop](https://github.com/KKKKhazix/agent-autoloop) 上，做成它的一个场景模板（recipe）。

**成功标准**

1. 本人运行一条命令开一支新片，此后只通过卡片（桌面通知 / 飞书）回答问题，就能拿到 1080p 成片。
2. 方法论的总原则在系统里有强制点：文字里能发现的错不留到图上，图上能发现的错不留到视频上。
3. 未经本人对报价点"批准"，系统不会向 Seedance 提交任何任务；累计花费不超过总预算。
4. 每一步产物都留档，新版本存新文件，旧文件不覆盖、不删除。
5. 等待本人回答、等待 Seedance 出片期间，不占 Agent 进程，不花 Token。

**不做的事（本期）**

- 方法论的"代理"角色（预算内替本人自动批准）。本人选择每批都问，需要时再加。
- 网页看板。查看进展用 `agent-autoloop status` 和片子目录。
- 多支片子并行的资源调度。规则支持并行，但不为此做额外设计。

## 2. 已确认的决定

| 问题 | 决定 |
|---|---|
| agent-autoloop 怎么用 | 真装上，本系统是它的场景模板：`rules.json` + Skill + 脚本 |
| 拍板通道 | 桌面通知 + 飞书，两个都配 |
| 花钱授权 | 每批视频提交前都发报价卡片，本人点"批准"才提交 |
| 审核怎么隔离 | 在导演这一轮内另起全新的只读 `claude -p` 进程（见 §4.3） |

## 3. 角色分工（对照方法论）

| 方法论角色 | 本系统里是谁 | 做什么 |
|---|---|---|
| 我 | 本人，通过卡片 | 选方向、确认画风、批准花钱、看动态、听声音 |
| Claude（总导演 / 主做） | autoloop 规则 `拍片` 派给的 Claude Code | 写故事、分镜、所有提示词；调脚本画图、出片、做后期；抽帧放大检查 |
| Codex（画师） | `scripts/codex-image.ts` 调 `codex exec` | 设定图、样帧、首尾帧 |
| Seedance（动画师） | `scripts/seedance.ts` 调火山方舟接口 | 首尾帧 → 几秒视频 |
| 审核 | `scripts/review.ts` 起的隔离进程 | 只挑错，不改文件，结论写"通过"或"不通过" |
| 监督 | `requirements.md` + 审核清单的固定一项 | 本人说过的每条要求都追加进 `requirements.md`；每次审核都核对有没有人忘了要求 |

## 4. 架构

### 4.1 总体

```
本人: node scripts/new-film.ts <片名> "<一句话想法>"
        │  建 films/<片名>/，写 brief.md，发事件 film.new（subject = film:<片名>）
        ▼
  agent-autoloop 中台 ── 规则「拍片」(Claude Code, edit, resume, parallel) ──▶ 导演一轮
        ▲                                                                    │
        │ 卡片回答 card.answered / 到期复查 timer.due（不增加跳数）            │
        │                                                                    ▼
   桌面通知 / 飞书 ◀── ask 卡片 ◀── 回执 ◀── 读 state.json → 做当前阶段 → 写产物
                                              ├─ scripts/review.ts   隔离审核
                                              ├─ scripts/codex-image.ts  画图
                                              ├─ scripts/quote.ts + seedance.ts  报价 / 提交 / 查询 / 下载
                                              └─ scripts/py/*.py      草图、黑白检查、抽帧、后期（ffmpeg）
```

每支片子是 autoloop 里的一个"事项"。导演规则写 `resume: true`，同一支片子的每一轮都接着上一轮的会话；会话接不上也没关系，导演每轮开头都重读 `state.json`、`requirements.md` 和当前阶段的产物，靠文件就能接着做。

### 4.2 为什么只有一条规则

autoloop 规定：Agent 回执里发出的事件，层数（hops）等于本轮最大层数 +1，超过 8 层就只记录、不再派发；卡片回答和 `later` 复查保持原层数（见 agent-autoloop `docs/protocol.md` 和 `kernel/decide.ts` 里的 `MAX_HOPS = 8`）。导演和审核如果靠事件来回传，每审一次加 2 层，一支片子要审几十次，必然触发熔断。所以：

- 导演规则**不发事件**（`emits` 不写），推进全靠"卡片回答"和"`later` 复查"，层数始终为 0。
- 审核在导演这一轮里同步完成（§4.3）。

### 4.3 隔离审核 `scripts/review.ts`

```
node scripts/review.ts <类型> <片名> [--shot S03]
类型：story | keyframe-plan | keyframes | pre-submit | final
```

- 每次都新起一个 `claude -p` 会话，不接任何旧会话。
- 工具只开 `Read`、`Glob`、`Grep`；不能写文件，也不能跑命令。具体参数在实现时按本机 Claude Code 版本核实。
- 提示词是 `skills/film-director/references/reviews/<类型>.md` 里的审核清单（方法论原文），资料只给清单规定的文件路径，**不给导演的结论和对话**。
- 每份审核清单的最后一项固定是：对照 `requirements.md` 检查有没有人忘了本人的要求。
- 脚本把审核的最后回复写到 `reviews/<类型>[-<镜头>]-<编号>.md`，并解析最后一行的"通过 / 不通过"，写进同名 `.json`（含结论、时间、所审文件的 SHA-256）。
- 解析不出明确结论按"不通过"处理。

### 4.4 autoloop 配置 `recipe/rules.json`

```jsonc
{
  "timezone": "Asia/Shanghai",
  "askFirst": ["花钱", "删文件", "对外发消息", "充值或买额度"],
  "sources": { "film": { "name": "短片制作" } },
  "agents": {
    "director": { "name": "总导演 Claude Code", "worker": "<本机名>", "use": "claude", "effort": "high", "access": "edit" }
  },
  "channels": {
    "desktop": { "name": "桌面通知" },
    "feishu": { "name": "飞书", "answerers": ["ou_REPLACE_ME"] }
  },
  "rules": [{
    "name": "拍片",
    "when": { "source": "film", "types": ["film.new"] },
    "to": "director",
    "cwd": "E:/05_AI/04_Claude短片流",
    "skill": "film-director",
    "parallel": 2,
    "resume": true,
    "tell": "needed",
    "channels": ["desktop", "feishu"]
  }]
}
```

字段以安装后的 agent-autoloop 版本为准，用 `agent-autoloop check recipe/rules.json` 校验。飞书 `answerers` 和通道密钥由本人填写，不进仓库。

## 5. 阶段状态机

`films/<片名>/state.json`：

```jsonc
{
  "film": "雨夜邮差",
  "stage": "story",                 // setup | story | board | style | keyframes | prompts | generate | post | wrap | done
  "settings": { "seconds": 30, "aspect": "16:9", "budgetCNY": 60, "music": null, "subtitles": false, "model": "mini" },
  "gates": { "G0": "approved", "G1": "pending" },   // pending | asked | approved | rejected
  "shots": { "S01": { "status": "keyframes", "clip": null } },
  "spentCNY": 0
}
```

导演每一轮：读 `state.json` → 只做当前阶段还没做完的部分 → 碰到关口就交 `ask` 并结束本轮 → 收到回答后更新 `gates`，进入下一阶段。

| 阶段 | 做什么 | 隔离审核 | 本人关口 |
|---|---|---|---|
| setup | 检查 Codex、ffmpeg、Python、`ARK_API_KEY`（只查有没有，不打印），缺什么就在卡片里说 | — | **G0**：片长、画幅、总预算、要不要配乐和字幕 |
| story | 和本人多轮聊（每轮一张卡片，选项加自由回答），定稿后展开成逐镜故事 | `story`：只给逐镜故事 | **G1**：定故事 |
| board | 分镜表（每镜一行，方法论 §2 的 9 列）；配色方案和每场色表；`sketch.py` 给每镜画 1920×1080 色块草图，标出 38% 和 62% 的位置，拼成总表；`grayscale.py` 转黑白检查明暗对比 | — | **G2**：定分镜和配色（卡片附总表路径） |
| style | Codex 画 2–3 张样帧 → G3；再画角色和固定道具的设定图（正面、侧面、表情；固定特征写明位置）→ G3b | — | **G3** 定画风；**G3b** 定设定图 |
| keyframes | 先写每镜的首帧画什么、尾帧画什么、中间发生什么 → 审核 → 先画尾帧，再在尾帧上改出首帧；同一机位在前一张图上改；推近镜头的尾帧用首帧裁切放大；统一裁成 16:9，首尾帧尺寸一致；按方法论 8 项逐张自检 | `keyframe-plan`；画完后 `keyframes` | 自检或审核发现要改图时问本人 |
| prompts | 每镜一份七段式提示词，对照易错表（`references/pitfalls.md`）检查 | **`pre-submit`**：每镜必须"通过" | **G4**：报价（每批一张） |
| generate | 提交 → `later` 每 5 分钟查一次 → 下载 → 抽帧放大检查 → 能剪掉就剪、能用代码修就修、都不行再改提示词或首尾帧后重拍（重拍要重新报价，旧片段保留） | — | **G5**：看动态、听声音（卡片写明 Claude 没看过动态、没听过声音） |
| post | 拼接、转场（运动模糊切 8–16 份）、按段调色（只调彩度亮度）、BT.601 解码 / 中间文件无损 / 交付标 BT.709、720p 用 lanczos 放大到 1080p 加轻微锐化、配乐卡点；抽查切点前后各 3 帧 | `final`：只给成片 | **G6**：成片验收 |
| wrap | 写 `lessons.md`：画风、可用的提示词、犯过的错 | — | — |

方法论里的规矩 1、2（确认故事前不画图、确认画风前不画正式镜头）由阶段顺序保证：`codex-image.ts` 检查 `state.json`，G1 没批准时拒绝画任何图，G3 没批准时只允许画样帧。

## 6. 花钱的闸门

### 6.1 报价 `scripts/quote.ts`

```
node scripts/quote.ts <片名> --shots S01,S02 [--model mini|2.5]
```

- 每镜计费秒数 = 片中时长向上取整，余量不足 0.5 秒时再加 1 秒。
- 单价写在 `config/pricing.json`：`doubao-seedance-2-0-mini-260615` 720p 约 ¥0.5/秒，`doubao-seedance-2-5-260628` 720p 约 ¥1.5/秒。默认用 mini。价格以账单为准，卡片上写明是估算。
- 写入 `quotes/Q<编号>.json`：镜头、秒数、模型、单价、合计、已花、预算余额、各镜头 `pre-submit` 审核文件的哈希。
- 合计 + 已花 > 总预算时，不生成可批准的报价，改为一张"超预算"卡片。

导演据此发 G4 卡片，选项是：`批准 Q<编号>（¥合计）` / `改用 2.5 重新报价` / `先不拍`。

### 6.2 提交 `scripts/seedance.ts`

```
node scripts/seedance.ts submit <片名> --quote Q3
node scripts/seedance.ts poll   <片名>
node scripts/seedance.ts fetch  <片名>
```

`submit` 发请求前依次检查，任何一项不满足就拒绝并说明原因：

1. 报价里每个镜头的 `pre-submit` 审核结论是"通过"，并且审核时的文件哈希和现在的提示词、首帧、尾帧一致（审核后改过文件就要重审）。
2. 本人批准过这份报价：通过本人密钥读中台 `GET /v1/state`，找到对应卡片，确认回答的是"批准 Q<编号>"那一项。批准记录另存到 `approvals/Q<编号>.json`。
3. `spend.jsonl` 里累计花费 + 本次报价 ≤ 总预算。
4. 这份报价没有提交过（防止重复提交）。

提交成功后，每个任务追加一行到 `spend.jsonl`（任务编号、镜头、模型、秒数、估算金额）。请求格式在实现时按火山方舟官方文档核实。`ARK_API_KEY` 只从环境变量读，不打印，不写进日志。

**这道闸门防什么、不防什么**：防的是流程失误，比如审核没过就提交、改了图没重审、重复提交、超预算。Agent 有 `edit` 权限，理论上能读到本人密钥并伪造回答；这道闸门不防有意绕过。真正的兜底是方舟账户本身的余额。系统规定不充值、不买额度。

### 6.3 欠费与额度

- Seedance 返回欠费或额度不足：立即停止提交 → 用已有片段粗剪一版 → 发通知卡片。不重试，不充值。
- Codex 生图额度用完：用 `later` 隔 1 小时再试，期间不画别的图，一次只画一张。

## 7. 目录结构

```
E:\05_AI\04_Claude短片流\
  README.md                     启用说明：安装、合并规则、配飞书、开第一支片
  视频方法论.pdf
  recipe/rules.json
  config/pricing.json
  skills/film-director/
    SKILL.md                    总规矩（方法论的 7 条规矩）+ 每轮流程 + 阶段索引 + 回执写法
    references/
      stages/0-setup.md … 8-wrap.md    每个阶段的手册，含方法论原文提示词
      reviews/story.md keyframe-plan.md keyframes.md pre-submit.md final.md
      pitfalls.md               模型易错表（方法论第 5 节）
      seven-part-prompt.md      七段式视频提示词模板
  scripts/
    new-film.ts  codex-image.ts  review.ts  quote.ts  seedance.ts  lib/*.ts
    py/ sketch.py  grayscale.py  frames.py  post.py
  tests/                        脚本测试（假 Codex、假方舟接口）
  films/<片名>/
    brief.md  state.json  requirements.md  spend.jsonl  lessons.md
    story/    board/    style/    reviews/    quotes/    approvals/
    shots/S01/  plan-v1.md  first-v1.png  last-v1.png  prompt-v1.txt  clip-v1.mp4 …
    post/     out/
```

- 版本规则：同名产物带 `-v<n>`，脚本自动取下一个编号；所有脚本只新建文件，不覆盖、不删除。
- 脚本用 Node 24 直接跑 TypeScript（和 agent-autoloop 一致），图像和视频处理用 Python + ffmpeg。

## 8. 每一轮的回执

导演每轮的最后一条回复按 agent-autoloop 的约定：第一行一句话结论；需要本人时附 `agent-autoloop` 代码块。

- `ask`：`key` 用 `<片名>-<关口>-<编号>`，`about` 写清当前阶段、相关文件路径、选完之后做什么；问完就结束这一轮。同一关口已有没回答的卡片时不重复发。
- `later`：等 Seedance 出片（5 分钟）、等 Codex 额度恢复（1 小时）。
- `notice`：欠费停下、阶段完成这类不需要回答的消息。

本人在卡片里的每次回答（包括自由文字），导演在下一轮开头都追加进 `requirements.md`，注明时间和卡片编号。

## 9. 出错处理

| 情况 | 处理 |
|---|---|
| 审核不通过 | 按清单逐条改，生成新版本文件，再审；同一项连续 3 次不通过就发卡片问本人 |
| Codex 出图失败或比例不对 | 重画一次；比例不对就用代码裁切，不重画 |
| Seedance 任务失败 | 读失败原因；参数类问题改完再走报价；临时错误先查账单或接口确认失败任务没有扣费，确认没扣才自动重试一次，否则重新报价 |
| 视频有问题 | 先剪掉 → 再用代码修 → 都不行才改提示词或首尾帧后重拍，只拍这一镜；旧片段保留 |
| 回执 JSON 写错、进程中断 | 交给 agent-autoloop 的重写和续跑机制 |
| 会话接不上 | 靠 `state.json` 和产物文件继续，不重做已完成的阶段 |
| 缺工具或缺 Key | setup 阶段发卡片说明缺什么、怎么装，不自动安装 |

## 10. 验证

1. **脚本测试**（`node --test`）：
   - 报价计算：秒数取整、预算上限、超预算的处理。
   - `seedance.ts submit` 的 4 个检查：每项单独不满足时都被拒绝；审核后改动文件会被拦下。
   - 版本文件只新增不覆盖。
   - `review.ts` 解析不出结论时按"不通过"。
   - Codex 和方舟接口用本地假服务。
2. **规则校验**：`agent-autoloop check recipe/rules.json`；`agent-autoloop emit film.new --dry-run` 预演派活。
3. **不花钱的整流程试跑**：用假方舟接口跑一支 1 个镜头的片子，走到 G6。
4. **真实冒烟**：一支 5 秒、1 个镜头的片子，用 2.0 mini，预计约 ¥3。会花真钱，跑之前单独问本人。

## 11. 开工前要准备的

| 项 | 现状 | 谁来做 |
|---|---|---|
| agent-autoloop | 未安装 | 实施时按官方安装说明装，装前确认 |
| ffmpeg | 未安装 | 本人安装，或实施时确认后安装 |
| Python 包（Pillow 等） | 未知 | 实施时装进项目专用虚拟环境 |
| `ARK_API_KEY` | 未设置 | 本人在火山引擎申请后自己设到环境变量 |
| 飞书机器人和 open_id | 未配置 | 本人提供；密钥不进仓库 |
| Node 24、Claude Code、Codex | 已有 | — |

## 12. 待实现时核实

- `claude -p` 只开只读工具的具体参数（当前版本）。
- `codex exec` 生图后的文件位置（方法论写的是 `~/.codex/generated_images/<session id>/`）和 session id 的取法。
- 火山方舟视频生成接口的请求和查询格式、首尾帧传法、720p 参数、欠费错误码。
- agent-autoloop 本人密钥的获取方式，以及 `GET /v1/state` 里卡片回答的字段。
- 桌面通知在 Windows 上的表现，以及卡片里本地文件路径能否点开。

## 修订 R1（2026-11-07，本人决定）

本节优先于上文中与之冲突的内容。

### R1.1 决定

| 问题 | 决定 |
|---|---|
| 导演在哪运行 | 本人在 Claude 桌面端开的 Code 会话（工作目录 = 本项目），由项目 Skill `.claude/skills/film-director/` 指导 |
| 审核 | 导演在会话里开的全新只读子 agent（只给清单和资料文件，不给对话和结论） |
| 关口 | 导演在对话里直接问本人（带选项），不走 autoloop 卡片 |
| Seedance 接口 | 第三方 new-api 网关 `https://newapi.dragon3api.com`，`POST /v1/videos`；地址 `SEEDANCE_BASE_URL`、密钥 `SEEDANCE_API_KEY`（本人自己设到环境变量） |
| 模型与单价（网关公开价目，720p） | `seedance-2.0-mini` ¥0.15/秒（默认）；`seedance-2.5` ¥0.55/秒，首尾帧支持待核实，未确认前不可用于首尾帧镜头 |
| agent-autoloop | 不参与制作流程。已安装的保留；`scripts/bin/claude-official.*`（官方 Claude 包装）保留，供以后改回后台运行 |

### R1.2 对上文的替换

- **§4 架构**：没有中台派活和 `rules.json`。会话关掉后，本人说"继续做《片名》"，导演从 `state.json` 接着做。
- **§4.3 审核**：`review.ts` 不再启动模型，改为两步：
  - `prepare` 生成审核提示词，并记下资料文件的哈希；
  - 导演把提示词交给子 agent，把它的最后回复存成文件；
  - `record` 解析结论、核对审核期间资料没被改动，写出审核记录（格式不变）。
- **§6.2 批准**：本人在对话里选"批准 Q<n>"后，导演运行 `approve.ts` 写 `approvals/Q<n>.json`，记下本人原话。`seedance.ts submit` 改为检查这个文件，不再查中台。这道闸门防流程失误，不防导演有意伪造；这一点比原设计更依赖导演守规矩。
- **§5 generate 阶段**：等出片改为在后台运行 `seedance.ts wait`，任务结束时会话会收到通知；不再用 `later`。
- **§8 回执**：取消。关口的问法和选项写在 Skill 的 `gates.md` 里。
- **§10 验证**：取消 `agent-autoloop check` 和派活预演。整流程试跑改在桌面会话里进行，用假网关，本人回答关口。
- **§11**：不再需要后台 Claude 登录和飞书。
