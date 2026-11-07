"""抽帧、居中裁 16:9、首尾帧对比。

  frames.py extract <视频> <输出目录> [--every 0.5]
  frames.py extract <视频> <输出目录> --around 2.0,5.0 [--n 3]
      --every：从 0 秒起每隔几秒取一帧（默认 0.5）。
      --around：在每个时间点所在的那一帧前后各取 n 帧（相邻帧，按视频帧率），共 2n+1 张；多个点用逗号隔开。
      文件名 t<毫秒7位>ms.png。输出目录可以已存在，但要写的任一文件已存在就整个拒绝、一张也不写。
  frames.py crop169 <输入png> <输出png>
      居中裁成 16:9（宽了裁左右，高了裁上下）。
  frames.py compare <首帧> <尾帧> <输出png>
      左边 50% 叠加图、右边差值图（拉满对比度方便看）；按 8×8 网格打印差异最大的 5 格。
输出已存在则拒绝（退出码 2），原文件不动。ffmpeg 位置见 common.py。
"""
import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

from common import Fail, ffmpeg, ffprobe_json, main_wrapper, need_input, need_new, save_image_new

GRID = 8


def video_info(path):
    info = ffprobe_json(path)
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if v is None:
        raise Fail(f"{Path(path).name} 里没有视频流。")
    num, _, den = (v.get("avg_frame_rate") or v.get("r_frame_rate") or "0/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    duration = float(v.get("duration") or info.get("format", {}).get("duration") or 0)
    if fps <= 0 or duration <= 0:
        raise Fail(f"读不出 {Path(path).name} 的帧率或时长。")
    return fps, duration


def plan_times(fps, duration, every=None, around=None, n=3):
    """返回要取的帧序号（升序、去重）。"""
    last = max(0, int(duration * fps + 1e-6) - 1)  # 最后一帧的序号
    idx = set()
    if around is not None:
        for t in around:
            c = min(last, max(0, round(t * fps)))
            idx.update(i for i in range(c - n, c + n + 1) if 0 <= i <= last)
    else:
        k = 0
        while k * every < duration - 1e-6:
            idx.add(min(last, round(k * every * fps)))
            k += 1
    return sorted(idx)


def cmd_extract(a):
    src = need_input(a.video)
    if a.every is not None and a.around is not None:
        raise Fail("--every 和 --around 只能选一个。")
    around = None
    if a.around is not None:
        try:
            around = [float(x) for x in a.around.split(",") if x.strip()]
        except ValueError:
            raise Fail(f"--around 要写成逗号分隔的秒数，比如 2.0,5.0，收到 {a.around!r}。")
        if not around or a.n < 0:
            raise Fail("--around 至少给一个时间点，--n 不能是负数。")
    every = a.every if a.every is not None else 0.5
    if every <= 0:
        raise Fail("--every 必须大于 0。")
    fps, duration = video_info(src)
    frames = plan_times(fps, duration, every, around, a.n)
    out_dir = Path(a.out_dir)
    targets = [(i, out_dir / f"t{round(i / fps * 1000):07d}ms.png") for i in frames]
    clash = [p for _, p in targets if p.exists()]
    if clash:
        raise Fail(f"输出已存在，不覆盖：{clash[0]}（共 {len(clash)} 张重名）。")
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, path in targets:
        # 往前让 0.25 帧再 seek：ffmpeg 取第一个时间戳 ≥ ss 的帧，正好是第 i 帧
        ss = max(0.0, (i - 0.25) / fps)
        ffmpeg(["-ss", f"{ss:.6f}", "-i", src, "-frames:v", "1", "-update", "1", path], f"抽第 {i} 帧")
    print(f"已抽 {len(targets)} 帧到 {out_dir}")
    return 0


def crop_box_169(w, h):
    if w * 9 > h * 16:
        cw = round(h * 16 / 9)
        left = (w - cw) // 2
        return left, 0, left + cw, h
    ch = round(w * 9 / 16)
    top = (h - ch) // 2
    return 0, top, w, top + ch


def open_rgb(path):
    try:
        with Image.open(need_input(path)) as im:
            return im.convert("RGB")
    except OSError:
        raise Fail(f"读不出图片：{path}。")


def cmd_crop169(a):
    need_new(a.output)
    img = open_rgb(a.input)
    out = img.crop(crop_box_169(*img.size))
    save_image_new(out, a.output)
    print(f"已裁成 {out.width}×{out.height}：{a.output}")
    return 0


def top_cells(diff_gray, k=5):
    """8×8 网格里平均差异（0–1）最大的 k 格：[(行, 列, 差异)]，行列从 1 起。"""
    w, h = diff_gray.size
    cells = []
    for r in range(GRID):
        for c in range(GRID):
            box = (c * w // GRID, r * h // GRID, (c + 1) * w // GRID, (r + 1) * h // GRID)
            cell = diff_gray.crop(box)
            hist = cell.histogram()
            total = sum(hist) or 1
            cells.append((r + 1, c + 1, sum(v * n for v, n in enumerate(hist)) / total / 255))
    cells.sort(key=lambda x: (-x[2], x[0], x[1]))
    return cells[:k]


def cmd_compare(a):
    need_new(a.output)
    first, last = open_rgb(a.first), open_rgb(a.last)
    if last.size != first.size:
        last = last.resize(first.size, Image.LANCZOS)
    overlay = Image.blend(first, last, 0.5)
    diff = ImageChops.difference(first, last)
    cells = top_cells(diff.convert("L"))
    sheet = Image.new("RGB", (first.width * 2, first.height))
    sheet.paste(overlay, (0, 0))
    sheet.paste(ImageOps.autocontrast(diff), (first.width, 0))
    save_image_new(sheet, a.output)
    print(f"差异最大的 5 格（8×8 网格，0–1）已画到 {a.output}：")
    for r, c, v in cells:
        print(f"第{r}行第{c}列 差异 {v:.3f}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="抽帧、裁 16:9、首尾帧对比")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("video")
    e.add_argument("out_dir")
    e.add_argument("--every", type=float)
    e.add_argument("--around")
    e.add_argument("--n", type=int, default=3)
    c = sub.add_parser("crop169")
    c.add_argument("input")
    c.add_argument("output")
    m = sub.add_parser("compare")
    m.add_argument("first")
    m.add_argument("last")
    m.add_argument("output")
    a = ap.parse_args()
    return {"extract": cmd_extract, "crop169": cmd_crop169, "compare": cmd_compare}[a.cmd](a)


if __name__ == "__main__":
    main_wrapper(main)
