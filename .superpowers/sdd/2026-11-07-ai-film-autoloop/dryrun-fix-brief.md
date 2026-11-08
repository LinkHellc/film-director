# 试跑问题修复（一次修完）

仓库 E:/05_AI/04_Claude短片流，分支 dev。规则：
- 每项先写失败测试再修（Skill 文字类改动用 tests/skill.test.ts 的字符串断言）。
- 只在本地提交，不推送；不要动 films/ 下的任何文件。
- 修完 `npm test` 和 `.venv/Scripts/python -m unittest discover -s tests/py` 两套都要通过。

试跑记录：`.superpowers/sdd/2026-11-07-ai-film-autoloop/dryrun-findings.md`。

## 代码

### D1 Windows 上退出码变 127（必须修）
**现象**：`node scripts/seedance.ts wait 试跑` 下载成功、账也记全了，但退出时 Node 报
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`，退出码成了 127，而不是 0。

**原因**：所有 CLI 末尾都是 `if (import.meta.main) process.exit(await main(...))`。fetch（undici）的连接还在关闭时就调了 `process.exit()`。

**修法**：
- 所有 `scripts/**/*.ts` 和 `scripts/bin/*.js` 的入口行改成 `if (import.meta.main) process.exitCode = await main(process.argv.slice(2));`，让事件循环自然结束。
- 确认没有定时器或连接会让进程挂住：例如 wait 的 sleep 用完就清；必要时在 video-api 里给 fetch 设 `keepalive: false`，或请求头加 `connection: close`。
- 测试：
  1. 静态检查：scripts 下任何 .ts/.js 里都不出现 `process.exit(`；`scripts/bin/claude-official.js` 转发子进程退出码的地方例外，那里可以保留，但要确认不受影响。
  2. 用子进程真实跑一次：起假网关（tests/fakes/video-server.ts 的 startVideoServer），用 `node scripts/seedance.ts wait` 跑一个已提交的任务，断言退出码是 0，并且进程在合理时间内（<10 秒）自己结束。另外再挑一个会报错退出的命令（比如缺参数），断言退出码仍然正确（2）。

### D2 spend.jsonl 金额存储取整
**现象**：`cny` 存成了 `0.8999999999999999`。

**修法**：写入 spend.jsonl（含核对行和结果不明行）时，`cny` 用 `Math.round(x*100)/100`。读取和累加逻辑不变：旧数据照常读，求和时用未取整的值，这两点都不要改。

**测试**：6 秒 × 0.15 写入后，读回来是 `0.9`。

### D3 单镜头草图总表留白
**现象**：`sketch.py` 只有 1 个镜头时，总表仍按 3 列拼，右边 2/3 是空灰块。

**修法**：列数取 `min(3, 镜头数)`，总表宽度 = 列数 × 640。

**测试**：1 镜时输出 640×360；3 镜时仍是 1920×360。

## Skill（.claude/skills/film-director/）

### D4 禁止原地改产物
SKILL.md 的"硬性禁止"加一条：不用 `sed -i`、`>` 重定向覆盖、Edit/Write 改已存在的产物文件，改动一律另存为新版本。例外只有 `state.json` 和 `requirements.md`（只追加）。

### D5 时间轴按生成秒数写
在 `4-keyframes.md`（首尾帧计划）和 `5-prompts.md`、`seven-part-prompt.md`（【逐秒】）里写明：
- 尾帧对应的是**生成秒数**的最后一刻，不是片中时长的最后一刻；
- 【逐秒】的时间轴覆盖整个生成秒数；片中时长之后多出来的那段写成"静止，后期剪掉"；
- 分镜表里"片中时间"和"生成秒数"两个数都要带上。

### D6 设定特征看图写
`3-style.md` 第二部分第 4 步（把固定特征追加进 requirements.md）改为：必须用 Read 打开每张设定图，逐项看图写（毛色或衣服、花纹位置、眼睛颜色、配饰），不凭印象、不照抄提示词；写完再和设定图对一遍。

### D7 生成后自动打开给本人看
SKILL.md 的"每一步怎么做"加一条：每出一张图（样帧、设定图、首尾帧、草图）、每下载一段片段、每出一版成片，都用 `mcp__ccd_host__reveal_path` 在文件管理器里打开给本人看；这个工具用不了时，给出可点击的路径。G3、G3b、G2、G5、G6 提问前先打开附带的文件。

### D8 本人回答里有换行
SKILL.md 记录 `requirements.md` 那条补充：本人原话里有换行时，换成 ` / `，保持一条一行，原话其他部分不改。

### 测试（tests/skill.test.ts）
断言以下字样都在对应文件里出现：
- SKILL.md：`sed -i`、`reveal_path`、` / `；
- `4-keyframes.md` 和 `5-prompts.md`：`生成秒数`；
- `3-style.md`：`看图`。

## 报告
写到 `.superpowers/sdd/2026-11-07-ai-film-autoloop/dryrun-fix-report.md`，逐项写：改了什么、覆盖它的测试、运行的命令、输出结果。
