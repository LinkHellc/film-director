# 阶段 4：出每个镜头的首尾帧（`stage = "keyframes"`）

方法论：首尾帧就是这个镜头的第一张画面和最后一张画面，这是降低抽卡率最关键的一步。只靠文字生成视频，模型很容易出逻辑错误；雨、帽子、纹身这些只写在文字里根本不行，经常拍着拍着就没了，所以这些小物件必须在首帧和尾帧都画上。

画图的共同做法（一次一张、提示词先写文件、额度用完就停）见 `3-style.md`。

## 画的顺序（方法论原文）

> - 不要一上来就开画，让AI把每个镜头的首帧画什么、尾帧画什么、中间发生什么都写出来，让审核agent审核过了再画，这样能省很多 Codex 额度。
> - 先画内容最多的那张，一般就是尾帧，然后在尾帧上改出首帧，这样可以保证两张图的摄影机位置和构图是一样的。
> - 画同一个地点、同一个机位的镜头，直接在前一张图上改，不需要重新画，codex支持图片的局部改动。
> - 如果镜头的运动设定是要慢慢推近，那尾帧可以直接把首帧裁一块然后放大。因为如果首帧和尾帧的构图完全一样，那这个镜头就等于不动，再生成视频的时候就没有慢慢推进的效果。
> - Codex 出的图不一定正好是 16:9，提交给 Seedance 之前要检查一遍，有问题要提前让ai裁好，首帧和尾帧的尺寸也要保持一样。

## 每个镜头做什么

一镜一镜做；每镜做完（`keyframes` 审核通过）再做下一镜。

### 1. 写首尾帧计划 `shots/<镜头>/plan-v<n>.md`

写三段：首帧画什么、尾帧画什么、中间发生什么。按下面 8 项检查去写（动作要用的东西首帧就有、旁人的反应提前摆好……），写清左右、人数、道具数量、每个人的姿势和朝向。

审核：`node scripts/review.ts prepare keyframe-plan <片名> --shot <镜头>`（资料是这份计划和 `board/storyboard-v<n>.md`），流程见 SKILL.md"审核怎么做"。不通过就改出 `plan-v<n+1>.md` 再审；通过了才画图。

### 2. 画内容最多的那张（一般是尾帧）

- 写 `shots/<镜头>/last-prompt-v<n>.txt`。
- `node scripts/codex-image.ts <片名> --kind last --out shots/<镜头>/last --prompt films/<片名>/shots/<镜头>/last-prompt-v<n>.txt --ref films/<片名>/style/sheet-<角色>-v<n>.png --ref films/<片名>/style/look-v<n>.png`
  （画面里有几个角色就带几张设定图；和前一镜同一地点同一机位时，改用前一镜的图做 `--ref`，提示词写"在这张图上改"。）
- 出图存成 `shots/<镜头>/last-v<n>.png`。

### 3. 在它上面改出另一张（一般是首帧）

- 写 `shots/<镜头>/first-prompt-v<n>.txt`：写明"在这张图上改：摄影机位置、构图、背景、光线完全不变，只改……"。
- `node scripts/codex-image.ts <片名> --kind first --out shots/<镜头>/first --prompt films/<片名>/shots/<镜头>/first-prompt-v<n>.txt --ref films/<片名>/shots/<镜头>/last-v<n>.png`
- 推近镜头：先画内容最多的首帧（远景），尾帧不画，用代码从首帧裁一块放大（`s` 是保留的比例，如 0.8；`l`、`t` 是裁切框左上角的像素位置，默认 `(W-w)//2,(H-h)//2` 即居中裁切；推向画面某一侧时，把它改成那一侧，例如推向右下角的人物写 `l,t=W-w,H-h`，推向左边写 `l=0`，`l` 取 0 到 `W-w`、`t` 取 0 到 `H-h` 之间；`'xb'` 保证不覆盖已有文件）：
  `.venv/Scripts/python -c "from PIL import Image; im=Image.open('films/<片名>/shots/<镜头>/first-v<n>.png').convert('RGB'); W,H=im.size; s=0.8; w,h=round(W*s),round(H*s); l,t=(W-w)//2,(H-h)//2; im.crop((l,t,l+w,t+h)).resize((W,H),Image.LANCZOS).save(open('films/<片名>/shots/<镜头>/last-v<m>.png','xb'),'PNG')"`

### 4. 裁成 16:9、尺寸一致

- 输出里有"比例不是 16:9"：`.venv/Scripts/python scripts/py/frames.py crop169 films/<片名>/shots/<镜头>/last-v<n>.png films/<片名>/shots/<镜头>/last-v<n+1>.png`（首帧同理）。只裁不重画。
- 先裁尾帧再用裁好的尾帧改首帧，两张一般就一样大。确认尺寸：
  `.venv/Scripts/python -c "from PIL import Image; print(Image.open('films/<片名>/shots/<镜头>/first-v<n>.png').size, Image.open('films/<片名>/shots/<镜头>/last-v<n>.png').size)"`
  不一样就把其中一张用 LANCZOS 缩放到另一张的尺寸，存新版本。
- 提交和审核都只认每种文件编号最大的那一版，所以裁好、修好的版本一定要是最新编号。

### 5. 局部改动要贴回原图

方法论：Codex 就算只改一小块，也会把整张图重新处理一遍。所以只改一小块时，要把改好的那一块贴回原图。

改完先裁成和原图一样的尺寸，再把改动的那一块贴回原图，存成新版本（`box` 是改动区域的像素框）：

`.venv/Scripts/python -c "from PIL import Image; a=Image.open('<原图>').convert('RGB'); b=Image.open('<改过的图>').convert('RGB').resize(a.size, Image.LANCZOS); box=(<左>,<上>,<右>,<下>); a.paste(b.crop(box), box[:2]); a.save(open('<新版本路径>','xb'),'PNG')"`

贴完用 `frames.py compare` 对比原图和新图，确认只有那一块变了。

### 6. 按 8 项逐张自检

方法论原文（材料：首帧、尾帧、设定图、这个镜头的分镜）：

> 1. 动作要用到的东西，首帧里必须有。比如后面要拿杯子，首帧里就要看得到杯子，否则杯子会凭空冒出来。
> 2. 别人的反应要提前摆好。一段视频就是一个镜头，没法中途切过去拍别人，所以首帧里要安排好：一个人在前面做事，另一个人在后面，脸朝着镜头。
> 3. 很多人一起出现时，不能摆同一个姿势，不然模型会让所有人同时动。
> 4. 给动作留出空间。东西要落到、飘到的地方要提前空出来，人的头顶也要留点空。
> 5. 风往哪边吹要统一，不能围巾往左飘，床单却往右飘。
> 6. 缩小到手机大小看一遍，远处的人太小、看不清就要改。
> 7. 放大看有没有多余的东西，比如多一个水壶，或者多一条奇怪的细线。
> 8. 把首帧和尾帧叠在一起看有没有错位。不该变的地方两张图必须一样。比如墙的颜色不一样，视频里墙就会慢慢变色；杯子大了一点，视频里杯子就会慢慢变大。

辅助：

- 第 8 项：`.venv/Scripts/python scripts/py/frames.py compare films/<片名>/shots/<镜头>/first-v<n>.png films/<片名>/shots/<镜头>/last-v<n>.png films/<片名>/shots/<镜头>/compare-v<k>.png`，打开对比图看；打印出的差异最大的 5 格应该都在"本来就该变"的地方。
- 第 6 项：缩到手机大小再看：`.venv/Scripts/python -c "from PIL import Image; im=Image.open('films/<片名>/shots/<镜头>/first-v<n>.png'); im.resize((360, round(360*im.height/im.width)), Image.LANCZOS).save(open('films/<片名>/shots/<镜头>/phone-v<k>.png','xb'),'PNG')"`
- 第 7 项：用 Read 打开原图，逐块看。

### 7. 审核 `keyframes`

`node scripts/review.ts prepare keyframes <片名> --shot <镜头>`（资料是最新的首帧、尾帧、全部设定图和计划）。

- 自检或审核发现要改图：按 `../gates.md`"改图"一节先问本人，本人同意了再改；改完存新版本，重新自检、重新审核。
- 通过：这一镜 `state.shots.<镜头>.status = "keyframes"`，做下一镜。

## 产物（每个镜头）

- `shots/<镜头>/plan-v<n>.md`：首尾帧计划（`keyframe-plan`、`keyframes` 审核的资料）
- `shots/<镜头>/first-prompt-v<n>.txt`、`shots/<镜头>/last-prompt-v<n>.txt`：画图提示词
- `shots/<镜头>/first-v<n>.png`、`shots/<镜头>/last-v<n>.png`：首帧、尾帧（编号最大的一版是正式版）
- `shots/<镜头>/compare-v<k>.png`、`shots/<镜头>/phone-v<k>.png`：自检图

## 完成后 `state` 怎么改

全部镜头的 `status` 都是 `"keyframes"`：`stage = "prompts"`，打开 `5-prompts.md`。
