### Task 6: Codex 画图

**Files:**
- Create: `scripts/codex-image.ts`、`tests/fakes/codex.ts`
- Test: `tests/codex-image.test.ts`

**Interfaces:**
- Consumes: `readState`、`isApproved`、`resolveCommand`、`run`、`nextVersionPath`、`writeNew`
- Produces: `codex-image.ts <片名> --kind style|sheet|first|last --out <相对片子目录的基名> --prompt <提示词文件> [--ref <图>]...`
  - 闸门：G1 未批准 → 任何 `kind` 都拒绝，输出 `故事还没确认，不画图`；G3 未批准 → 只允许 `style`，输出 `画风还没确认，只能画样帧`；G3b 未批准 → 不允许 `first|last`，输出 `设定图还没确认`。被拒退出 1。
  - 提示词文件内容前面自动加上 Global Constraints 里的固定开头（文件里已有就不重复加）。
  - 运行 `resolveCommand("FILM_CODEX_CMD", ["codex"])` + `exec --skip-git-repo-check -s read-only` + 每个 `-i <ref>` + `-`，提示词走 stdin。
  - 从输出里用 `/session id:\s*([0-9a-f-]{8,})/i` 取 session id，在 `<FILM_CODEX_IMAGES>/<id>/` 找本次新出现的图片；取不到 id 时退而找出图目录下启动之后修改过的最新图片。没有图片就退出 3，输出 `Codex 没有出图`；输出里有额度相关字样（`quota`、`rate limit`、`额度`）时退出 5，输出 `Codex 额度用完`。
  - 结果复制到 `nextVersionPath(dir, base, "png")`，打印相对路径和图片宽高。宽高比与 16:9 相差超过 1% 时追加一句 `比例不是 16:9，提交视频前要裁切`。

- [ ] **Step 1:** 手动跑一次真 codex 画一张小图，确认 0.77 版输出里 session id 的格式和出图目录。按实际情况调整正则；把一段脱敏的真实输出存成 `tests/fakes/codex-output.txt` 供假程序使用。
- [ ] **Step 2: 写失败测试**：三种闸门各自拒绝、且不调用 codex（假程序写的日志为空）；正常出图得到 `style/look-v1.png`，再画一次得到 `-v2`；参考图按顺序以 `-i` 传入；假程序输出额度报错时退出 5；1024×1024 的图会打印 `比例不是 16:9`。
- [ ] **Step 3:** `node --test tests/codex-image.test.ts`，预期 FAIL。
- [ ] **Step 4:** 实现。宽高从 PNG 文件头读（IHDR），不引入依赖。
- [ ] **Step 5:** 预期 PASS。
- [ ] **Step 6:** 提交 `feat: Codex 画图与阶段闸门`。

