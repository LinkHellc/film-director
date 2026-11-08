# 终审修复报告（2026-11-08）

分支 dev，基于 e100018，本地 9 个提交，没有推送；未跟踪的 `视频方法论.pdf` 没有提交。
没有联系真实网关。为了核对查询格式，只用 curl 读了 GitHub 上 new-api 的公开源码（raw.githubusercontent.com）。

## 提交

| 提交 | 内容 |
|---|---|
| 85ee283 | C1 审核改派 film-reviewer |
| 2d6a047 | I3 approve.ts 收紧 |
| 3027718 | 顺带 4：.gitattributes + 行尾转 LF |
| 33ce627 | I3 文档（gates.md G4、SKILL.md、README） |
| 14a9b7e | M-fix 居中裁切 |
| 7be139c | 顺带 2、3：quote.ts 单镜上限 + 首尾帧检查 |
| ad4fa3e | I1 查询出错计数、嵌套状态、按网关地址查询 |
| 626a892 | I2 reconcile + spentFromRows |
| 4fd5db2 | I2 文档 + 顺带 1（继续做时处理"已批准未提交"） |

## C1 审核子 agent 类型
- 新增 `.claude/agents/film-reviewer.md`：frontmatter 是 `name: film-reviewer`、description（只读审核员，只按清单挑错，不改文件）、`tools: Read, Glob, Grep`、`model: inherit`；正文写了只读不改、只读提示词里列出的文件、不打开 `reviews/` 和 `state.json`、图片用 Read 打开放大看、最后一行只写"通过"或"不通过"。
- SKILL.md "审核怎么做"第 2 步改成 `subagent_type: "film-reviewer"`；粘贴 prompt 全文的流程不变。阶段文件只写了"按 SKILL.md 审核怎么做"，本来就没有 `"Explore"`，不用改。
- 测试（tests/skill.test.ts）：`C1: project agent film-reviewer exists…` 检查 frontmatter 四项和正文要点；`C1: the Skill dispatches reviews to film-reviewer, never "Explore"` 检查全部 Skill .md。

## I1 查询 404/410 不再直接判失败
- `scripts/seedance.ts` 的 `pollOnce`：删掉了 404/410 立即判失败的分支。所有查询错误都是 `unknown`；只有 `wait`（带 errCounts）里同一任务连续出错 `MAX_QUERY_ERRORS`（5）次才判失败。单次 `poll`/`fetch` 从不写 fetched.jsonl。
- `scripts/lib/video-api.ts` 的 `getTask`：状态依次从 `status`、`task_status`、`data.status`、`data.task_status` 里取；状态表 `STATUS_MAP` 增加了 pending、generating、canceled。状态为空、UNKNOWN 或不认识时，抛 `GatewayError("查询回复里没有可识别的状态…")`，按查询出错计数，不再当作 running。失败原因和视频网址也会从 `data.fail_reason`、`data.error`、`data.result_url`、`data.url` 里取。
- 注释里写了从 new-api 源码查到的内容（relay/relay_task.go `videoFetchByIDRespBodyBuilder`、model/task.go、dto/task.go、dto/video.go）：
  - `/v1/videos/{id}` 返回 OpenAI 格式，顶层 status。
  - 通用 TaskDto 的格式是 `{code,data:{status:NOT_START|SUBMITTED|QUEUED|IN_PROGRESS|FAILURE|SUCCESS|UNKNOWN}}`。
  - 简化格式是 `data.status`，取值 queued|processing|succeeded|failed。
  - **任务不存在时返回 HTTP 400 `task_not_exist`，不是 404**。所以旧代码对真实网关本来就不会走 404 分支，现在一律按查询出错计数。
- 每条 spend 行增加 `baseUrl`，值是提交时的 `baseUrl()`，结果不明的行也有。`pendingTasks` 发现行里的地址（用 `normBase` 去掉末尾的 /，旧行没有这个字段就按默认地址）和当前地址不同时，就跳过这一行，并在 stderr 输出 `S01 的任务是在 <地址> 提交的，当前网关地址不同，跳过`；同一次 wait 里只说一次。核对为"建成了"的任务，用它对应的那条 uncertain 行的地址。
- 假网关 `tests/fakes/video-server.ts` 增加了 `queryShape: "data"|"empty"` 和 `known`（预置任务）两个选项。
- 测试（tests/seedance.test.ts，"I1："开头的 6 个）：
  - 单次 fetch/poll 遇到 404 不写 fetched.jsonl；
  - wait 里连续 404 恰好 5 次后判失败；
  - 能解析嵌套的 `data.status`，包括成功下载和失败原因；
  - 空 status 算错误：单次查询是 unknown，wait 里 5 次后判失败；
  - 地址不一致时 poll/fetch/wait 都跳过、不发请求、不写 fetched.jsonl，地址改回来后能下载；
  - 旧行没有 baseUrl 时按默认地址处理。
  - 另外，原来的 submit 测试改为断言 spend 行带 baseUrl。

## I2 结果不明可以核对
- 新命令 `seedance.ts reconcile <片名> --quote Qn --shot S01 (--task <id> | --not-created) --note "<说明>"`，往 spend.jsonl 只追加一行 `{at,quote,shot,reconcile,task?,note}`，这一行没有 cny 字段。
  - 退出 1 的情况：这一镜在这份报价里没有 uncertain 行；已经核对过；任务号已经记过；`.submit.lock` 还在；spend.jsonl 有坏行。
  - 退出 2 的情况：用法不对，包括两种选项都给或都不给、note 为空、任务号格式不对。
  - 这个命令不联网、不需要 Key。核对后会更新 state：`--task` 时这一镜的状态改成 generating，同时重算 spentCNY。
- `scripts/quote.ts`：
  - `readSpendRows` 会校验核对行（结论只能是 created 或 not-created；quote、shot、note 必须有；created 必须带 task；cny 要么没有、要么是 0），读进内存时 cny 按 0。
  - 新增 `spentFromRows(rows)`：把提交行加起来，跳过被核对为 not-created 的那条 uncertain 行；核对行本身不算钱，所以结果不会是负数。`spentFromLog` 和 seedance 的闸门 6 都用这一个函数。
- `pendingTasks` 会把核对为 created 的任务也拿来查询和下载。闸门 7 不变，这份报价依然不能再提交。
- 文档：
  - SKILL.md 的命令速查加了 reconcile 一行；"提交结果不明"的处理方式写明：导演把原文告诉本人；本人到网关后台查清后自己决定；只有本人在这一轮明确给出任务号或说"没建成"之后，导演才运行 reconcile。"硬性禁止"里补了一句。"继续做"第 7 步：遇到还没核对的 uncertain 行时按这条处理。
  - README 的常见问题里加了"提交结果不明"的说明和两条命令，并说明 spend.jsonl 会多一行核对记录。
- 测试：
  - seedance 里"I2："开头的 5 个：`--task` 核对后 wait 能下载，只追加一行、旧行不变、已花金额不变、闸门 7 照旧拦；`--not-created` 后已花金额从 0.75 变成 0，quote.ts 和闸门用同一个数；没有 uncertain 行时退出 1；同一镜不能重复核对；参数不对退出 2。
  - quote 里"I2："开头的 2 个：spentFromRows 的算法；核对行的读取和坏行报错。
  - skill 里"I2："开头的 1 个：文档要点。

## I3 approve.ts
- `saidApproves` 只认两种回答：一是 trim 后恰好匹配 `^批准 Q<n>（¥[0-9.]+）$`；二是以 `批准 Q<n>` 开头（后面不能紧跟数字），并且全文不含 不、别、勿、没、未、拒、取消、暂缓、撤、等、再说、？、?、吗。
- 测试（tests/approve.test.ts）：
  - 新增拒绝清单，包括题目要求的 9 条，再加"批准 Q3 吗""批准 Q3?""3""好的，批准 Q3"等；新增接受清单。
  - 原来有 3 个用例和新规则冲突（"好的，批准 Q3，开始生成吧"、"批准 Q31，也批准 Q3。"、"再次批准 Q3"），已按新规则改写。
- gates.md 的 G4 和 SKILL.md 写明：在对话里用编号选项问 G4 时，请本人原样打出 `批准 Q<n>`，只回一个数字不算批准；同时列出了 approve.ts 认哪两种回答。README 的花钱规则 2 也同步了。skill 测试 `I3: G4 docs…` 覆盖这部分。

## M-fix
4-keyframes.md 的推近裁切示例改成 `l,t=(W-w)//2,(H-h)//2`，也就是居中裁切，并说明了需要往某一侧推时怎么改（例如 `l,t=W-w,H-h`，以及取值范围）。实际跑过这个示例：1920×1080、s=0.8 时得到 l,t = 192,108，输出 1920×1080。测试是 `M-fix: push-in crop…`。

## 顺带修
1. SKILL.md "继续做"第 6 步：`approvals/Q<n>.json` 已经存在、spend.jsonl 里没有这份报价时，先问本人"Q<n> 之前批准过、还没提交，现在提交吗"；本人同意后直接 submit，不要再运行 `approve.ts`。测试是 `misc: 继续做…`。
2. `config/pricing.json` 增加 `maxSeconds`（mini 15、2.5 30，与 video-api.ts 注释里核实过的一致）。`buildQuote` 在计费秒数超过上限时报错 `S01 计费 16 秒，超过 seedance-2.0-mini 单镜上限 15 秒，请拆镜头`，退出 2；maxSeconds 缺失或不合法时也拒绝报价。2-board.md 和 SKILL.md 已同步。
3. `buildQuote` 遇到 `firstLastFrame !== true` 的模型会报错 `模型 seedance-2.5 不支持首尾帧，不能用于本流程`，退出 2。原来几个用 2.5 报价的测试改成断言拒绝；闸门 2 的测试改为手动改写一份 2.5 报价和批准，确认闸门 2 自己也拦得住。
4. `.gitattributes`：`* text=auto eol=lf`、`*.cmd text eol=crlf`、`*.ps1 text eol=crlf`，二进制文件靠 text=auto 自动识别。做了 `git add --renormalize .`：gates.md 和 plan 文档转成 LF，cmd、ps1 在仓库里存 LF、检出时是 CRLF。测试是 `.gitattributes normalizes…`。

## 运行的命令和结果
- `npm test`：tests 142，pass 142，fail 0。修复前是 118 个，全部通过。
- `.venv/Scripts/python -m unittest discover -s tests/py`：Ran 22 tests，OK。
- `node scripts/seedance.ts`：打印的用法里有 reconcile。

## 花钱路径的不变量（逐条核对过）
- POST 仍然只在 `checkGates` 返回空之后才发；reconcile 不发任何请求。
- Key 只出现在请求头里；新加的输出（跳过提示、核对结果、状态错误）都经过 scrub，或者根本不含网关原文。
- spend.jsonl 和 fetched.jsonl 只追加；reconcile 只追加一行。
- 结果不明的提交不会自动重发；闸门 7 照旧拦同一份报价。
- `.submit.lock` 的语义没变；reconcile 在锁存在时拒绝执行，不碰锁。

## 需要注意
1. 有一次完整跑 `npm test` 时，两个 queryShape 用例失败（全部 142 个里挂了 2 个）。之后单独跑 3 次、完整跑 10 次都通过，没能复现，也没找到原因，可能是机器负载导致的偶发失败。如果再出现，先看 `tests/seedance.test.ts` 里 "I1：new-api 通用格式" 和 "I1：status 为空" 这两个用例。
2. 不认识的状态现在按出错计数，wait 里连续 5 次就判失败并写进 fetched.jsonl。如果真实网关返回了表外的进行中状态（比如某种新状态），任务会被提前判失败；不过不会重发，本人可以在后台核对。题目就是这样要求的，这里只是说明一下。
3. 本机的 WebFetch 用的小模型被映射到 MiniMax，调用失败，所以改用 curl 读源码；下载整个源码包的请求被权限拒绝，只读了单个文件。
4. 重新标准化行尾会让 cmd、ps1 在仓库里存成 LF，在别的机器上检出时仍然是 CRLF。
