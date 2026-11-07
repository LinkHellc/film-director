"""色块草图总表。

用法：python sketch.py <分镜JSON> <输出png>

分镜 JSON：
  [{"shot": "S01", "bg": "#1d2a3a",
    "blocks": [{"x": 0.62, "y": 0.4, "w": 0.1, "h": 0.5, "color": "#c0392b", "label": "邮差"}]}]
x/y/w/h 都是占画面宽/高的比例，(x, y) 是色块左上角；label 可省略，可以是中文。

每镜先按 1920×1080 画：背景色、色块、标签，再在 x=38% 和 x=62% 画黄金分割竖线；
然后缩到 640×360，镜头号写在左上角，每行 3 张拼成总表（宽固定 1920，空位填深灰）。
输出已存在则拒绝（退出码 2），原文件不动。
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont

from common import Fail, main_wrapper, need_input, need_new, save_image_new

FRAME_W, FRAME_H = 1920, 1080
TILE_W, TILE_H = 640, 360
COLS = 3
GUIDES = (0.38, 0.62)
GUIDE_COLOR = (255, 214, 0)
EMPTY_COLOR = (40, 40, 40)
FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/Deng.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]


def load_font(size):
    """找一个能写中文的字体；都没有就退回 Pillow 自带字体（中文可能显示成方块，但不报错）。"""
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def color(value, where):
    try:
        return ImageColor.getrgb(value)
    except (ValueError, AttributeError):
        raise Fail(f"{where} 的颜色写法不对：{value!r}。")


def frac(block, key, where):
    v = block.get(key)
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 1:
        raise Fail(f"{where} 的 {key} 必须是 0 到 1 之间的数。")
    return float(v)


def load_board(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise Fail(f"分镜 JSON 读不出来：{e}。")
    if not isinstance(data, list) or not data:
        raise Fail("分镜 JSON 必须是非空数组，每项是一个镜头。")
    shots = []
    for i, s in enumerate(data):
        if not isinstance(s, dict) or not isinstance(s.get("shot"), str):
            raise Fail(f"第 {i + 1} 个镜头缺少 shot 名。")
        name = s["shot"]
        blocks = s.get("blocks", [])
        if not isinstance(blocks, list):
            raise Fail(f"{name} 的 blocks 必须是数组。")
        parsed = []
        for j, b in enumerate(blocks):
            where = f"{name} 第 {j + 1} 个色块"
            if not isinstance(b, dict):
                raise Fail(f"{where} 必须是对象。")
            parsed.append({
                "x": frac(b, "x", where), "y": frac(b, "y", where),
                "w": frac(b, "w", where), "h": frac(b, "h", where),
                "color": color(b.get("color"), where),
                "label": str(b.get("label") or ""),
            })
        shots.append({"shot": name, "bg": color(s.get("bg", "#000000"), name), "blocks": parsed})
    return shots


def block_box(b, w, h):
    """色块在 w×h 画面里的像素框 (x0, y0, x1, y1)，右下不含，裁在画面内。"""
    x0, y0 = round(b["x"] * w), round(b["y"] * h)
    x1, y1 = round(min(1.0, b["x"] + b["w"]) * w), round(min(1.0, b["y"] + b["h"]) * h)
    return x0, y0, max(x0 + 1, x1), max(y0 + 1, y1)


def draw_guides(img, width):
    d = ImageDraw.Draw(img)
    w, h = img.size
    for g in GUIDES:
        x = round(g * w)
        d.rectangle((x - width // 2, 0, x - width // 2 + width - 1, h), fill=GUIDE_COLOR)


def render_shot(shot, font):
    img = Image.new("RGB", (FRAME_W, FRAME_H), shot["bg"])
    d = ImageDraw.Draw(img)
    for b in shot["blocks"]:
        x0, y0, x1, y1 = block_box(b, FRAME_W, FRAME_H)
        d.rectangle((x0, y0, x1 - 1, y1 - 1), fill=b["color"])
        if b["label"]:
            d.text(((x0 + x1) / 2, (y0 + y1) / 2), b["label"], font=font, fill="white",
                   anchor="mm", stroke_width=4, stroke_fill="black")
    draw_guides(img, 6)
    return img


def build_sheet(shots):
    rows = math.ceil(len(shots) / COLS)
    sheet = Image.new("RGB", (TILE_W * COLS, TILE_H * rows), EMPTY_COLOR)
    label_font, tag_font = load_font(64), load_font(28)
    for i, shot in enumerate(shots):
        tile = render_shot(shot, label_font).resize((TILE_W, TILE_H), Image.LANCZOS)
        draw_guides(tile, 2)  # 缩小后重画一遍，保证竖线清楚、颜色纯
        d = ImageDraw.Draw(tile)
        box = d.textbbox((10, 6), shot["shot"], font=tag_font)
        d.rectangle((box[0] - 6, box[1] - 4, box[2] + 6, box[3] + 4), fill=(0, 0, 0))
        d.text((10, 6), shot["shot"], font=tag_font, fill="white")
        sheet.paste(tile, ((i % COLS) * TILE_W, (i // COLS) * TILE_H))
    return sheet


def main():
    if len(sys.argv) != 3:
        raise Fail("用法：sketch.py <分镜JSON> <输出png>。")
    board_path, out = need_input(sys.argv[1]), sys.argv[2]
    need_new(out)
    shots = load_board(board_path)
    save_image_new(build_sheet(shots), out)
    print(f"已画 {len(shots)} 个镜头的草图总表：{out}")
    return 0


if __name__ == "__main__":
    main_wrapper(main)
