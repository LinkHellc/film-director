# Task 9 报告（只做 Step 1 和 Step 3）

状态：完成。Step 2（不花钱的整流程试跑）没有做，留给主控。

## 做了什么
- 新建 `README.md`（168 行，中文），提交 `e100018 docs: 启用说明`，分支 dev，没有 push，没有提交未跟踪的 PDF。
- 各节：系统简介（导演 = 桌面 Code 会话 + 项目 Skill；审核 = 只读子 agent；画师 Codex；动画师 Seedance 经网关）；前置条件（Node 24、Codex 新版 + 两个 npm 全局目录提醒、`.venv` + Pillow、winget ffmpeg + FFMPEG/FFPROBE、`SEEDANCE_API_KEY`/`SEEDANCE_BASE_URL` 用 PowerShell `SetEnvironmentVariable(...,'User')` 设、占位符 `<你的key>`、设完重启桌面端）；模型价格表（同 config/pricing.json）；开新片；"继续做《片名》"；片子目录结构和 state.json；花钱规则（报价 → "批准 Q<n>" → approve.ts → submit 的 7 道闸门、先试拍过 G5、不充值、欠费停、exit 7 后的 `.submit.lock` 处理）；常见问题；测试命令；后台模式（未启用）。
- 流程细节只指向 SKILL.md / gates.md / stages/，没有重复抄。

## 对照过的事实
- 默认网关 `https://newapi.dragon3api.com`：scripts/lib/video-api.ts 的 DEFAULT_BASE。
- 7 道闸门内容：scripts/seedance.ts 的 checkGates 注释。
- 锁和 exit 7 的说法：seedance.ts 和 SKILL.md 出错处理表。
- ffmpeg 查找顺序：scripts/py/common.py。
- claude-official 的配置目录 `~/.claude-film` 与 `FILM_CLAUDE_CONFIG_DIR`：scripts/bin/claude-official.js。
- 测试命令：package.json 与 tests/py。

## 需要留意
- 两个 npm 全局目录的处理里，我写了 `where.exe codex` 定位，再用 `npm install -g --prefix <那个目录> @openai/codex@latest` 重装。这是通用的写法，没有在这台机器上验证过。
- 常见问题"网关欠费"一条写的是"是否充值由你自己决定"。导演从不充值，这一点和规矩一致；但如果本人希望 README 完全不提充值，可以删掉这句。
