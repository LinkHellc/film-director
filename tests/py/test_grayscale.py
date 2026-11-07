import tempfile
import unittest
from pathlib import Path

from PIL import Image

from _util import image, run, write_json


def board(bg, color):
    return [{"shot": "S01", "bg": bg,
             "blocks": [{"x": 0.62, "y": 0.4, "w": 0.1, "h": 0.5, "color": color, "label": "邮差"}]}]


class GrayscaleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def sketch(self, data, name):
        b = self.dir / f"{name}.json"
        write_json(b, data)
        png = self.dir / f"{name}.png"
        r = run("sketch.py", b, png)
        self.assertEqual(r.returncode, 0, r.stderr)
        return b, png

    def test_dark_red_on_dark_blue_fails(self):
        b, png = self.sketch(board("#1d2a3a", "#8b0000"), "low")
        out = self.dir / "low-gray.png"
        r = run("grayscale.py", png, out, "--board", b)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("S01", r.stdout)
        self.assertIn("邮差", r.stdout)
        self.assertEqual(image(out).mode, "L")

    def test_white_on_black_passes(self):
        b, png = self.sketch(board("#000000", "#ffffff"), "high")
        r = run("grayscale.py", png, self.dir / "high-gray.png", "--board", b)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_full_frame_image(self):
        # 单镜 16:9 整图（不是总表）也按比例取块
        img = Image.new("RGB", (1920, 1080), "#000000")
        img.paste((255, 255, 255), (int(0.62 * 1920), int(0.4 * 1080), int(0.72 * 1920), int(0.9 * 1080)))
        src = self.dir / "frame.png"
        img.save(src)
        b = self.dir / "b.json"
        write_json(b, board("#000000", "#ffffff"))
        r = run("grayscale.py", src, self.dir / "g.png", "--board", b, "--min-contrast", "0.25")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_without_board_just_converts(self):
        src = self.dir / "a.png"
        Image.new("RGB", (64, 36), "#c0392b").save(src)
        out = self.dir / "a-gray.png"
        r = run("grayscale.py", src, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(image(out).mode, "L")

    def test_refuses_existing_output(self):
        src = self.dir / "a.png"
        Image.new("RGB", (64, 36)).save(src)
        out = self.dir / "a-gray.png"
        out.write_bytes(b"keep")
        r = run("grayscale.py", src, out)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(out.read_bytes(), b"keep")


if __name__ == "__main__":
    unittest.main()
