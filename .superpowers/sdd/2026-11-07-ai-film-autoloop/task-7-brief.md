### Task 7: Python 图像与后期工具

**Files:**
- Create: `requirements.txt`（`Pillow`）、`scripts/py/sketch.py`、`grayscale.py`、`frames.py`、`post.py`
- Test: `tests/py/test_sketch.py`、`test_grayscale.py`、`test_frames.py`、`test_post.py`

**Interfaces:**
- Produces（全部只新建文件，输出路径由调用方给，已存在则报错退出）：
  - `sketch.py <分镜JSON> <输出png>`：分镜 JSON 是 `[{ "shot":"S01", "blocks":[{"x":0.62,"y":0.4,"w":0.1,"h":0.5,"color":"#c0392b","label":"邮差"}], "bg":"#1d2a3a" }]`，坐标为画面比例。每镜画 1920×1080：背景色、色块、标签，在 x=38% 和 62% 画竖线；拼成每行 3 张的总表（缩放到每张 640×360，镜头号写在左上角）。
  - `grayscale.py <输入png> <输出png> [--min-contrast 0.25]`：转灰度存图；对 sketch 的每个色块计算块内与周围背景的亮度差（0–1），低于阈值的列出，以退出码 1 表示"明暗对比不够"。分镜 JSON 用 `--board` 传入。
  - `frames.py extract <视频> <输出目录> [--every 0.5] [--around 2.0,5.0 --n 3]`：用 ffmpeg 抽帧；`--around` 在给定时间点前后各取 n 帧。`frames.py crop169 <输入png> <输出png>`：居中裁成 16:9。`frames.py compare <首帧> <尾帧> <输出png>`：50% 叠加图 + 差值图并排，打印差异最大的 5 个区域（按 8×8 网格）。
  - `post.py concat <清单txt> <输出mp4>`：按清单顺序拼接，解码按 BT.601（`-colorspace bt470bg` 输入解释），中间文件用 FFV1 无损 mkv，最终用 `scale=1920:1080:flags=lanczos,unsharp=5:5:0.3` 放大，输出 H.264 并标 `-colorspace bt709 -color_primaries bt709 -color_trc bt709`。`post.py grade <输入> <输出> --sat 1.0 --bright 0.0`：只调彩度和亮度（`eq=saturation=..:brightness=..`），不动色相。`post.py trim <输入> <输出> --start s --end s`。
- 转场（运动模糊切 8–16 份）和卡点因片而异，不做成固定命令，由导演按 `references/stages/7-post.md` 现写 ffmpeg/Python 代码。

- [ ] **Step 1:** 问本人后安装 ffmpeg（`winget install Gyan.FFmpeg`），确认 `ffmpeg -version` 可用；建 `.venv` 并 `.venv/Scripts/python -m pip install -r requirements.txt`。
- [ ] **Step 2: 写失败测试**：sketch 输出总表尺寸 1920×360（3 镜时）且 x=38% 处像素是竖线色；grayscale 对"深红块在深蓝背景上"报出该块、退出码 1，对"白块在黑背景上"退出 0；frames 用 ffmpeg 生成 3 秒测试视频（`testsrc`），`--every 0.5` 得到 6 张，`--around 1.5 --n 3` 得到 7 张；crop169 把 1024×1024 裁成 1024×576；post concat 两段 1 秒 720p 视频得到约 2 秒 1920×1080、`color_space=bt709` 的文件（用 ffprobe 断言）；任何命令输出已存在时退出非零且原文件不变。
- [ ] **Step 3:** `.venv/Scripts/python -m unittest discover -s tests/py`，预期 FAIL。
- [ ] **Step 4:** 实现。
- [ ] **Step 5:** 预期 PASS。
- [ ] **Step 6:** 提交 `feat: 图像与后期工具`。

