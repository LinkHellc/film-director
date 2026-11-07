# AI 短片流

从一句想法做到 1080p 成片的 AI 短片制作流程。你在 Claude 桌面端开一个 Code 会话、目录选本项目，这个会话就是**总导演**：它自动加载项目 Skill `.claude/skills/film-director/`，写故事、分镜和全部提示词，调 **Codex**（画师）画设定图和首尾帧，经第三方网关调 **Seedance**（动画师）出视频，再用 ffmpeg 和 Python 做后期。每一步做完都由导演开的**全新只读子 agent**审核（只挑错，不改文件）。每个关口导演都在对话里问你；花钱前一定先报价，等你说"批准 Q<n>"。

流程细节（阶段、关口的问题和选项、审核清单、命令和退出码）都写在 Skill 里，这份说明只讲怎么启用、怎么用：

- `.claude/skills/film-director/SKILL.md`：导演守则、命令速查、出错处理
- `.claude/skills/film-director/references/gates.md`：关口 G0–G6 的问题和选项
- `.claude/skills/film-director/references/stages/`：各阶段手册（0-setup … 8-wrap）
- 设计文档：`docs/superpowers/specs/2026-11-07-ai-film-autoloop-design.md`（以"修订 R1"一节为准）

## 一、前置条件

以下都在 Windows 上，命令在 PowerShell 里运行，目录是本项目根目录。

### 1. Claude 桌面端

装好 Claude 桌面端，能开 Code 会话。导演就是你开的那个会话，不需要额外配置。

### 2. Node 24+

```powershell
node --version   # v24 或更高
```

### 3. Codex CLI（画师），要新版并已登录

旧版会被接口拒绝（0.77 就被拒过，报 HTTP 400 "requires a newer version of Codex"）。升级并确认：

```powershell
npm install -g @openai/codex@latest
codex --version
codex            # 第一次用时按提示登录
```

注意：这台机器有两个 npm 全局目录。升级后用 `codex --version` 确认 **PATH 里那个** `codex` 是新版本；不是的话，用 `where.exe codex` 看它在哪个目录，对那个 npm 前缀再装一次（例如 `npm install -g --prefix <那个目录> @openai/codex@latest`）。

### 4. Python 虚拟环境（Pillow）

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

所有 Python 脚本都用 `.venv/Scripts/python` 运行。

### 5. ffmpeg

```powershell
winget install Gyan.FFmpeg
```

脚本会自己找：先看环境变量 `FFMPEG` / `FFPROBE`（完整路径），再看 PATH，最后看 winget 的安装目录。所以装完不用开新 shell，也可以用这两个变量指定别的版本。

### 6. 视频网关的 Key 和地址（你自己设）

视频走第三方 new-api 网关 `https://newapi.dragon3api.com`（`POST /v1/videos`）。

| 环境变量 | 必须 | 说明 |
|---|---|---|
| `SEEDANCE_API_KEY` | 是 | 网关的 Key。只设在你的用户环境变量里，**不要写进任何文件，也不要发到对话里** |
| `SEEDANCE_BASE_URL` | 否 | 不设就用 `https://newapi.dragon3api.com`；试跑用假网关时才设成 `http://127.0.0.1:<端口>`。每个任务记下提交时的网关地址，之后查询、下载只去同一个地址；中途改了地址，`poll`/`fetch`/`wait` 会说"当前网关地址不同，跳过"，改回来再等 |

```powershell
[Environment]::SetEnvironmentVariable('SEEDANCE_API_KEY', '<你的key>', 'User')
# 可选：
# [Environment]::SetEnvironmentVariable('SEEDANCE_BASE_URL', 'https://newapi.dragon3api.com', 'User')
```

设完**重启 Claude 桌面端**，已经开着的会话读不到新设的变量。导演开工时只检查 Key"有/没有"，从不打印它。

### 模型和价格

见 `config/pricing.json`（网关公开价目，720p，均为估算，**以网关账单为准**）：

| 简称 | 模型 | 单价 | 首尾帧 |
|---|---|---|---|
| `mini`（默认） | `seedance-2.0-mini` | ¥0.15/秒 | 支持 |
| `2.5` | `seedance-2.5` | ¥0.55/秒 | 未确认，**不能用于首尾帧镜头**（提交闸门会拦） |

网关提交时按每镜上限预扣（mini 每镜 15 秒），出片后退差额，账户余额要够预扣。

## 二、开一支新片

1. 在 Claude 桌面端新开一个 Code 会话，目录选本项目（`E:/05_AI/04_Claude短片流`）。
2. 说：`开一支新片：<一句话想法>`（也可以说"拍个短片：……"）。
3. 导演会先确认片名（中文、英文、数字、`_`、`-`，1–40 字），建好 `films/<片名>/`，检查环境，然后问 G0：片长、画幅、总预算、配乐和字幕。
4. 之后按阶段往下做：故事 → 分镜和配色 → 画风和设定图 → 首尾帧 → 视频提示词和报价 → 出片 → 后期 → 收尾。每个关口它会停下来问你，你在对话里选选项或写自由文字。

你说过的每句话都会原文记进 `films/<片名>/requirements.md`，审核会拿它对照。

## 三、继续做一支片子

会话关了、电脑重启了、或想换个会话接着做：新开一个 Code 会话（目录同样选本项目），说

```
继续做《片名》
```

导演会读 `state.json` 和 `requirements.md`，从当前阶段没做完的地方接着做，已完成的阶段不重做；上次问了还没答的关口会重新问一次；有正在生成的镜头就先在后台等出片。

## 四、进展看哪里

每支片子都在 `films/<片名>/`（`films/` 不进 git）：

```
films/<片名>/
  state.json        当前阶段 stage、设置 settings、关口 gates、镜头 shots、已花 spentCNY
  brief.md          一句话想法
  requirements.md   你说过的每句话（追加）
  story/            逐镜故事
  board/            分镜表、配色、色块草图、黑白检查图
  style/            样帧、设定图
  shots/<镜头>/     提示词、首帧、尾帧、视频片段（都按 -v<n> 存新版本，不覆盖）
  reviews/          每次审核的提示词、回复和记录
  quotes/           报价 Q<n>.json
  approvals/        你的批准记录 Q<n>.json（含你的原话）
  spend.jsonl       花费账本（每提交一个任务一行）
  post/  out/       后期中间文件、成片 final-v<n>.mp4
  lessons.md        收尾总结（含总花费）
```

最快的办法是看 `state.json` 的 `stage` 和 `gates`；花了多少以 `spend.jsonl` 为准。

## 五、花钱规则

1. **先报价**：一批镜头的提交前审核都通过后，导演运行 `quote.ts` 出报价 Q<n>（镜头、计费秒数、金额、已花、预算余额）。超预算的报价不能批准。
2. **你批准**：只有你在这一轮回答里选了或亲手写了 `批准 Q<n>`，导演才运行 `approve.ts` 记下你的原话。"可以""行"、只回一个选项编号、"批准 Q3？""先等等再批准 Q3"这类带否定、疑问或拖延的话都不算批准，它会再问一次。旧的批准不能用于新报价。
3. **7 道闸门**：`seedance.ts submit` 提交前逐条检查——报价存在且不超预算、模型支持首尾帧且价格一致、每镜提交前审核通过、审核后提示词和首尾帧没改过、你批准了这份报价且金额一致、按 `spend.jsonl` 现算不超预算、这份报价没提交过。任何一条不满足就不提交。
4. **先试拍**：先拍 1–2 镜，你在 G5 看过动态、听过声音、选了"都可以"，才给其余镜头报价。
5. **不充值、不买额度**（Codex 和网关都是）。网关返回欠费就停，用已有片段粗剪一版给你看。
6. **`.submit.lock` 不要随手删**：`submit` 退出 7（网关已建任务、但没记上账）时锁会留着。先到网关任务日志核对那个任务，把命令输出里"应补记的那一行"补进 `spend.jsonl`，确认无误后再由你自己删锁。导演不会自己删锁、补账或重发。
7. 所有金额都是按网关公开价目算的**估算**，以网关账单为准。

## 六、常见问题

**Codex 额度用完了**：`codex-image.ts` 退出 5，导演会停止画图并告诉你。等额度恢复后说"继续做《片名》"或"继续画"。不会替你买额度。

**Codex 报"requires a newer version of Codex"**：CLI 太旧，按"前置条件 3"升级，注意两个 npm 全局目录的问题，然后 `codex --version` 确认。

**网关欠费**：`submit` 退出 4，其余镜头不提交。你自己决定是否去网关充值；充值后说"继续做《片名》"，导演会重新报价、再问你批准。

**提交结果不明 / 另一个提交正在进行**：可能已经扣费。不要重发，到网关任务日志核对；锁文件按"花钱规则 6"处理。

**某镜生成失败**：参数问题会改完重审、重新报价；临时错误要你先在网关日志或账单确认那次没扣费，才同样内容重新报价重拍。

**会话关了**：见"三、继续做一支片子"。正在生成的视频不受影响，下次进来导演会接着等、接着下载。

**设了 Key 但导演说"没有"**：设完环境变量要重启 Claude 桌面端。

**导演看不到动态、听不到声音**：它只能看抽出来的帧。动作顺不顺、声音能不能用，要你在 G5 和 G6 亲自看、亲自听。

## 七、测试

```powershell
npm test                                                    # Node 脚本（node --test）
.venv/Scripts/python -m unittest discover -s tests/py       # Python 工具
```

测试用假的 Codex 和假的视频网关（`tests/fakes/`），不花钱、不用真 Key。

## 八、可选：后台模式（未启用）

现在的流程只在你开的桌面会话里跑。项目里保留了以后改回后台运行要用的东西，**目前都未启用**：

- `scripts/bin/claude-official.js` / `.cmd`：用独立配置目录 `~/.claude-film`（可用 `FILM_CLAUDE_CONFIG_DIR` 改）运行官方 Claude Code，去掉全局网关相关的环境变量，不改 `~/.claude` 的配置。
- `scripts/bin/login-official.ps1`：在这个独立配置目录里打开官方 Claude Code，用来 `/login`。
- agent-autoloop（Agent 自动化中台）：不参与当前制作流程；`new-film.ts` 不带 `--no-emit` 时会向它发 `film.new` 事件，导演开片时一律带 `--no-emit`。
