"""测试共用：定位 scripts/py、跑脚本、用 ffmpeg 造测试视频。路径全部从 __file__ 推出，不依赖 cwd。"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY_DIR = ROOT / "scripts" / "py"
sys.path.insert(0, str(PY_DIR))

import common  # noqa: E402  (scripts/py/common.py)

ENV = dict(os.environ, PYTHONIOENCODING="utf-8")


def run(script, *args):
    """跑 scripts/py/<script>，返回 CompletedProcess（文本按 UTF-8 解码）。"""
    return subprocess.run(
        [sys.executable, str(PY_DIR / script), *map(str, args)],
        capture_output=True, text=True, encoding="utf-8", env=ENV, cwd=str(ROOT),
    )


def ffmpeg(*args):
    subprocess.run([common.ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-y", *map(str, args)],
                   check=True)


def make_testsrc(path, seconds=3, size="1280x720", rate=25):
    ffmpeg("-f", "lavfi", "-i", f"testsrc=duration={seconds}:size={size}:rate={rate}",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", path)


def probe(path):
    out = subprocess.run(
        [common.ffprobe_bin(), "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        check=True, capture_output=True, text=True, encoding="utf-8").stdout
    return json.loads(out)


def write_json(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def image(path):
    """读图并立刻关文件（Windows 上不关会挡住临时目录清理）。"""
    from PIL import Image
    with Image.open(path) as im:
        im.load()
        return im
