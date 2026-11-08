# Task 2b 报告：官方 Claude 包装

Status: DONE（有一条小顾虑，见下）
Commit: 89238a8 `feat: 官方 Claude 包装`（dev 分支，本地提交，没有推送；PDF 没有提交）

## 文件
- `scripts/bin/claude-official.js`：ESM，零依赖。导出 `CMD_JS_RE`、`STRIPPED_VARS`、`cliFromCmd`、`findRealClaude`、`findGitBash`、`buildEnv`，用 `import.meta.main` 判断是否作为入口运行（Node 24.12 支持）。
  - env：复制 process.env；删掉 7 个 ANTHROPIC_* 变量，比较时不分大小写；`CLAUDE_CONFIG_DIR` = `FILM_CLAUDE_CONFIG_DIR`，没有就用 `<USERPROFILE 或 homedir>/.claude-film`，用 mkdir -p 建目录；`ANTHROPIC_API_KEY` 和其余变量都保留。
  - `CLAUDE_CODE_GIT_BASH_PATH` 按顺序取：已有值 → `FILM_GIT_BASH`（原样使用，不检查文件是否存在）→ PATH 里 git.exe 的 `..\bin\bash.exe`（文件存在才设置）。
  - 找 claude：`FILM_REAL_CLAUDE` 文件存在就用它；否则在 PATH 里找 `claude.cmd`，用 autoloop 的正则解析出 js，路径相对 .cmd 所在目录，且解析出的 js 必须存在；都找不到就向 stderr 写 `找不到 claude：请装 Claude Code 或设置 FILM_REAL_CLAUDE`，退出码 127。
  - 用 `spawn(process.execPath, [cli, ...args], {stdio:"inherit", env})` 启动，不经过 shell；退出码原样返回；子进程被信号结束时退出 1；SIGINT/SIGTERM 转发给子进程；spawn 报错时退出 1。
- `scripts/bin/claude-official.cmd`：恰好两行（CRLF）：`@echo off`、`node "%~dp0\claude-official.js" %*`。
- `scripts/bin/login-official.ps1`：UTF-8 带 BOM，CRLF。照抄原脚本，只把 git-bash 部分换成同样的查找顺序（已有 → FILM_GIT_BASH → `Get-Command git.exe` 推出 `..\bin\bash.exe`，存在才设置）。
- `tests/claude-official.test.ts`（10 个测试），`tests/fakes/claude-cli.js`（假 cli：把 argv、CLAUDE_CONFIG_DIR、CLAUDE_CODE_GIT_BASH_PATH、ANTHROPIC_API_KEY 和 7 个变量是否存在写进 FAKE_OUT，再以 FAKE_CODE 退出）。

## 测试
- RED：包装模块还不存在时，测试文件导入失败。
- GREEN：`npm test` 共 36 个测试，36 个通过。新加的 10 个覆盖：参数往返（换行、&、|、"、%PATH%、中文、空串、带空格）；去掉 7 个变量且保留 API_KEY；CLAUDE_CONFIG_DIR 已设置且目录已建；FAKE_CODE=7 → 退出 7；FILM_GIT_BASH 生效；已有 CLAUDE_CODE_GIT_BASH_PATH 保留；找不到时退出 127 并给出提示；解析 npm 风格 .cmd 得到绝对路径；claude-official.cmd 恰好两行、能被正则匹配、解析结果是 claude-official.js；通过 PATH 里的 claude.cmd 能找到并运行。
- 手动验证：`node scripts/bin/claude-official.js --version` 和 `cmd /c scripts\bin\claude-official.cmd --version` 都打印 `2.1.92 (Claude Code)`，退出码 0。只跑了 --version，没有登录，也没有读 ~/.claude 和 ~/.claude-film 里的内容。

## 顾虑
- `login-official.ps1` 没有测试（任务书说不需要）。我想用 PowerShell 的 AST 解析器检查一遍语法，但 auto-mode 分类器拒绝了这条命令，所以这个脚本的语法和运行都没验证过，建议本人第一次手动运行时留意。
- 按“照抄”的要求，登录脚本仍然固定使用 `%USERPROFILE%\.claude-film`，不读 `FILM_CLAUDE_CONFIG_DIR`。如果有人设置了这个变量，登录写入的目录和包装脚本读取的目录会不一致。
- 手动跑 `--version` 时用的是默认配置目录，可能已经建出空的 `~/.claude-film` 目录（这本来就是预期的位置）。
- Windows 上信号转发只是尽力而为：Ctrl+C 本来就会传给同一个控制台里的子进程，转发失败会被吞掉。
