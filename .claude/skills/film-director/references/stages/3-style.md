# 阶段 3：定画风，画设定图（`stage = "style"`）

规矩 2：本人确认画风前，不画正式镜头（`codex-image.ts` 在 G3 没批准时只允许 `--kind style`，G3b 没批准时不允许画首尾帧）。

方法论：画风就是这部动画的绘画风格，比如宫崎骏的动画就是手绘、柔和、颜色温暖。有参考图最好。这一步由你写提示词，Codex 负责画，本人负责看是不是想要的风格。画风定下来以后，再给每个角色和固定的道具画一张设定图：一般是这个人的正面、侧面和几个表情，相当于把长相定下来。人物身上固定的东西一定要写清楚位置，比如纹身在左手臂上，不然后面每张图的纹身位置都可能不一样。

## 画图的共同做法

- 一次只画一张，等它出完、自己看过再画下一张；不要同时跑多个 `codex-image.ts`。
- 每张图的提示词先写成文件（新文件，`-prompt-v<n>.txt`），再运行命令；`codex-image.ts` 会自动在开头加上 "Use your image generation tool to create exactly ONE image. Do not run shell commands."，不用自己写。
- 提示词里写清：画风、色值（取自 `board/palette-v<n>.md`）、构图（人的头或眼睛在画面左起 38% 或 62%）、16:9 横幅；不要在画面里写字。
- 出图后用 Read 打开放大看。输出里有"比例不是 16:9"的样帧，用 `frames.py crop169` 裁成新版本，不重画。
- 退出 5（额度用完）→ 告诉本人，停止画图，等本人说继续。退出 3 → 看原因（有"requires a newer version of Codex"就请本人升级 Codex，见 `0-setup.md` 的排查），其他原因重画一次，还不行告诉本人。

## 第一部分：样帧 → G3

1. 先问本人有没有参考图或想要的画风（AskUserQuestion 给 2–3 个画风方向，`requirements.md` 关口编号写 `[画风]`）。本人给了参考图，就用 `--ref` 带上。
2. 选分镜里最有代表性的一镜，用 2–3 种画风各画一张样帧：
   - 写 `style/look-prompt-v<n>.txt`
   - `node scripts/codex-image.ts <片名> --kind style --out style/look --prompt films/<片名>/style/look-prompt-v<n>.txt [--ref <参考图>]`
   - 出图存成 `style/look-v<n>.png`（编号由脚本取）。
3. 自己看过每张，按 `../gates.md` 的 G3 问本人选哪张。

## 第二部分：设定图 → G3b

G3 批准后，给每个角色和每个固定道具各画一张设定图：

1. 写 `style/sheet-<角色>-prompt-v<n>.txt`：用 G3 定下的画风；正面、侧面和几个表情放在同一张图里；衣服、发型、固定道具写死；固定特征写明位置（"纹身在左手臂上""帽檐朝左"）；左右不对称的特征尽量少。
2. `node scripts/codex-image.ts <片名> --kind sheet --out style/sheet-<角色> --prompt films/<片名>/style/sheet-<角色>-prompt-v<n>.txt --ref films/<片名>/style/look-v<n>.png`
   - `<角色>` 用中文或英文名字（如 `sheet-邮差`、`sheet-黄信封`），不要带空格；出图存成 `style/sheet-<角色>-v<n>.png`。`keyframes` 和 `pre-submit` 审核会自动取每个角色最新的一张。
3. 自己逐张放大看：固定特征的位置对不对、正面侧面是不是同一个人。
4. 把每个角色的固定特征（含位置）追加进 `requirements.md`（`[设定] 邮差：……`），后面的提示词【人物】段照抄。必须看图写：用 Read 打开每张设定图（最新一版），逐项看图写（毛色或衣服、花纹位置、眼睛颜色、配饰），不凭印象、不照抄提示词；写完再和设定图对一遍，对不上的照图再追加一条更正（`requirements.md` 只追加，不改旧行）。requirements.md 里同一角色有多条 [设定] 时，以时间最后的一条（含"更正"）为准。
5. 按 `../gates.md` 的 G3b 问本人。

## 产物

- `style/look-prompt-v<n>.txt`、`style/look-v<n>.png`：样帧和提示词
- `style/sheet-<角色>-prompt-v<n>.txt`、`style/sheet-<角色>-v<n>.png`：设定图和提示词（设定图是 `keyframes`、`pre-submit` 审核的资料）

## 完成后 `state` 怎么改

- G3 批准：`gates.G3 = "approved"`（stage 不变，接着画设定图）。
- G3b 批准：`gates.G3b = "approved"`，`stage = "keyframes"`，打开 `4-keyframes.md`。
