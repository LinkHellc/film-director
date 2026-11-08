### Task 2b: 官方 Claude 包装（新增任务，用户决定导演和审核走 Anthropic 官方）

背景：用户的 `~/.claude/settings.json` 把命令行 claude 指向 MiniMax 网关（ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL / ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL）。不能改那个文件。导演（autoloop 启动）和审核（review.ts 启动）都必须改走 Anthropic 官方，用独立的配置目录登录。

**Files:**
- Create: `scripts/bin/claude-official.js`（纯 JS ESM，Node 24，零依赖）
- Create: `scripts/bin/claude-official.cmd`
- Test: `tests/claude-official.test.ts`，假的 claude 入口 `tests/fakes/claude-cli.js`

**Interfaces:**
- `claude-official.js [任意参数...]`：
  1. 环境：`CLAUDE_CONFIG_DIR` = `FILM_CLAUDE_CONFIG_DIR` 或默认 `<USERPROFILE>/.claude-film`（不存在就建目录）；删掉 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`。其余环境原样保留（包括 `ANTHROPIC_API_KEY`，用户可能用 API key）。
  2. 找真正的 claude 入口：`FILM_REAL_CLAUDE`（cli.js 的绝对路径）优先；否则在 PATH 里找 `claude.cmd`，用正则 `/"%(?:dp0%|~dp0)\?([^"\r\n]+\.(?:[cm]?js))"\s+%\*/i` 从 npm 包装里解析出 cli.js（相对 .cmd 所在目录）。找不到就 stderr 写 `找不到 claude：请装 Claude Code 或设置 FILM_REAL_CLAUDE`，退出 127。
  3. 用 `spawn(process.execPath, [cliJs, ...args], { stdio: "inherit", env })` 运行，参数数组原样传递（不经 shell）；子进程退出码原样作为自己的退出码；被信号结束时退出 1。收到 SIGINT/SIGTERM 时转发给子进程。
- `claude-official.cmd` 内容恰好两行：`@echo off` 和 `node "%~dp0\claude-official.js" %*`（必须能被上面的正则匹配到，autoloop 靠它直接用 node 跑 js）。

**Steps (TDD):**
- [ ] 写失败测试：用假 cli（把 argv、`CLAUDE_CONFIG_DIR` 和上述 ANTHROPIC_* 变量是否存在写成 JSON 到 `FAKE_OUT` 文件，然后以 `FAKE_CODE` 退出）：
  - 传入含换行、`&`、`|`、`"`、`%PATH%`、中文的参数，假 cli 收到的 argv 完全一致。
  - 父进程设了全部 7 个 ANTHROPIC_* 变量 → 假 cli 一个都看不到；`ANTHROPIC_API_KEY` 保留。
  - `CLAUDE_CONFIG_DIR` 等于 `FILM_CLAUDE_CONFIG_DIR`，且目录已建。
  - `FAKE_CODE=7` → 包装退出码 7。
  - `FILM_REAL_CLAUDE` 指向不存在的文件且 PATH 里没有 claude.cmd → 退出 127，stderr 含 `找不到 claude`。
  - 正则解析：对内容为 npm 风格 `"%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*` 的临时 .cmd 能解析出正确绝对路径；`claude-official.cmd` 自身的内容也能被该正则匹配并指向 `claude-official.js`。
- [ ] 运行看 FAIL → 实现 → 运行看 PASS（`npm test` 全部通过）。
- [ ] 手动验证（不需要登录）：`node scripts/bin/claude-official.js --version` 能打印 Claude Code 版本号。
- [ ] 提交 `feat: 官方 Claude 包装`。

**Controller additions (binding):**
- 还要设置 `CLAUDE_CODE_GIT_BASH_PATH`（Windows 上 Claude Code 必需；autoloop 启动 Agent 前会去掉继承的 `CLAUDE_CODE_*` 变量）：已有就保留；否则用 `FILM_GIT_BASH`；否则在 PATH 里找 `git.exe`，取其上一级目录下的 `bin\bash.exe`（例如 `E:\AI\tools\Git\cmd\git.exe` → `E:\AI\tools\Git\bin\bash.exe`），存在才设置。加一条测试：父进程没设、给了 `FILM_GIT_BASH` → 假 cli 看到它。
- 新建 `scripts/bin/login-official.ps1`（UTF-8 带 BOM）：内容照抄 `.superpowers/sdd/2026-11-07-ai-film-autoloop/login-official.ps1`，但 git-bash 路径改成与包装脚本相同的查找逻辑，而不是写死。它供本人手动登录用，不需要测试。
