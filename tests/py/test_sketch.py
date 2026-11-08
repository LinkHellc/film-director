import tempfile
import unittest
from pathlib import Path

from PIL import Image

from _util import image, run, write_json

BOARD = [
    {"shot": "S01", "bg": "#1d2a3a",
     "blocks": [{"x": 0.62, "y": 0.4, "w": 0.1, "h": 0.5, "color": "#c0392b", "label": "邮差"}]},
    {"shot": "S02", "bg": "#000000", "blocks": [{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2, "color": "#ffffff"}]},
    {"shot": "S03", "bg": "#335533", "blocks": []},
]


class SketchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.board = self.dir / "board.json"
        write_json(self.board, BOARD)

    def tearDown(self):
        self.tmp.cleanup()

    def test_sheet_size_and_guides(self):
        from sketch import GUIDE_COLOR, TILE_W, TILE_H
        out = self.dir / "sheet.png"
        r = run("sketch.py", self.board, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        img = image(out).convert("RGB")
        self.assertEqual(img.size, (1920, 360))
        for col in range(3):
            for frac in (0.38, 0.62):
                x = col * TILE_W + round(frac * TILE_W)
                self.assertEqual(img.getpixel((x, TILE_H // 2)), GUIDE_COLOR, (col, frac))
        # 背景色确实画上了（S03 的一角，避开镜头号）
        self.assertEqual(img.getpixel((2 * TILE_W + 600, 340)), (0x33, 0x55, 0x33))

    def test_two_rows(self):
        out = self.dir / "sheet4.png"
        write_json(self.board, BOARD + [{"shot": "S04", "bg": "#000000", "blocks": []}])
        r = run("sketch.py", self.board, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(image(out).size, (1920, 720))

    def test_single_shot_no_empty_columns(self):
        # D3：只有 1 个镜头时列数取 min(3, 镜头数)，总表 640×360，没有空灰块
        out = self.dir / "sheet1.png"
        write_json(self.board, BOARD[:1])
        r = run("sketch.py", self.board, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(image(out).size, (640, 360))

    def test_two_shots_two_columns(self):
        out = self.dir / "sheet2.png"
        write_json(self.board, BOARD[:2])
        r = run("sketch.py", self.board, out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(image(out).size, (1280, 360))

    def test_refuses_existing_output(self):
        out = self.dir / "sheet.png"
        out.write_bytes(b"keep")
        r = run("sketch.py", self.board, out)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(out.read_bytes(), b"keep")
        self.assertIn("已存在", r.stderr)

    def test_bad_board(self):
        write_json(self.board, {"shot": "S01"})
        r = run("sketch.py", self.board, self.dir / "x.png")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((self.dir / "x.png").exists())


if __name__ == "__main__":
    unittest.main()
