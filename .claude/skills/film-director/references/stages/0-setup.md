# 阶段 0：开工准备（`stage = "setup"`）

方法论："开工前先做两件事：1. 问我：片长、画幅、总预算、要不要配乐和字幕。2. 检查 Codex、ffmpeg、Python 和〔视频接口的 Key〕能不能用，缺什么告诉我。"（原文写的是火山方舟的 Key；本项目走第三方网关，Key 是 `SEEDANCE_API_KEY`。）

## 做什么

### 1. 检查环境

逐条运行，记下结果。缺什么只告诉本人缺什么、怎么装或怎么设，不自动安装、不自动升级。

| 检查 | 命令 | 正常的样子 |
|---|---|---|
| Node | `node --version` | v24 或更高 |
| Codex | `codex --version` | 打印版本号（把版本号告诉本人）。命令找不到就是没装 |
| Python 和 Pillow | `.venv/Scripts/python -c "import PIL; print(PIL.__version__)"` | 打印 Pillow 版本 |
| ffmpeg 和 ffprobe | `.venv/Scripts/python -c "import sys; sys.path.insert(0, 'scripts/py'); import common, subprocess; [print(subprocess.run([b, '-version'], capture_output=True, text=True).stdout.splitlines()[0]) for b in (common.ffmpeg_bin(), common.ffprobe_bin())]"` | 两行版本号（脚本按环境变量 `FFMPEG`/`FFPROBE`、PATH、winget 安装位置的顺序找） |
| 视频接口的 Key | `node -e "console.log(process.env.SEEDANCE_API_KEY?.trim() ? '有' : '没有')"` | 只输出"有"或"没有"。绝不打印 Key 本身 |
| 视频网关地址 | `node -e "console.log(process.env.SEEDANCE_BASE_URL || '没设，用默认网关 https://newapi.dragon3api.com')"` | 正式拍片应是默认网关；如果是 `127.0.0.1`/`localhost`，那是试跑用的假网关，告诉本人 |

说明：

- Key 显示"没有"：请本人自己把 `SEEDANCE_API_KEY` 设进 Windows 用户环境变量，然后重启 Claude 桌面端（已开的会话读不到新设的环境变量）。不要让本人把 Key 发到对话里。
- Codex 没装或没登录：告诉本人。故事和分镜阶段不画图，可以先往下做；到了画样帧之前必须解决。
- 排查：如果以后画图失败（`codex-image.ts` 退出 3），输出里有 HTTP 400"requires a newer version of Codex"，说明 Codex CLI 版本太旧。把 `codex --version` 的结果告诉本人，请本人升级：`npm install -g @openai/codex@latest`。你不自己装。

### 2. 问 G0

按 `../gates.md` 的 G0 问本人片长、画幅、总预算、配乐和字幕；环境检查结果写在问题前面的说明里。

## 产物

- `state.json` 的 `settings`（由 G0 的回答写入）
- `requirements.md` 追加 G0 的回答

## 完成后 `state` 怎么改

G0 的回答都有了：`settings` 写好，`gates.G0 = "approved"`，`stage = "story"`，打开 `1-story.md`。
