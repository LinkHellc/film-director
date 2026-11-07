import tempfile
import unittest
from pathlib import Path

from PIL import Image

from _util import ffmpeg, image, make_testsrc, run


class FramesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        cls.video = cls.dir / "src.mp4"
        make_testsrc(cls.video, seconds=3)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def pngs(self, d):
        return sorted(Path(d).glob("*.png"))

    def test_every(self):
        out = self.dir / "every"
        r = run("frames.py", "extract", self.video, out, "--every", "0.5")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.pngs(out)), 6)
        self.assertEqual(image(self.pngs(out)[0]).size, (1280, 720))

    def test_around(self):
        out = self.dir / "around"
        r = run("frames.py", "extract", self.video, out, "--around", "1.5", "--n", "3")
        self.assertEqual(r.returncode, 0, r.stderr)
        files = self.pngs(out)
        self.assertEqual(len(files), 7)
        self.assertEqual(len({f.read_bytes() for f in files}), 7, "7 张应各不相同")
        # 1.5 秒 × 25 帧 → 中心第 38 帧，前后各 3 帧 = 第 35..41 帧；核对首张确实是第 35 帧
        ref = self.dir / "ref35.png"
        ffmpeg("-i", self.video, "-vf", r"select=eq(n\,35)", "-frames:v", "1", ref)
        self.assertEqual(files[0].name, "t0001400ms.png")
        self.assertEqual(image(files[0]).tobytes(), image(ref).tobytes())

    def test_extract_refuses_existing_frame(self):
        out = self.dir / "clash"
        r = run("frames.py", "extract", self.video, out, "--every", "1")
        self.assertEqual(r.returncode, 0, r.stderr)
        first = self.pngs(out)[0]
        first.write_bytes(b"keep")
        r = run("frames.py", "extract", self.video, out, "--every", "1")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(first.read_bytes(), b"keep")
        self.assertEqual(len(self.pngs(out)), 3)

    def test_crop169(self):
        src = self.dir / "sq.png"
        Image.new("RGB", (1024, 1024), "#123456").save(src)
        out = self.dir / "sq-169.png"
        r = run("frames.py", "crop169", src, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(image(out).size, (1024, 576))
        r = run("frames.py", "crop169", src, out)
        self.assertNotEqual(r.returncode, 0)

    def test_compare(self):
        a, b = self.dir / "a.png", self.dir / "b.png"
        Image.new("RGB", (800, 800), "#000000").save(a)
        img = Image.new("RGB", (800, 800), "#000000")
        img.paste((255, 255, 255), (700, 0, 800, 100))  # 右上角那格变了
        img.save(b)
        out = self.dir / "cmp.png"
        r = run("frames.py", "compare", a, b, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(image(out).size, (1600, 800))
        lines = [l for l in r.stdout.splitlines() if l.strip()]
        self.assertEqual(len(lines), 6, r.stdout)  # 一行标题 + 5 个区域
        self.assertIn("第1行第8列", lines[1])

    def test_compare_refuses_existing(self):
        a = self.dir / "a2.png"
        Image.new("RGB", (80, 80)).save(a)
        out = self.dir / "cmp2.png"
        out.write_bytes(b"keep")
        r = run("frames.py", "compare", a, a, out)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(out.read_bytes(), b"keep")


if __name__ == "__main__":
    unittest.main()
