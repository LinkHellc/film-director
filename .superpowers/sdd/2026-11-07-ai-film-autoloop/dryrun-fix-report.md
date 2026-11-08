# 试跑问题修复报告（D1–D8）

分支 dev，本地提交，未推送；没有动 `films/`、`~/.claude`，没有连真网关。未跟踪的 PDF 没提交。

## 提交

| 提交 | 内容 |
|---|---|
| `99cc14a` | D1：CLI 入口改 `process.exitCode`；新增 `tests/exit.test.ts` |
| `06f588a` | D2：spend.jsonl 的 `cny` 写入时取整到分 |
| `37a428e` | D3：sketch.py 列数取 `min(3, 镜头数)` |
| `2407bc3` | D4–D8：Skill 文字改动 + `tests/skill.test.ts` 断言 |

## D1 Windows 上退出码变 127

**复现**：`tests/exit.test.ts` 第二个测试：临时 FILM_ROOT，起 `startVideoServer({ known: ["task_known01"], succeedAfter: 2 })`，spend.jsonl 写一行已提交的任务，用 `scripts/lib/proc.ts` 的 `run()`（异步 spawn，不挡住本进程里的假网关，10 秒超时返回 124）跑
`node scripts/seedance.ts wait 退出片 --interval 0.2 --timeout 30`。
修之前连跑 3 次都失败，stderr 是 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`（和试跑一样）。把 scripts 暂存回修之前的版本再跑一次，仍是同样的失败（pass 0 / fail 2）。

**改了什么**：
- `scripts/{approve,codex-image,new-film,quote,review,seedance}.ts` 末行改成
  `if (import.meta.main) process.exitCode = await main(process.argv.slice(2));`
- `scripts/bin/claude-official.js`：找不到 claude 时 `process.exit(127)` → `process.exitCode = 127; return;`；子进程 `error` 时 `process.exit(1)` → `process.exitCode = 1`。转发子进程退出码的 `child.on("exit", … process.exit(signal ? 1 : (code ?? 1)))` 照原样保留（例外）。
- 没有加 `keepalive: false` / `connection: close`：wait 的 sleep 是一次性 `setTimeout`，resolve 后就没了；`AbortSignal.timeout` 不挂住进程；子进程实测约 0.27 秒自己结束，所以不需要。

**测试**（`tests/exit.test.ts`）：
1. 静态检查：遍历 `scripts/` 下所有 .ts/.js，除了 claude-official.js 里那一行转发代码，其他地方都不能出现 `process.exit(`；同时断言那一处还在 `child.on("exit"` 里。
2. 子进程真跑：退出码 0、10 秒内结束、stdout 有 `S01 已下载：shots/S01/clip-v1.mp4`、stderr 里没有 `Assertion failed`；再跑 `node scripts/seedance.ts wait`（缺片名），退出码 2，stderr 有"用法"。

**命令/结果**：`node --test tests/exit.test.ts` 连跑 5 次，每次 `pass 2 fail 0`。

## D2 spend.jsonl 金额存储取整

**改了什么**：`scripts/seedance.ts` 加 `round2(x) = Math.round(x*100)/100`；submit 写 spend 行（正常行和 `uncertain` 行共用 `base`）时存 `cny: round2(cny)`。本次累计 `total`、提示文字和 `unrecorded` 里的金额仍用未取整的 `cny`。核对行（reconcile）本来就没有 `cny`，不变。`readSpendRows` / `spentFromRows` 一行没改（旧数据照常读，求和不取整）。

**测试**（`tests/seedance.test.ts`"D2：…"）：镜头片中 5 秒 → 报价计费 6 秒（断言 billable 为 6），分别跑 `creates: ["ok"]` 和 `["crash"]`（结果不明行），读回来 `rows[0].cny === 0.9`，文件里没有 `0.8999`。修之前失败：`actual: 0.8999999999999999, expected: 0.9`。

## D3 单镜头草图总表留白

**改了什么**：`scripts/py/sketch.py` 的 `build_sheet`：`cols = min(COLS, len(shots))`，宽 = `cols × 640`，贴图位置也按 `cols` 算；文件开头的说明同步改了。

**测试**（`tests/py/test_sketch.py`）：新增 1 镜 → `(640, 360)`、2 镜 → `(1280, 360)`；原有的 3 镜 `(1920, 360)`、4 镜 `(1920, 720)` 照旧。修之前 2 个新测试失败（得到 1920 宽）。

## D4–D8 Skill（`.claude/skills/film-director/`）

| 项 | 改了哪里 | 改了什么 |
|---|---|---|
| D4 | `SKILL.md`"硬性禁止" | 新加一条：不用 `sed -i`、不用 `>` 重定向覆盖、不用 Edit/Write 改已经存在的产物文件，改动一律另存为新版本；例外只有 `state.json` 和 `requirements.md`（只追加）。 |
| D5 | `stages/4-keyframes.md` 第 1 步、`stages/5-prompts.md` 第 1 步、`seven-part-prompt.md` 填写说明 | 尾帧对应的是**生成秒数**的最后一刻，不是片中时长的最后一刻；【逐秒】（计划里的"中间发生什么"）的时间轴覆盖整个生成秒数，片中时长之后多出来的那段写成"静止，后期剪掉"；"片中时间"和"生成秒数"两个数都要带上（带例子：片中 5 秒、生成 6 秒）。七段式模板正文（方法论原文）没改。 |
| D6 | `stages/3-style.md` 第二部分第 4 步 | 必须看图写：用 Read 打开每张设定图（最新一版），逐项看图写（毛色或衣服、花纹位置、眼睛颜色、配饰），不凭印象、不照抄提示词；写完再和设定图对一遍，对不上的照图再追加一条更正（requirements.md 只追加）。 |
| D7 | `SKILL.md`"每一步怎么做" | 每出一张图（样帧、设定图、首尾帧、草图）、每下载一段片段、每出一版成片，都用 `mcp__ccd_host__reveal_path` 打开给本人看；这个工具用不了时给可点击的路径；G3、G3b、G2、G5、G6 提问前先打开附带的文件。 |
| D8 | `SKILL.md`"每一步怎么做"记录 requirements.md 那条 | 本人原话里有换行时，换成 ` / `，保持一条一行，原话其他部分不改。 |

**测试**（`tests/skill.test.ts` 新增 D4–D8 共 5 个测试）：包括 brief 要求的字样（SKILL.md：`sed -i`、`reveal_path`、` / `；4-keyframes.md、5-prompts.md：`生成秒数`；3-style.md：`看图`），另外还按章节断言了具体的句子。原因：`5-prompts.md` 改之前就已经有"生成秒数"，只查这几个字测不出这次的改动。改之前 5 个都失败，改之后都通过。

## 两套测试

```
npm test
ℹ tests 153
ℹ pass 153
ℹ fail 0

.venv/Scripts/python -m unittest discover -s tests/py
Ran 24 tests in 7.975s
OK
```

（Node：修复前 145 个，新增 8 个（exit 2、seedance 1、skill 5），共 153 个。Python：新增 2 个，22 → 24。）

## 资金路径的不变量

没有改闸门、锁、退出码（0/1/2/4/6/7/10）、Key 脱敏；`spend.jsonl` / `fetched.jsonl` 仍然只追加。D2 只改了新写入行里 `cny` 的数值精度。单价是 0.15 和 0.55，乘以整数秒以后本来就是整分，取整只是去掉浮点误差，闸门 6 的计算不受影响。

## 需要留意

- 审核清单（`references/reviews/keyframe-plan.md`、`pre-submit.md`）没有提"生成秒数时间轴 / 静止，后期剪掉"。brief 没要求改，但审核员看到结尾那段静止，可能会当成问题提出来。如果真跑时出现，可以给清单补一句。
- 改用 `process.exitCode` 以后，如果以后有代码留下没清掉的定时器或连接，进程会挂住，不会再被强制退出。`tests/exit.test.ts` 的 10 秒上限会抓到 seedance wait 这条路径上的这类问题，其他 CLI 没有子进程测试。
