import tempfile
import unittest
from pathlib import Path

from _util import ffmpeg, image, make_testsrc, probe, run


def video_stream(info):
    return next(s for s in info["streams"] if s["codec_type"] == "video")


class PostTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        cls.a = cls.dir / "a.mp4"
        cls.b = cls.dir / "b 片段.mp4"  # 带空格和中文
        make_testsrc(cls.a, seconds=1)
        ffmpeg("-f", "lavfi", "-i", "testsrc2=duration=1:size=1280x720:rate=25",
               "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", cls.b)
        cls.list = cls.dir / "list.txt"
        cls.list.write_text(f"# 顺序\na.mp4\n{cls.b.name}\n", encoding="utf-8")
        cls.final = cls.dir / "final.mp4"
        cls.concat = run("post.py", "concat", cls.list, cls.final)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_concat(self):
        self.assertEqual(self.concat.returncode, 0, self.concat.stderr)
        info = probe(self.final)
        v = video_stream(info)
        self.assertEqual((v["width"], v["height"]), (1920, 1080))
        self.assertEqual(v["codec_name"], "h264")
        self.assertEqual(v["pix_fmt"], "yuv420p")
        self.assertEqual(v.get("color_space"), "bt709")
        self.assertEqual(v.get("color_primaries"), "bt709")
        self.assertEqual(v.get("color_transfer"), "bt709")
        self.assertAlmostEqual(float(info["format"]["duration"]), 2.0, delta=0.15)
        self.assertTrue(any(s["codec_type"] == "audio" for s in info["streams"]))
        leftovers = [p for p in self.dir.iterdir() if p.name.startswith(".post-")]
        self.assertEqual(leftovers, [], "中间文件应清理掉")

    def test_concat_keeps_color(self):
        # 无标签的 BT.601 红色素材，拼接放大后按 bt709 解码，颜色应基本不变
        src = self.dir / "red.mp4"
        ffmpeg("-f", "lavfi", "-i", "color=c=0xc0392b:s=1280x720:r=25:d=1",
               "-vf", "scale=out_color_matrix=bt601:out_range=tv,format=yuv420p",
               "-c:v", "libx264", "-qp", "0", src)
        lst = self.dir / "red.txt"
        lst.write_text("red.mp4\n", encoding="utf-8")
        out = self.dir / "red-final.mp4"
        r = run("post.py", "concat", lst, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        png = self.dir / "red-final.png"
        ffmpeg("-i", out, "-frames:v", "1", "-vf", "scale=in_color_matrix=bt709:in_range=tv,format=rgb24", png)
        px = image(png).convert("RGB").getpixel((960, 540))
        for got, want in zip(px, (0xc0, 0x39, 0x2b)):
            self.assertLessEqual(abs(got - want), 4, px)

    def test_concat_refuses_existing(self):
        out = self.dir / "exists.mp4"
        out.write_bytes(b"keep")
        r = run("post.py", "concat", self.list, out)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(out.read_bytes(), b"keep")

    def test_concat_missing_clip(self):
        bad = self.dir / "bad.txt"
        bad.write_text("a.mp4\nnope.mp4\n", encoding="utf-8")
        out = self.dir / "bad.mp4"
        r = run("post.py", "concat", bad, out)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(out.exists())

    def test_grade(self):
        out = self.dir / "graded.mp4"
        r = run("post.py", "grade", self.a, out, "--sat", "1.2", "--bright", "0.05")
        self.assertEqual(r.returncode, 0, r.stderr)
        v = video_stream(probe(out))
        self.assertEqual((v["width"], v["height"]), (1280, 720))
        r = run("post.py", "grade", self.a, out, "--sat", "1.2")
        self.assertNotEqual(r.returncode, 0)

    def test_trim(self):
        self.assertEqual(self.concat.returncode, 0, self.concat.stderr)
        out = self.dir / "trim.mp4"
        r = run("post.py", "trim", self.final, out, "--start", "0.5", "--end", "1.5")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertAlmostEqual(float(probe(out)["format"]["duration"]), 1.0, delta=0.15)
        before = out.read_bytes()
        r = run("post.py", "trim", self.final, out, "--start", "0", "--end", "1")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(out.read_bytes(), before)

    def test_trim_bad_range(self):
        r = run("post.py", "trim", self.a, self.dir / "t2.mp4", "--start", "2", "--end", "1")
        self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
