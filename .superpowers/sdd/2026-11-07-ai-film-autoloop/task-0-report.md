# Task 0 Report: 项目骨架与基础库

**Status:** DONE
**Commit:** `6b7dc93 chore: 项目骨架与基础库` (branch `dev`, local only, not pushed; untracked PDF not committed)

## What was built
- `package.json`: `"type": "module"`, `private`, `engines.node >=24`, no deps; `"test": "node --test \"tests/**/*.test.ts\""` (verified working via `npm test` on Node v24.12.0).
- `config/pricing.json`: verbatim from brief (default `mini`; `mini` = `doubao-seedance-2-0-mini-260615` @ 0.5; `2.5` = `doubao-seedance-2-5-260628` @ 1.5).
- `scripts/lib/paths.ts`
  - `projectRoot()`: `FILM_ROOT` (resolved to absolute) if set and non-empty; otherwise repo root derived from `import.meta.url` (`scripts/lib/../..`), independent of cwd.
  - `assertFilmName(film)`: regex `^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,40}$` (from plan global constraints); throws `Error("片名不合法：<片名>")`.
  - `filmDir(film)`: validates, returns `join(projectRoot(), "films", film)`.
- `scripts/lib/versioned.ts`
  - `nextVersionPath(dir, base, ext)`: scans `dir` for `^<base>-v(\d+)\.<ext>$` (base/ext regex-escaped), returns `join(dir, "<base>-v<max+1>.<ext>")`; missing dir treated as empty (v1); other readdir errors rethrown.
  - `writeNew(path, data)`: `writeFileSync(..., { flag: "wx" })`, throws EEXIST if present.
- `scripts/lib/hash.ts`: `sha256File(path)` -> lowercase hex.
- `.gitignore` left unchanged (already present).

## TDD evidence
RED — `node --test tests/lib.test.ts` before implementation:
```
code: 'ERR_MODULE_NOT_FOUND',
url: 'file:///E:/05_AI/04_Claude%E7%9F%AD%E7%89%87%E6%B5%81/scripts/lib/paths.ts'
ℹ tests 1  ℹ pass 0  ℹ fail 1
```
(An intermediate run also failed with `ERR_INVALID_TYPESCRIPT_SYNTAX` because a bash heredoc collapsed `\\` in versioned.ts; rewritten with the file-write tool, then:)

GREEN — `node --test tests/lib.test.ts` and `npm test`:
```
✔ nextVersionPath 空目录返回 v1
✔ nextVersionPath 已有 v1、v3 时返回 v4，忽略其他文件
✔ writeNew 写已存在文件时抛错且原内容不变
✔ assertFilmName 合法与不合法
✔ projectRoot 优先用 FILM_ROOT，filmDir 位于 films/<片名>
✔ 未设 FILM_ROOT 时 projectRoot 为仓库根（与 cwd 无关）
✔ sha256File 对 abc 返回小写十六进制
ℹ tests 7  ℹ pass 7  ℹ fail 0
```
Also checked manually: importing paths.ts from `/tmp` cwd prints `E:\05_AI\04_Claude短片流`.

## Tests (tests/lib.test.ts)
All brief cases, plus: exact error message check, nextVersionPath ignoring other ext/base, FILM_ROOT override + filmDir layout + filmDir rejecting bad names, default root without FILM_ROOT. All filesystem tests use `mkdtempSync` temp dirs and clean up; env var restored in `finally`.

## Self-review
- Only erasable TS syntax; ESM `.ts` imports; no main in libs; zero deps.
- Paths returned are platform-native (`path.join` -> backslashes on Windows). The brief writes `<dir>/<base>-v<n>.<ext>`; semantically equal. Tests compare via `basename`/`resolve`.
- `assertFilmName` regex rejects `.`, `/`, `\`, spaces, empty, >40 chars, so `filmDir` cannot escape `films/`.

## Concerns
- Minor: returned paths use OS separators (backslash on Windows), not literal `/`. Later tasks printing relative paths (e.g. `reviews/...md`) may want to normalize to `/` for display.
- `\u4e00-\u9fa5` excludes some CJK chars (e.g. extension blocks, full-width punctuation) — per spec, intentional.
