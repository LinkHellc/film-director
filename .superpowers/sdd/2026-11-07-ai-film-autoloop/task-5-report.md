# Task 5 报告：Seedance（第三方网关）提交、查询、等待、下载

Status: DONE
Commit: 1dd6496 `feat: Seedance 第三方网关与花钱闸门`（在 dev 上，没有 push；PDF 没有提交）
Tests: `npm test` 82/82 通过（seedance 23 个新测试，approve 加了 2 个，quote 按新单价更新）。RED 已确认：seedance 测试先因为模块不存在而失败，quote 测试先有 6 个失败。

## Step 1 结论（只做了公开的、不需要登录的 GET；没有向网关发过 POST，没有用任何 Key）

网关是 DragonAPI，运行的是 new-api 的定制版本（`/api/status` 显示 version `v1.0.0-rc.48-dragonapi`，docs_link 为 https://docs.dragon3api.com/）。它有专门写给 Seedance 的公开文档，所以首尾帧的写法**已经确认**，不需要走 NEEDS_CONTEXT。

来源：
- [A] https://newapi.dragon3api.com/api/pricing（同目录下的 gateway-pricing.json）
- [B] https://newapi.dragon3api.com/api/status
- [C] https://docs.dragon3api.com/model/video-seedance-mini-generation
- [D] https://docs.dragon3api.com/model/video-seedance-2-5-generation
- [E] https://docs.dragon3api.com/videos
- [F] https://docs.dragon3api.com/tasks
- [G] https://docs.dragon3api.com/video-references（"首帧、首尾帧和自适应比例"一节）
- [H] https://docs.dragon3api.com/errors
- [I] new-api 源码 https://github.com/QuantumNous/new-api ：`service/billing.go`、`service/billing_session.go`、`relaykit/types/error.go`、`relay/relay_task.go`、`controller/relay.go`、`plugins/tasks/doubao/plugin.js`、`router/video-router.go`

| 问题 | 结论 |
|---|---|
| 请求格式 | `POST /v1/videos`，可以用 JSON，也可以用 multipart；这里用 JSON。字段有 `model`、`prompt`、`seconds`（整数）、`resolution: "720p"`、`aspect_ratio` [C][E] |
| 首尾帧 | `task_mode: "first_last_frame"`，加上 `content: [{type:"image_url",role:"first_frame",url:<完整 data URL>},{type:"image_url",role:"last_frame",url:<完整 data URL>}]` [G]。只传一张 `input_reference` 时，网关把它当参考图，不当首帧，所以不能用这个字段 |
| 返回 | `{"id":"task_xxx","status":"queued",...}` [E] |
| 查询 | `GET /v1/videos/{id}`，状态有 queued、in_progress、completed、failed，失败原因在 error 里 [F] |
| 下载 | `GET /v1/videos/{id}/content`，要带同一个 Bearer Key [C][F] |
| 时长 | mini 4–15 秒，2.5 4–30 秒 [C][D][G]。`billableSeconds` 的下限从 2 改成了 **4** |
| 计费 | 输出秒数 × 单价，不足 1 秒按 1 秒算。mini 720p 首尾帧 ¥0.15/秒，2.5 是 ¥0.55/秒 [A][G]。规格不对时返回 400，不建任务、不扣费 [E][G]。每次 POST 都会建一个新任务，幂等键不能防重复；超时又没拿到 id 时"不要直接重发" [G] |
| seedance-2.5 首尾帧 | **不支持**："seedance-2.5、seedance-1.5-pro 不提供首帧模式" [G]，生成方式只有文生视频和参考生成 [D]。所以 `firstLastFrame` 设为 false |
| 欠费 | new-api 会先预扣，预扣失败就不调上游，返回 HTTP **403**，code 是 `insufficient_user_quota` 或 `pre_consume_token_quota_failed` [I]。网关文档里还列出了"402／余额不足" [H]。我把 402、这两个 code，以及正文里出现"余额不足/额度不足/quota is not enough…"的情况都当作欠费处理 |

**没核实、按保守做法处理的：**
- 欠费时具体的中文提示没见到原文，判断主要靠状态码和 code。
- 查询结果里会不会带视频网址：下载一律先走 `/content`。如果 `/content` 被重定向，或者下载失败后改用结果里的网址，这一步**不带 Key**。
- JSON 请求体的大小上限：文档只给了 multipart 的 64 MiB。
- 文档提到"按上限预扣（2.0 系列 15 秒）"，这句写在参考视频那一节，没法确定是不是也适用于没有参考视频的请求。如果适用，余额就得够付 15 秒，否则提交时会返回欠费。

## 实现概要
- `scripts/lib/video-api.ts`：文件开头的注释写了上面的结论和来源。导出 `createTask`、`getTask`、`downloadVideo`、`ArrearsError`、`GatewayError{status, uncertain}`、`MissingKeyError`、`scrub` 和 `isArrears`。带 Key 的请求都设置为 `redirect:"error"`，不跟随重定向；所有网关文字和错误信息打印前都会去掉 Key，包括 `Bearer xxx` 这种形式。`createTask` 多了一个可选参数 `aspectRatio`，取自 `state.settings.aspect`，只有在网关支持的比例列表里才会传。
- `scripts/seedance.ts`：提供 `checkGates`，以及 `submit`、`poll [--json]`、`fetch`、`wait [--interval] [--timeout]` 四个命令。退出码分别是：0 成功，1 闸门没过或出错，2 参数不对，4 欠费，6 超时，10 还有任务在跑。
- `tests/fakes/video-server.ts`：可以在测试里 import，也可以单独运行（`--port --video [--succeed-after] [--create ok|arrears|reject] [--result ok|fail]`），已经手动用 curl 跑通过。它会记录收到的请求，按文档检查首尾帧请求的格式，不对就返回 400，并且能模拟欠费、拒绝、正文里回显 Key、连接断开这几种情况。
- `quote.ts`：下限改成 4，并导出 `readPricing`、`readSpendRows`、`spentFromLog`、`latestReviewPath`、`round1`、`SpendRow`，这样闸门直接复用这些函数，不再写一份。`versioned.ts` 新增了 `latestVersionPath`。
- `approve.ts`：正则改成 `(?<![不别勿没未][^]{0,2})批准 Q<n>(?!\d)`，也就是"批准"前面 3 个字以内出现否定词就不算。新测试覆盖了：不批准、别批准、先不要批准、没批准、还未批准、勿批准、"不，别急着批准"，这些都会被拒；"批准 Q3（¥1.5）"能通过。

## 闸门（顺序就是 brief 里的顺序；比 brief 更严的地方在下面标成"加"）
1. 报价不存在，或 overBudget 不是 false。**加**：报价 JSON 内容不完整时也拒绝，比如 billable 不是 ≥4 的整数、镜头重复。
2. `firstLastFrame` 不是 true。**加**：报价里的 modelId 和价格表对不上（比如旧的 doubao-* 报价），或者报价金额和现在的单价对不上，都要求重新报价。
3. 每一镜最新一次审核的 kind、shot、verdict 必须是 pre-submit / 本镜 / pass。
4. 只比对这一镜**最新的**提示词、首帧、尾帧：路径不在审核记录里（比如新增了 v2），或者哈希变了，就拒绝。**requirements.md 改了不拦**（它是全片的要求，不是这一镜要提交的内容；代码注释里写了这一点，也有测试）。Windows 下路径比较不分大小写。**加**：最新审核记录的哈希和报价里的 reviewHash 不一致（报价之后又审核过）要拒绝；缺文件、提示词为空也要拒绝。
5. `readApproval` 返回 null 或读取报错、`quote` 不是这份报价、`totalCNY` 不是有限数或和报价对不上，都算没批准。
6. 提交时从 spend.jsonl 重新算已花金额（用不四舍五入的数），和按当前单价算出的本次金额相加，跟预算比较。
7. spend.jsonl 里已经有 `quote === Q<n>` 的行。

## submit 的安全细节
- 先检查 Key，再写 `films/<片>/.submit.lock`（只能新建，已经存在就失败），之后才查闸门、发请求；结束后在 finally 里删掉锁。如果已经有锁，就退出 1，一个请求都不发。进程崩溃后锁会留下来，需要手动删掉，这是有意的：出问题时宁可停住。
- 每成功一镜，**先**往 spend.jsonl 追加一行，**再**更新 state（spentCNY 由 spend.jsonl 重算，镜头状态改成 generating）。
- 欠费：打印 `欠费：已提交 n 镜，其余未提交`，退出 4。
- 网关明确拒绝（4xx）：说明这个任务没建，不记账，退出 1，后面的镜头不再提交。
- **结果不明**（断线、超时、5xx、返回 2xx 却没有 id）：按"可能已经扣了钱"处理，记一行 `{..., task:null, uncertain:true, cny}`。这样预算会算上这笔，这份报价也会被闸门 7 挡住，不能再提交。程序提示去网关的任务日志核对，然后退出 1。这一条是 brief 里没有的，是根据文档里"不要直接重发"加的。
- 下载记录写在 `fetched.jsonl`（`downloaded` 或 `failed`）。已经下载或已经失败的任务，poll、wait 不会再查。镜头状态：下载成功是 `generated`，生成失败是 `failed`。`clip` 存的是相对路径，比如 `shots/S01/clip-v1.mp4`。

## 需要注意的地方
1. "不错，批准 Q3"这类话也会被拒（"不"落在 3 个字以内）。这是有意宁可误拒，本人重新说一次就行。
2. 在用 Task 2 的旧单价或旧 2 秒下限生成的报价，现在都会被闸门 1 或 2 拒绝，需要重新报价。
3. 时长上限（mini 15 秒，2.5 30 秒）本地不检查，超出时网关返回 400，不扣钱，但这一批会停在那一镜。
4. 预扣要求的余额可能是按 15 秒算的（见上面"没核实"的最后一条），在 Task 10 用真钱做冒烟测试时值得留意。
5. 闸门检查时读的文件和真正上传时读的文件之间，理论上有一个很小的时间差（文件可能在这中间被改）。导演是一步一步按顺序执行的，这个风险可以接受。
6. 第一次真正提交（Task 10）是第一次真正验证请求格式。文档只说做过"Mini 720p、4 秒单图参考"的实测，首尾帧这个组合是照文档写的。

## 修复第 1 轮（复审提出的 2 个 Important 问题） — commit fcea651

### 1. 任务已经建好、记账却失败时，被当成"没提交"处理
- 改动（`scripts/seedance.ts` 的 submit）：把 createTask 单独放进一个 try，那里的失败只有两种情况：还没花钱，或者花没花钱不确定。拿到任务号以后，再单独写 spend.jsonl：
  - 如果写入失败，打印镜头、任务号、金额（`约 ¥0.75`），以及该补记的那一行 JSON；然后停下这一批，**不删 `.submit.lock`**，**退出 7**（`EXIT_UNRECORDED`），并提示先到网关任务日志核对、把这一行补进 spend.jsonl，再删锁，不要直接重新提交。
  - "结果不明"那个分支在写 uncertain 行时如果也失败，走同样的处理（退出 7、留锁）。
  - 如果只是 state.json 更新失败（`updateShot`），这一镜仍然算提交成功，打印 `警告：S01 已提交并记账，但 state.json 没有更新（…）`，然后继续提交下一镜。账以 spend.jsonl 为准，闸门 6 和 7 都按它计算。
  - 写文件的两个函数改为通过导出的 `io = { appendJsonl, updateShot }` 来调用，这样测试可以把它们换成会失败的版本。
  - 锁被占用时的提示也加上了"先核对网关任务日志和 spend.jsonl"。
- 覆盖的测试：
  - "建好任务后记账失败：打印任务号，保留锁，退出 7；再提交被锁挡住，网关只收到 1 个 POST"：断言退出 7，输出里有 task_fake0001、S01、¥0.75 和"任务日志"；锁还在；第二次 submit 退出 1，提示"另一个提交正在进行"；`creates().length === 1`；输出里没有 Key。
  - "记账成功但 state.json 更新失败：这一镜算提交成功，只给警告，继续下一镜"：退出 0，spend.jsonl 有 2 行，输出里有警告，也有"已提交 S01：task_fake0001"，锁已经删掉。

### 2. 一个查询一直失败的任务会拖住整片的 wait
- 改动：
  - 查询返回 **404/410** 时，直接算这个任务失败，原因写成"网关上找不到这个任务（…HTTP 404…）"。
  - 在一次 wait 里，同一任务**连续 5 次**查询出错（`MAX_QUERY_ERRORS`）也算失败；只要中间查成功一次，计数就清零。
  - 失败的任务由 fetchAll 写进 fetched.jsonl（status 为 failed，带上原因），镜头状态改成 failed，之后不再查询。
  - wait 不再重复查询，直接把这一轮的结果交给 fetchAll。**超时时也先调用 fetchAll**，把已经出好的片段下载下来、把失败的记下，然后才打印"还没出完，稍后再 wait"，退出 6。
  - 退出码约定：wait 只要所有任务都结束了，就**退出 0**，个别镜头生成失败或查不到也是 0（原因已打印并记录）；下载出错退出 1；超时退出 6。
- 假网关新增三个选项：`vanish`（查询一直返回 404）、`queryErrors`（查询一直返回 500）、`stuck`（永远不结束）。
- 覆盖的测试：
  - "wait：一个任务查询 404、一个成功 → 下载成功的、把 404 的记为失败、退出 0"
  - "wait：同一任务连续 5 次查询出错 → 记为失败，不再拖住整片"：断言这个任务恰好被查了 5 次，另一镜的 clip-v1 已经下载
  - "wait 超时时也把已经出好的片段下载下来，再退出 6"

### 运行命令与输出
```
$ node --test tests/seedance.test.ts
ℹ pass 28
ℹ fail 0
$ npm test
ℹ tests 87
ℹ pass 87
ℹ fail 0
```
RED：新测试一开始就失败了，原因是 `does not provide an export named 'io'`，seedance.test.ts 整个文件没能加载。按旧逻辑，404 的任务会一直停在 unknown，wait 要到超时才结束并返回 6，所以三个 wait 测试本来也通不过。
