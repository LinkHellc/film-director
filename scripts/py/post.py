"""后期：拼接放大、调彩度亮度、剪头尾。

  post.py concat <清单txt> <输出mp4>
      清单每行一个视频路径（相对清单所在目录），空行和 # 开头的行忽略，也认 ffmpeg 的 file '...' 写法。
      1) 每段：输入按 BT.601 解释（-colorspace bt470bg + setparams），
         scale=1920:1080:flags=lanczos（BT.601→BT.709 矩阵）+ unsharp=5:5:0.3，帧率统一成第一段的，
         存成 FFV1 无损 mkv 中间文件（在输出旁的 .post-tmp-* 临时目录里，做完就删）。
         只要有一段带声音，没声音的段补等长静音；全都没声音就不要音轨。
      2) 按清单顺序拼接，输出 H.264（yuv420p，crf 16）+ AAC，标 bt709（colorspace/primaries/trc）。
  post.py grade <输入> <输出> [--sat 1.0] [--bright 0.0]
      只调彩度和亮度（eq=saturation=..:brightness=..），不动色相；输出 H.264 标 bt709。
  post.py trim <输入> <输出> --start 秒 --end 秒
      重编码精确剪到 [start, end)；输出 H.264 标 bt709。
grade/trim 预期用在 concat 之后（已是 BT.709）的素材上。
输出已存在则拒绝（退出码 2），原文件不动；ffmpeg 出错退出码 1。ffmpeg 位置见 common.py。
"""
import argparse
import shutil
import tempfile
from pathlib import Path

from common import Fail, ffmpeg, ffprobe_json, main_wrapper, need_input, need_new

UPSCALE = ("scale=1920:1080:flags=lanczos:in_color_matrix=bt601:out_color_matrix=bt709"
           ":in_range=tv:out_range=tv,unsharp=5:5:0.3")
BT601_IN = "setparams=colorspace=bt470bg:color_primaries=bt470bg:color_trc=smpte170m:range=tv"
BT709_TAG = "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv"
H264_OUT = ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-movflags", "+faststart"]
AAC_OUT = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]


def streams(path):
    info = ffprobe_json(path)
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if v is None:
        raise Fail(f"{Path(path).name} 里没有视频流。")
    has_audio = any(s.get("codec_type") == "audio" for s in info["streams"])
    duration = float(v.get("duration") or info.get("format", {}).get("duration") or 0)
    if duration <= 0:
        raise Fail(f"读不出 {Path(path).name} 的时长。")
    return v, has_audio, duration


def read_list(list_path):
    base = list_path.parent
    clips = []
    for raw in list_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("file "):
            line = line[5:].strip().strip("'\"")
        p = Path(line)
        clips.append(need_input(p if p.is_absolute() else base / p))
    if not clips:
        raise Fail(f"清单里没有视频：{list_path}。")
    return clips


def concat_escape(path):
    return "file '" + str(path).replace("\\", "/").replace("'", "'\\''") + "'"


def cmd_concat(a):
    lst = need_input(a.list)
    out = need_new(a.output)
    clips = read_list(lst)
    probed = [streams(c) for c in clips]
    any_audio = any(has for _, has, _ in probed)
    fps = probed[0][0].get("avg_frame_rate") or probed[0][0].get("r_frame_rate")
    if not fps or fps.startswith("0/"):
        fps = "24"
    tmp = Path(tempfile.mkdtemp(prefix=".post-tmp-", dir=out.parent))
    try:
        parts = []
        for i, (clip, (_, has_audio, dur)) in enumerate(zip(clips, probed)):
            mid = tmp / f"part{i:03d}.mkv"
            args = ["-colorspace", "bt470bg", "-i", clip]
            if any_audio and not has_audio:
                args += ["-f", "lavfi", "-t", f"{dur:.6f}", "-i", "anullsrc=r=48000:cl=stereo"]
            args += ["-map", "0:v:0"]
            if any_audio:
                args += ["-map", "0:a:0" if has_audio else "1:a:0", "-af", "apad",
                         "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"]
            else:
                args += ["-an"]
            args += ["-vf", f"{BT601_IN},fps={fps},{UPSCALE},{BT709_TAG}",
                     "-c:v", "ffv1", "-level", "3", "-pix_fmt", "yuv420p",
                     "-t", f"{dur:.6f}", mid]
            ffmpeg(args, f"处理第 {i + 1} 段 {clip.name} ")
            parts.append(mid)
        listing = tmp / "parts.txt"
        listing.write_text("\n".join(concat_escape(p) for p in parts) + "\n", encoding="utf-8")
        args = ["-f", "concat", "-safe", "0", "-i", listing, "-map", "0:v:0"]
        args += (["-map", "0:a:0", *AAC_OUT] if any_audio else ["-an"])
        try:
            ffmpeg([*args, *H264_OUT, out], "拼接输出")
        except Fail:
            out.unlink(missing_ok=True)  # 调用前已确认不存在，这里删的只会是本次的半成品
            raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"已拼接 {len(clips)} 段并放大到 1920×1080：{out}")
    return 0


def encode_simple(src, out, pre_input, vf, what):
    _, has_audio, _ = streams(src)
    args = [*pre_input, "-i", src, "-map", "0:v:0"]
    args += (["-map", "0:a:0", *AAC_OUT] if has_audio else ["-an"])
    if vf:
        args += ["-vf", vf]
    try:
        ffmpeg([*args, *H264_OUT, out], what)
    except Fail:
        out.unlink(missing_ok=True)
        raise


def cmd_grade(a):
    src = need_input(a.input)
    out = need_new(a.output)
    if not 0 <= a.sat <= 3:
        raise Fail("--sat 要在 0 到 3 之间（1 为不变）。")
    if not -1 <= a.bright <= 1:
        raise Fail("--bright 要在 -1 到 1 之间（0 为不变）。")
    encode_simple(src, out, [], f"eq=saturation={a.sat}:brightness={a.bright},{BT709_TAG}", "调色")
    print(f"已调色（彩度 {a.sat}，亮度 {a.bright}）：{out}")
    return 0


def cmd_trim(a):
    src = need_input(a.input)
    out = need_new(a.output)
    if a.start < 0 or a.end <= a.start:
        raise Fail("--start 不能为负，--end 必须大于 --start。")
    _, _, dur = streams(src)
    if a.start >= dur:
        raise Fail(f"--start {a.start} 已超过视频时长 {dur:.2f} 秒。")
    # -ss 放在 -i 前 + 重编码：ffmpeg 会精确到帧地丢掉 start 前的画面
    encode_simple(src, out, ["-ss", f"{a.start:.6f}", "-t", f"{a.end - a.start:.6f}"], BT709_TAG, "剪辑")
    print(f"已剪出 {a.start}–{a.end} 秒：{out}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="拼接放大、调色、剪辑")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("concat")
    c.add_argument("list")
    c.add_argument("output")
    g = sub.add_parser("grade")
    g.add_argument("input")
    g.add_argument("output")
    g.add_argument("--sat", type=float, default=1.0)
    g.add_argument("--bright", type=float, default=0.0)
    t = sub.add_parser("trim")
    t.add_argument("input")
    t.add_argument("output")
    t.add_argument("--start", type=float, required=True)
    t.add_argument("--end", type=float, required=True)
    a = ap.parse_args()
    return {"concat": cmd_concat, "grade": cmd_grade, "trim": cmd_trim}[a.cmd](a)


if __name__ == "__main__":
    main_wrapper(main)
