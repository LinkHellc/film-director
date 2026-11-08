# 终审修复（一次修完以下全部）

仓库：E:/05_AI/04_Claude短片流，分支 dev。要求：
- 每项都先写失败测试，再修（Skill 类改动可以用 tests/skill.test.ts 的字符串断言）；
- 只在本地提交，不推送；
- 修完运行 `npm test` 和 `.venv/Scripts/python -m unittest discover -s tests/py`，两套测试都要通过。

## C1 审核子 agent 的类型（严重）
**问题**：SKILL.md:70（以及引用它的阶段文件）让导演用 `subagent_type: "Explore"` 派审核。但 Explore 走的是 haiku 别名，而本机用户设置把所有别名都映射成了 MiniMax-M2.7，派出去要么直接失败，要么跑在错误的模型上。另外 Explore 带 Bash，审核本该只读。

**修法**：
1. 新建项目 agent `.claude/agents/film-reviewer.md`。frontmatter 为：
   - `name: film-reviewer`
   - `description`：只读审核员，只按给定清单挑错，不改文件
   - `tools: Read, Glob, Grep`
   - `model: inherit`

   正文写：
   - 你是第一次看这些材料的审核，只读不改；
   - 只读提示词里列出的文件；
   - 不要打开 `reviews/` 和 `state.json`；
   - 图片用 Read 打开放大看；
   - 最后一行只写"通过"或"不通过"。
2. SKILL.md 和所有阶段文件里派审核的地方，一律改成 `subagent_type: "film-reviewer"`，其余流程不变：照旧粘贴 `.prompt.md` 的内容，不是路径。
3. 测试：
   - `.claude/agents/film-reviewer.md` 存在，frontmatter 含上面四项；
   - Skill 全部文本里不再出现 `"Explore"`。

## I1 查询到 404/410 不能直接把已付费任务判死（seedance.ts:446-449，video-api.ts:226-242）
**修法**：
1. 404/410 和其他查询错误一样处理：计入 `MAX_QUERY_ERRORS` 计数，只在同一次 wait 里连续出错达到上限才判失败；单独一次 `fetch` 或 `poll` 永远不因为一次 404 就写进 fetched.jsonl。
2. 网关回复里没有可识别的状态时（例如结果嵌在 `{data:{status}}` 里，或 status 为空），按"查询出错"计数，不按 running 处理。顺便兼容 `data.status`、`data.task_status` 这类嵌套写法：先查 new-api 的源码或文档 https://github.com/QuantumNous/new-api 的视频任务查询返回格式，查到的写进注释。
3. 每条 spend 行增加 `baseUrl` 字段，记录提交时的网关地址。poll、fetch、wait 遇到当前 `SEEDANCE_BASE_URL` 和行里记录的地址不一致时，跳过这一行，并输出 `S01 的任务是在 <地址> 提交的，当前网关地址不同，跳过`。旧行没有 `baseUrl` 的视为默认地址。
4. 测试要覆盖：
   - 单次 fetch 遇到 404 → 不写 fetched.jsonl；
   - wait 里连续 404 达到上限 → 判失败；
   - 嵌套 status 能正确解析；
   - 空 status 计为错误；
   - 地址不一致时跳过且不写 fetched.jsonl。

## I2 "结果不明"的提交没有办法核对（seedance.ts:320-339，README:143）
**修法**：
1. 新增命令 `seedance.ts reconcile <片名> --quote Qn --shot S01 (--task <id> | --not-created) --note "<本人说明>"`。
2. 它只追加，不改旧行：
   - 往 spend.jsonl 追加一行核对记录：`{at, quote, shot, reconcile: "created"|"not-created", task?, note}`；
   - `--task`：之后 poll、fetch、wait 把这个 task 当作该镜头的任务去下载；
   - `--not-created`：统计已花金额时扣掉对应那条 uncertain 行的金额。在花费汇总里实现，不要允许 cny 为负数。
3. 只有对应镜头存在 `uncertain:true`、而且还没核对过的行时才允许执行，否则退出 1。
4. quote.ts 和 seedance.ts 统计已花金额要走同一个函数，并且同时考虑核对记录。
5. README 和 SKILL.md 补上说明：遇到结果不明，导演把原文告诉本人；本人去网关后台查清之后，由本人决定执行 reconcile（导演只能在本人当轮明确给出 task id 或说"没建成"之后才运行）。gate 7 照旧挡住同一份报价的重复提交。
6. 测试：
   - 用 `--task` 核对后，wait 能下载到片子；
   - 用 `--not-created` 核对后，已花金额减少；
   - 没有 uncertain 行时 reconcile 退出 1；
   - 同一镜头不能重复核对。

## I3 approve.ts 会接受自我否定或疑问式的回答（approve.ts:40）
**修法**：
1. 改成只认两种回答：
   - 恰好等于选项原文：`^批准 Q<n>（¥[0-9.]+）$`，允许首尾空白；
   - 以 `批准 Q<n>` 开头（id 后面不能紧跟数字），并且全文不含下面任何字样：不、别、勿、没、未、拒、取消、暂缓、撤、等、再说、？、?、吗。
2. 测试：
   - 下面这些都要拒绝："拒绝批准 Q3"、"取消批准 Q3"、"暂缓批准 Q3"、"先等等再批准 Q3"、"批准 Q3？"、"能批准 Q3 吗"、"不批准 Q3"、"别批准 Q3"、"批准 Q31"；
   - 下面这些要接受："批准 Q3（¥1.5）"、"批准 Q3"、"  批准 Q3（¥0.75）  "。
3. 同步更新 gates.md 和 SKILL.md 里的说明：G4 用编号选项提问时，请本人原样打出 `批准 Q<n>`，只回一个数字不算批准。

## M-fix 推近镜头的裁切示例默认在左上角（4-keyframes.md:37）
改成居中裁切，`l,t=(W-w)//2,(H-h)//2`，并说明需要偏移时怎么改。

## 顺带修（便宜，属于花钱路径）
1. SKILL.md 的"继续做"里补一步：如果 `approvals/Q<n>.json` 已存在、但 spend.jsonl 里没有这份报价的行，先向本人确认"Q<n> 之前批准过、还没提交，现在提交吗"，本人同意后直接运行 `submit`，不要再运行 approve.ts（它会报"已经批准过"）。
2. quote.ts 按模型限制单镜最长秒数（mini 和 2.5 的上限以 video-api.ts 注释里核实过的为准；mini 是 15）。超出时报错 `S01 计费 16 秒，超过 <模型> 单镜上限 15 秒，请拆镜头`，退出 2。
3. quote.ts 拒绝给 `firstLastFrame` 不为 true 的模型报价，报错 `模型 <id> 不支持首尾帧，不能用于本流程`，退出 2。
4. 新增 `.gitattributes`：`* text=auto eol=lf`，`*.cmd text eol=crlf`，`*.ps1 text eol=crlf`，二进制文件按默认处理。把 gates.md 转回 LF。

## 报告
完整报告写到 `.superpowers/sdd/2026-11-07-ai-film-autoloop/final-fix-report.md`，逐项写：改了什么、覆盖它的测试、运行的命令、输出结果。
