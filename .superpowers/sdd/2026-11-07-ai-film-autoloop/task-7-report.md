# Task 7 报告：Python 图像与后期工具

**状态：** DONE  
**提交：** `0f42f0e feat: 图像与后期工具`（dev 分支，本地提交，未推送；未提交 PDF 和 .venv）

## 环境（Step 1）
- ffmpeg：`winget install --id Gyan.FFmpeg -e` 装上了 9.0.2 full build。第一次在沙箱里装报 `copy_file: Access is denied`，按已获授权关掉沙箱重装后成功。
  安装位置：`%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\`。winget 已改了 PATH 并加了别名，但要新开的 shell 才生效。
- 找 ffmpeg 的顺序（写在 `scripts/py/common.py` 的模块说明里）：环境变量 `FFMPEG`/`FFPROBE` → PATH → 在 WinGet Packages 下按 glob 找 `Gyan.FFmpeg*/*/bin/*.exe`。只设了 `FFMPEG` 时，会先找它旁边的 ffprobe。所以旧 shell 不设任何变量也能用（已验证）。找不到时报一句中文、退出码 1。
- `.venv`：用 `C:/Python314/python -m venv .venv` 建好，`requirements.txt` 只写了 `Pillow`，装上的是 Pillow 13.0.0。

## 文件
- `requirements.txt`
- `scripts/py/common.py`：找 ffmpeg 的逻辑、`Fail`（中文一句话 + 退出码）、`need_new`（输出已存在就拒绝）、`save_image_new`（用 `open(..,'xb')` 独占创建，失败时删掉半成品）、调 ffmpeg 时一律加 `-n`、stdout 统一成 UTF-8。
- `scripts/py/sketch.py`、`grayscale.py`、`frames.py`、`post.py`
- `tests/py/_util.py` + 4 个测试文件。测试只用 stdlib unittest，路径从 `__file__` 推出，在 `C:\` 下运行也能通过。

退出码统一为：0 成功；1 检查没通过（grayscale 对比不够）或 ffmpeg 失败；2 参数或输入有问题、输出已存在（argparse 自己的报错也是 2）。

## 设计说明
- **sketch**：x/y 是色块左上角（文档里写明了），x/y/w/h 都是 0–1 的比例，会做校验。每镜先按 1920×1080 画，标签白字黑描边、居中写在色块里，再画 38%/62% 两条竖线，然后缩到 640×360（LANCZOS）。缩完后用 2px 再画一遍竖线，保证颜色纯（`GUIDE_COLOR=(255,214,0)`）。镜头号放在左上角黑底白字。总表宽固定 1920（3 列），空位填深灰，行数 = ceil(n/3)。字体依次试 msyh.ttc → simhei → Deng → mac/linux 的 CJK 字体，都没有就用 Pillow 自带字体，不报错。
- **grayscale**：用 Pillow 的 "L" 模式（BT.601 luma）。分镜只有 1 镜且图是 16:9 时，整张图就是这一镜；其他情况按 sketch 的总表排法切格子，尺寸对不上就报错。每格缩到 ≤320 宽再算。块内取亮度中位数；块外向外扩块宽高的 25% 作为一圈，去掉其他色块后取中位数（中位数不受标签字和竖线影响）。不给 `--board` 时只转灰度，退出 0。对比不够时照样存灰度图，然后退出 1。
- **frames extract**：先按帧序号算好要取哪些帧，`-ss` 设成 (i−0.25)/fps 放在 `-i` 前精确 seek。测试用 `select=eq(n,35)` 逐像素核对过，取到的确实是第 35 帧。`--around` 取中心帧前后各 n 个相邻帧（按视频帧率），超出视频首尾的截掉，多个点重叠的去重。`--every` 和 `--around` 同时给会报错。文件名是 `t<毫秒7位>ms.png`。输出目录可以已存在，但只要有一个目标文件重名就整批拒绝，一张也不写。
- **crop169**：居中裁切。**compare**：左边是 `Image.blend` 50% 叠加，右边是差值图（autocontrast 拉满方便看）。stdout 先打一行标题，再打 5 行 `第r行第c列 差异 0.xxx`（8×8 网格，按平均差排序）。尾帧尺寸不同时缩放到首帧大小。
- **post concat**：每段的处理链是：输入选项 `-colorspace bt470bg`，然后 `setparams` 标成 BT.601，然后 `fps=第一段帧率`，然后 `scale=1920:1080:flags=lanczos:in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv,unsharp=5:5:0.3`，再 `setparams` 标成 bt709，存成 FFV1 无损 mkv（level 3，yuv420p）。之后用 concat demuxer 拼起来，编码 libx264 crf16 preset slow，`-pix_fmt yuv420p`，加上 bt709 三个标签和 `-color_range tv`、`+faststart`。
  - **和 brief 字面写法的差别**：brief 说"最终放大"，我把 lanczos 放大和矩阵转换放在了逐段生成中间文件这一步。这样不同分辨率、不同帧率的片段也能用 demuxer 无缝拼接；最终这一步只编码。中间文件 1080p FFV1 会比较大，临时目录建在输出文件旁边（`.post-tmp-*`），做完就删。
  - 声音：只要有一段带声音，没声音的段就补等长静音（PCM 中间文件，最终编成 AAC 192k）；全都没声音就不输出音轨。
  - 清单格式：每行一个路径，相对清单所在目录；空行和 `#` 开头的行忽略；也认 `file '...'` 写法。
- **grade**：`eq=saturation=S:brightness=B`，S 限 0–3，B 限 −1–1；**trim**：`-ss`/`-t` 放输入前，重编码，帧级精确。两者都输出 H.264 并标 bt709，按"concat 之后的素材"来设计。

## 测试（TDD）
- RED：先写好测试，跑 `.venv/Scripts/python -m unittest discover -s tests/py` 时，因为脚本还不存在，4 个模块全部 ImportError。
- GREEN：**22 个测试全部 OK**（约 6 秒）。brief 列的检查项都覆盖了：3 镜总表 1920×360，38%/62% 处是竖线色；深红块在深蓝背景上 → 退出 1 并列出 S01/邮差，白块在黑背景上 → 退出 0；3 秒 testsrc 用 `--every 0.5` 得 6 张，`--around 1.5 --n 3` 得 7 张且互不相同；1024² 裁成 1024×576；两段 1 秒 720p（其中一段带声音、文件名有中文和空格）拼成 1920×1080、h264、yuv420p、bt709×3 标签、时长约 2 秒，且中间文件已清理；每个命令在输出已存在时都退出非零，原文件不变。
- 额外测试：颜色保真。用无标签的 BT.601 红色 #c0392b 拼接后按 bt709 解码，误差 ≤4。做过变异验证：故意把矩阵改错，测试会失败（R 偏差 10）。另外有 frames 精确帧核对、grayscale 对整张 16:9 帧的情况、sketch 两行排版和坏 JSON 输入、concat 清单里缺片段、trim 区间写错、grade 拒绝覆盖。
- 手动检查：`FFMPEG`/`FFPROBE` 指向不存在的路径时，报"找不到 ffprobe.exe…"，退出 1，没有建出输出目录。

## 疑虑
1. 放大的位置和 brief 字面写法不同（见上）。如果坚持"中间文件保持原分辨率、最后统一放大"，只要把 UPSCALE 挪到最终那条命令里就行，但这样就要求所有片段分辨率和帧率一致。
2. grade/trim 一律把输出标成 bt709；如果直接拿未处理的 Seedance 原片（BT.601）去 grade/trim，标签会不对。文档里写明了它们用在 concat 之后。
3. `frames extract` 每帧单独调一次 ffmpeg，帧多的长片会慢一点，换来的是帧级精确。
4. grayscale 只做简单的块内/块外比较，色块挨得很紧、块外全被其他块占满时会跳过这个块（不报警）。
5. winget 这次装的是"portable"包，没有管理员级安装；ffmpeg 要进 PATH 需要新开 shell，脚本本身不依赖这一点。
