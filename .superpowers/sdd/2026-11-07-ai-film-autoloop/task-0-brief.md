### Task 0: 项目骨架与基础库

**Files:**
- Create: `package.json`、`.gitignore`、`config/pricing.json`、`scripts/lib/paths.ts`、`scripts/lib/versioned.ts`、`scripts/lib/hash.ts`
- Test: `tests/lib.test.ts`

**Interfaces:**
- Produces:
  - `projectRoot(): string`（`FILM_ROOT` 优先）
  - `filmDir(film: string): string`；`assertFilmName(film: string): void`（不合法时抛错 `片名不合法：<片名>`）
  - `nextVersionPath(dir: string, base: string, ext: string): string`，返回 `<dir>/<base>-v<n>.<ext>`，n 为已有最大值 +1，从 1 开始
  - `writeNew(path: string, data: string | Uint8Array): void`，用 `flag: "wx"`，已存在就抛错
  - `sha256File(path: string): string`（小写十六进制）

- [ ] **Step 1:** 执行前问本人是否用 git 管理本项目；同意则 `git init` 并在后续每个任务末尾提交，不同意则跳过所有提交步骤。
- [ ] **Step 2: 写失败测试** `tests/lib.test.ts`：
  - `nextVersionPath` 在空目录返回 `plan-v1.md`；已有 `plan-v1.md`、`plan-v3.md` 时返回 `plan-v4.md`。
  - `writeNew` 写已存在的文件抛错，原内容不变。
  - `assertFilmName("雨夜邮差")` 不抛；`assertFilmName("../x")`、`assertFilmName("")` 抛错。
  - `sha256File` 对内容 `abc` 返回 `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`。
- [ ] **Step 3:** 运行 `node --test tests/lib.test.ts`，预期 FAIL（模块不存在）。
- [ ] **Step 4:** 实现上述函数；写 `config/pricing.json`：
  ```json
  { "default": "mini",
    "models": {
      "mini": { "id": "doubao-seedance-2-0-mini-260615", "cnyPerSecond720p": 0.5 },
      "2.5":  { "id": "doubao-seedance-2-5-260628",      "cnyPerSecond720p": 1.5 } } }
  ```
- [ ] **Step 5:** 运行 `node --test tests/lib.test.ts`，预期 PASS。
- [ ] **Step 6:** 提交 `chore: 项目骨架与基础库`。

