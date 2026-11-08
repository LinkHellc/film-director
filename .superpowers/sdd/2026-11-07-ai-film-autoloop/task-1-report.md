# Task 1 报告：片子状态与开新片

**Status:** DONE — commit `78189eb feat: 片子状态与开新片`（branch dev，未 push，未提交 PDF）

## 实现
- `scripts/lib/state.ts`：导出 `Stage`、`GateId`、`GateState`、`Shot`、`FilmState` 类型（与 brief 完全一致）；`readState(film)` 读 `films/<片名>/state.json`（经 `filmDir` 校验片名）；`writeState(state)` 先写 `state.json.tmp` 再 `renameSync` 覆盖；`isApproved` 只有 `"approved"` 返回 true，缺失关口为 false。
- `scripts/lib/hub.ts`：`emitEvent(event)` → `POST ${AGENT_AUTOLOOP_URL||http://127.0.0.1:3350}/v1/events`，头 `Authorization: Bearer <AGENT_AUTOLOOP_FILM_KEY>`，body `{id,type,subject,summary}`，summary 再截到 200 字（按码点）。缺密钥抛 `缺少 AGENT_AUTOLOOP_FILM_KEY`；连不上、非 2xx（`中台返回 <status>`）、回复非 JSON 或缺数字 `event` 都抛中文错误，错误信息不含密钥。15 秒超时。另导出辅助 `hubUrl()`、`firstChars(s,n)`。
- `scripts/new-film.ts`：`main(argv)`。参数不足/想法为空 → 用法提示，退出 2；片名不合法 → `片名不合法：<片名>`，退出 2。`mkdir films/`（递归）后对片子目录做**非递归** mkdir，EEXIST 即打印 `片子已存在：…，没有改动任何文件。` 退出 1（原子判断，不会碰已有文件）。随后建 9 个子目录，`writeNew` 写 `brief.md`（想法 + 换行）、`requirements.md`（`# 本人要求\n\n- <想法>\n`），`writeState` 写初始状态（`stage:"setup"`，settings `{seconds:null, aspect:"16:9", budgetCNY:null, music:null, subtitles:false, model:"mini"}`，gates `{}`，shots `{}`，spentCNY 0）。`--no-emit` 时到此退出 0；否则发事件 `{id:"film.new:<片名>", type:"film.new", subject:"film:<片名>", summary:想法前200字}`，成功打印 `已开新片：<路径>，已通知中台（事件 n）。` 退出 0；失败打印 `没有发出事件：<原因>（片子目录已建好：<路径>）。` 退出 1。打印路径统一用 `/`。

## TDD 证据
RED：`node --test tests/state.test.ts tests/new-film.test.ts` → 两个文件均 `ERR_MODULE_NOT_FOUND`（scripts/lib/state.ts 不存在），`fail 2`。

GREEN：同一命令 → `tests 9, pass 9, fail 0`。全量 `npm test` → `tests 16, pass 16, fail 0`。

测试覆盖：writeState/readState 往返 + 原地更新 + 不留 .tmp；isApproved 缺失/asked/rejected 为 false；readState 非法片名抛错；--no-emit 建出全部目录和三个文件且字段正确；目录已存在返回非零、目录内容不变；非法片名/缺参数非零且不建目录；假中台（node:http 随机端口）收到 POST /v1/events、`Bearer k-test-123`、subject `film:测试片`、id/type 正确、250 字想法被截成 200 字，输出含事件号；没设密钥时目录照建、非零、输出 `没有发出事件：缺少 AGENT_AUTOLOOP_FILM_KEY`；中台返回 401 时非零并说明。

CLI 冒烟（临时 FILM_ROOT）：首次退出 0；重复片名退出 1；无密钥退出 1 并打印 `没有发出事件：缺少 AGENT_AUTOLOOP_FILM_KEY（片子目录已建好：…）。`

## 文件
- scripts/lib/state.ts（新）
- scripts/lib/hub.ts（新）
- scripts/new-film.ts（新）
- tests/state.test.ts（新）
- tests/new-film.test.ts（新）

## 自查
- 接口签名与 brief 逐字对照一致；事件 id/type/subject 用原值。
- 已存在判断用非递归 mkdir 的 EEXIST，避免先查后建的竞态。
- 测试保存/恢复 FILM_ROOT、AGENT_AUTOLOOP_URL、AGENT_AUTOLOOP_FILM_KEY 和 console，临时目录 finally 清理。
- 只用可擦除 TS（type/interface/as），ESM 显式 `.ts` 导入。

## 待定/关注
- `requirements.md` 条目格式选了 `- <想法>`（brief 只要求"第一条为想法原文"）；后续追加条目（时间、卡片编号）应沿用 `- ` 列表格式。
- `subtitles` 是 boolean，"其余为空"取 `false`。
- 退出码约定（自定）：用法/片名错 2，已存在或事件没发出 1。brief 只要求"非零"。
- 发事件失败时片子目录已建好且不回滚；重跑同名会被"已存在"拦住，补发事件需要后续手段（如 Task 4 的 hub 命令或手工）。可考虑以后加 `--emit-only`。
- 冒烟测试在 `/tmp/tmp.dUbMr1h2gC` 留了一个临时目录（删除命令被权限拒绝），无害。
