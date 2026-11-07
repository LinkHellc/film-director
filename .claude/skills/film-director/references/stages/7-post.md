# 阶段 7：拼接、转场、调色、放大（`stage = "post"`）

方法论：片子是一段一段生成的，生成完要拼成完整视频，再加转场、调色、放大。全部用代码做。

## 后期要求（方法论原文）

> 用代码做后期：
> 1. 转场：[哪一镜到哪一镜，用什么东西盖屏或带过去]。运动模糊切 8–16 份，半帧快门。
> 2. 调色：按故事分段。只调彩度和亮度，不动色相，强调色受保护，肤色不变。不加颗粒、柔光、暗角。
> 3. Seedance 的 mp4 按 BT.601 解码，中间文件用无损格式，交付标 BT.709。
> 4. 放大：720p 用 lanczos 放大到 1080p，加轻微锐化。不用整段插帧。
> 5. 按小节卡点：拍点只从原曲上测，不要在剪过的文件上测。
>
> 做完抽查切点前后 3 帧。

## 工具分工

- `post.py concat` 已经做了第 3、4 条：每段按 BT.601 解码、lanczos 放大到 1920×1080、轻微锐化、中间文件用 FFV1 无损、输出 H.264 标 BT.709。所以**放大只在 concat 这一步做一次**。
- `post.py grade`、`post.py trim` 只用于**拼接之后**的整片（已经是 BT.709 的 1080p）：整片再统一调一点彩度亮度、剪掉整片的头尾。每过一次都是一次有损编码，能少用就少用。
- 逐段的处理（剪头尾、按首帧把颜色调回来、按故事分段调色、补推镜、停在某一帧、转场）都在**拼接之前**对单个片段做，现写 ffmpeg/Python 代码。
- `.venv` 里只有 Pillow，没有 numpy；需要装别的包先问本人。
- ffmpeg 的位置：`FF=$(.venv/Scripts/python -c "import sys; sys.path.insert(0, 'scripts/py'); import common; print(common.ffmpeg_bin())")`，之后用 `"$FF" -n ...`（`-n`：输出已存在就拒绝，不覆盖）。

## 做什么

### 1. 定剪辑清单 `post/edl-v<n>.md`

每镜一行：用哪个片段（`shots/<镜头>/clip-v<n>.mp4` 或修好的 `post/...`）、从第几秒到第几秒、转场方式、属于故事哪一段（决定调色）、对齐哪个小节。片段有多个版本时，抽帧比较后挑最好的；能用的都可以用上。

### 2. 拼接前的单段处理

规则：输出一律是 FFV1 无损 mkv（`-c:v ffv1 -level 3 -pix_fmt yuv420p`，有声音时 `-c:a pcm_s16le`，没声音时 `-an`）；**不缩放、不做色彩矩阵转换**（保持原片 BT.601 的数值，留给 concat 统一转换）；存到 `post/` 下的新文件，不改原片段。

- 剪头尾（`-ss`/`-to` 放在 `-i` 后面，按帧精确）：
  `"$FF" -n -i films/<片名>/shots/<镜头>/clip-v<n>.mp4 -ss 0.2 -to 4.8 -c:v ffv1 -level 3 -pix_fmt yuv420p -c:a pcm_s16le films/<片名>/post/<镜头>-cut-v<k>.mkv`
- 分段调色：同一条命令加 `-vf eq=saturation=<值>:brightness=<值>`。只调彩度和亮度，不动色相；幅度要小。`eq` 是整幅调整，调完抽帧对比色表里强调色和肤色的色值，变了就改用 Python 逐帧做带遮罩的调整。不加颗粒、柔光、暗角。
- 越到后面越暗越冷（mini 常见）：每段按它自己的首帧把颜色调回来——抽首帧和末段帧，比较亮度和色彩，按时间逐渐补偿。
- 推得不够明显：用 `crop`+`scale` 按时间逐渐裁小再放回原尺寸（保持 16:9）。
- 结尾几帧跳到尾帧的样子：选一张没问题的画面，后面都停在这一张（`tpad=stop_mode=clone` 或把那一帧重复）。
- 转场：按方法论第 1 条，用一个东西盖屏或带过去。盖屏的东西用 Python 逐帧画；每个输出帧把这一帧前半个帧间隔内的 8–16 个子位置叠加平均（运动模糊切 8–16 份、半帧快门），存 PNG 序列后编成 FFV1 mkv。

### 3. 拼接和放大

写清单 `post/concat-v<n>.txt`：按顺序每行一个文件（相对清单所在目录，如 `../shots/S01/clip-v2.mp4`、`S02-cut-v1.mkv`）。

`.venv/Scripts/python scripts/py/post.py concat films/<片名>/post/concat-v<n>.txt films/<片名>/post/joined-v<n>.mp4`

只要有一段带声音，没声音的段会自动补静音。片段自带的声音能不能用要本人在 G5 听过才算；本人说不用，就在下一步换掉音轨。

### 4. 整片处理、配乐、字幕

- 整片再调一点：`.venv/Scripts/python scripts/py/post.py grade films/<片名>/post/joined-v<n>.mp4 films/<片名>/post/graded-v<n>.mp4 --sat 1.05 --bright 0.0`
- 剪整片头尾：`.venv/Scripts/python scripts/py/post.py trim <输入> <输出> --start <秒> --end <秒>`
- 配乐（`settings.music` 不是 null）：拍点只从原曲文件上测（用 BPM 算小节线，第一拍的位置在原曲上找），不要在剪过的文件上测；转折对副歌，关键动作对重拍。混音用 ffmpeg：画面 `-c:v copy`（保持 BT.709 标记），声音 `-c:a aac -b:a 192k`；要保留片段音效就 `amix`，不要就只用音乐。
- 字幕（`settings.subtitles` 为 true）：字幕文字先给本人确认，写 `post/subs-v<n>.srt`；烧进画面要重编码，参数照 `post.py` 的输出（`-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`）。
- 最后一步的输出写成 `out/final-v<n>.mp4`（新编号）。

### 5. 抽查切点前后 3 帧

切点时间 = 前面各段时长之和（用 `frames.py` 抽之前，先按清单算好，或用 ffprobe 读每段时长）。把帧抽进 `out/final-v<n>-frames/`（n 和成片的一样，`final` 审核会读这个目录里的图）：

1. 切点前后各 3 帧：`.venv/Scripts/python scripts/py/frames.py extract films/<片名>/out/final-v<n>.mp4 films/<片名>/out/final-v<n>-frames --around <切点1>,<切点2>,... --n 3`
2. 每镜再取几张：`.venv/Scripts/python scripts/py/frames.py extract films/<片名>/out/final-v<n>.mp4 films/<片名>/out/final-v<n>-frames --around <每镜中间的几个时间点> --n 0`（时间点离切点 0.2 秒以上；有重名帧会整个拒绝、一张不写，换个时间点再来）。
3. 自己用 Read 逐张看切点前后：有没有突跳、颜色跳变、重复动作、道具数量变了。有问题回第 2 步改，出新版本成片和新的帧目录。

### 6. 审核 `final`

`node scripts/review.ts prepare final <片名>`（不带 `--shot`；资料是最新的 `out/final-v<n>.mp4` 和 `out/final-v<n>-frames/` 里的图）。流程见 SKILL.md"审核怎么做"。审核会分"硬伤"和"小问题"列出；硬伤改完出新版本再审。

### 7. 问 G6

按 `../gates.md` 的 G6 问本人，附成片和审核回复；写明我没看过动态、没听过声音。

## 产物

- `post/edl-v<n>.md`：剪辑清单
- `post/<镜头>-cut-v<k>.mkv` 等：拼接前处理过的单段（FFV1 无损）
- `post/concat-v<n>.txt`、`post/joined-v<n>.mp4`：拼接清单和拼接结果
- `out/final-v<n>.mp4`：成片（`final` 审核的资料）
- `out/final-v<n>-frames/`：抽查帧（`final` 审核的资料）

## 完成后 `state` 怎么改

G6 选"验收"：`gates.G6 = "approved"`，`stage = "wrap"`，打开 `8-wrap.md`。
