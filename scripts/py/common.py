"""scripts/py 共用：找 ffmpeg/ffprobe、只新建不覆盖、统一报错退出。

找 ffmpeg 的顺序（ffprobe 同理）：
  1. 环境变量 FFMPEG / FFPROBE（完整路径）；只设了 FFMPEG 时，ffprobe 先找它旁边的 ffprobe。
  2. PATH 上的 ffmpeg / ffprobe。
  3. winget 装的 Gyan.FFmpeg：%LOCALAPPDATA%/Microsoft/WinGet/Packages/Gyan.FFmpeg*/*/bin/。
     （winget 装完要开新 shell 才进 PATH，这一步让旧 shell 也能用。）

退出码约定：0 成功；1 检查没通过或 ffmpeg 执行失败；2 参数/输入有问题或输出已存在。
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


class Fail(Exception):
    """带退出码的一句话中文错误。"""

    def __init__(self, msg, code=2):
        super().__init__(msg)
        self.code = code


def main_wrapper(fn):
    """运行 fn()，把 Fail 变成 stderr 一句话 + 退出码。"""
    try:
        code = fn()
    except Fail as e:
        print(str(e), file=sys.stderr)
        code = e.code
    sys.exit(code or 0)


def _winget_bin(name):
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        return None
    hits = sorted(Path(base, "Microsoft", "WinGet", "Packages").glob(f"Gyan.FFmpeg*/*/bin/{name}.exe"))
    return str(hits[-1]) if hits else None


def _find(name, env_key, sibling_of=None):
    if os.environ.get(env_key):
        return os.environ[env_key]
    if sibling_of:
        for cand in (Path(sibling_of).with_name(name + ".exe"), Path(sibling_of).with_name(name)):
            if cand.is_file():
                return str(cand)
    return shutil.which(name) or _winget_bin(name) or name


def ffmpeg_bin():
    return _find("ffmpeg", "FFMPEG")


def ffprobe_bin():
    return _find("ffprobe", "FFPROBE", sibling_of=os.environ.get("FFMPEG"))


def run_tool(args, what):
    """跑 ffmpeg/ffprobe，失败时抛 Fail（退出码 1），返回 stdout 文本。"""
    try:
        p = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except FileNotFoundError:
        raise Fail(f"找不到 {Path(args[0]).name}，请安装 ffmpeg 或用环境变量 FFMPEG/FFPROBE 指定路径。", 1)
    if p.returncode != 0:
        tail = p.stderr.strip().splitlines()[-3:]
        raise Fail(f"{what}失败：{' | '.join(tail)}", 1)
    return p.stdout


def ffmpeg(args, what="ffmpeg 处理"):
    # -n：输出已存在时 ffmpeg 自己也拒绝，和调用前的检查双保险
    return run_tool([ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-nostdin", "-n", *map(str, args)], what)


def ffprobe_json(path):
    import json
    out = run_tool([ffprobe_bin(), "-v", "error", "-print_format", "json",
                    "-show_streams", "-show_format", str(path)], f"读取 {Path(path).name} 的信息")
    return json.loads(out)


def need_input(path):
    p = Path(path)
    if not p.is_file():
        raise Fail(f"输入文件不存在：{p}。")
    return p


def need_new(path):
    """输出路径必须还不存在（只新建、不覆盖），父目录不存在就建。"""
    p = Path(path)
    if p.exists():
        raise Fail(f"输出已存在，不覆盖：{p}。")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def save_image_new(img, path):
    """以独占方式新建并保存图片（文件已存在则失败，写一半出错会删掉半成品）。"""
    p = need_new(path)
    fmt = {".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}.get(p.suffix.lower(), "PNG")
    try:
        f = open(p, "xb")
    except FileExistsError:
        raise Fail(f"输出已存在，不覆盖：{p}。")
    try:
        with f:
            img.save(f, format=fmt)
    except Exception:
        p.unlink(missing_ok=True)
        raise
    return p
