"""黑白检查：转灰度存图，并检查每个色块和周围背景的明暗差。

用法：python grayscale.py <输入png> <输出png> [--board 分镜JSON] [--min-contrast 0.25]

不给 --board 时只转灰度。给了 --board（格式见 sketch.py）时，对每个色块取块内亮度中位数、
块外一圈（向外扩块宽高的 25%，不含其他色块）的亮度中位数，差值除以 255 得 0–1，
低于阈值的逐条列出，退出码 1 表示"明暗对比不够"；全部够则退出 0。

色块位置怎么对到图上：
  - 分镜只有 1 个镜头且图是 16:9 → 整张图就是这一镜；
  - 否则按 sketch.py 的总表排法（每行 3 张、每张 16:9）切格子，第 i 个镜头对应第 i 格。
输出已存在则拒绝（退出码 2），原文件不动。
"""
import argparse
import math
import statistics

from PIL import Image

from common import Fail, main_wrapper, need_input, need_new, save_image_new
from sketch import COLS, block_box, load_board


def frames_for(img, shots):
    """返回每个镜头在图上的区域 (left, top, w, h)。"""
    W, H = img.size
    if len(shots) == 1 and abs(W / H - 16 / 9) < 0.02:
        return [(0, 0, W, H)]
    tw = W / COLS
    th = tw * 9 / 16
    rows = math.ceil(len(shots) / COLS)
    if abs(rows * th - H) > 2:
        raise Fail(f"图的尺寸 {W}×{H} 和 {len(shots)} 个镜头的草图总表对不上。")
    return [(round((i % COLS) * tw), round((i // COLS) * th), round(tw), round(th)) for i in range(len(shots))]


def median_in(gray, boxes, exclude):
    """boxes 里所有像素、去掉落在 exclude 框里的，取亮度中位数；没有像素返回 None。"""
    px = gray.load()
    vals = []
    for x0, y0, x1, y1 in boxes:
        for y in range(y0, y1):
            for x in range(x0, x1):
                if not any(e[0] <= x < e[2] and e[1] <= y < e[3] for e in exclude):
                    vals.append(px[x, y])
    return statistics.median(vals) if vals else None


def check(gray, shots, min_contrast):
    """返回 [(镜头, 标签, 对比度)]，只含低于阈值的块。对比度在缩小到每镜宽 ≤320 的图上算，够准也够快。"""
    low = []
    for shot, (L, T, w, h) in zip(shots, frames_for(gray, shots)):
        frame = gray.crop((L, T, L + w, T + h))
        scale = min(1.0, 320 / w)
        fw, fh = max(1, round(w * scale)), max(1, round(h * scale))
        frame = frame.resize((fw, fh), Image.BOX)
        boxes = [block_box(b, fw, fh) for b in shot["blocks"]]
        for i, (b, (x0, y0, x1, y1)) in enumerate(zip(shot["blocks"], boxes)):
            inside = median_in(frame, [(x0, y0, x1, y1)], [])
            mx, my = max(2, round((x1 - x0) * 0.25)), max(2, round((y1 - y0) * 0.25))
            ox0, oy0, ox1, oy1 = max(0, x0 - mx), max(0, y0 - my), min(fw, x1 + mx), min(fh, y1 + my)
            ring = [(ox0, oy0, ox1, y0), (ox0, y1, ox1, oy1), (ox0, y0, x0, y1), (x1, y0, ox1, y1)]
            around = median_in(frame, ring, boxes)
            if around is None:  # 块周围全被别的块占了，无从比较，跳过
                continue
            c = abs(inside - around) / 255
            if c < min_contrast:
                low.append((shot["shot"], b["label"] or f"第{i + 1}块", c))
    return low


def main():
    ap = argparse.ArgumentParser(description="转灰度并检查色块明暗对比")
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--board")
    ap.add_argument("--min-contrast", type=float, default=0.25)
    a = ap.parse_args()
    src = need_input(a.input)
    need_new(a.output)
    if not 0 <= a.min_contrast <= 1:
        raise Fail("--min-contrast 必须在 0 到 1 之间。")
    shots = load_board(need_input(a.board)) if a.board else None
    try:
        gray = Image.open(src).convert("L")
    except OSError:
        raise Fail(f"读不出图片：{src}。")
    low = check(gray, shots, a.min_contrast) if shots else []
    save_image_new(gray, a.output)
    if low:
        print(f"明暗对比不够（阈值 {a.min_contrast:.2f}）：")
        for shot, label, c in low:
            print(f"{shot} {label} 对比度 {c:.3f}")
        return 1
    print(f"已存灰度图 {a.output}" + ("，所有色块明暗对比都够。" if shots else "。"))
    return 0


if __name__ == "__main__":
    main_wrapper(main)
