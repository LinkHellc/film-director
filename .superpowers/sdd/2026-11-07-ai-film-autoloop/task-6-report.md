# Task 6 report: Codex 画图

Status: DONE_WITH_CONCERNS
Commit: df3a4b6 `feat: Codex 画图与阶段闸门` (on dev, not pushed; the PDF is left uncommitted)

## Files
- scripts/lib/proc.ts (new). `resolveCommand(envName, fallback)`: the env value must be a non-empty JSON array of strings, otherwise it throws an error that names the variable. On Windows it looks up a bare name on PATH using PATHEXT. A `.cmd`/`.bat` is turned into `[process.execPath, <js entry>, ...]` using `cliFromCmd` (same regex, `CMD_JS_RE`), imported from scripts/bin/claude-official.js and not duplicated. If no JS entry can be found it throws, and never falls back to a shell. `run(cmd, {cwd, stdin, timeoutMs})` spawns with `shell:false`. A failed launch gives code 127 and a timeout kills the process and gives 124; in both cases the reason goes to stderr.
- scripts/codex-image.ts (new). Exports `main`, `PROMPT_PREFIX`, `parseOut`, `pngSize`, `withPrefix`.
- tests/fakes/codex.ts (new). A fake codex 0.77. It logs `{argv, stdin}` to FAKE_CODEX_LOG and writes the banner fixture to stderr, the same way real codex does. It writes a PNG of FAKE_CODEX_SIZE to `<FILM_CODEX_IMAGES>/<session>/exec-<uuid>.png`. FAKE_CODEX_MODE takes ok/quota/noimage/noid, and modes can be combined with commas.
- tests/fakes/codex-output.txt: the real 0.77 banner, redacted. Workdir, model, session id and prompt are replaced with placeholders.
- tests/codex-image.test.ts (13 tests), tests/proc.test.ts (6 tests).

## Behaviour and decisions
- `--out` is unambiguous. It is relative to the film dir, uses `/`, and has no extension or version.
  - `style`/`sheet`: must be `style/<name>`.
  - `first`/`last`: must be `shots/<S\d{2,3}>/<first|last>`, and the base name must equal `--kind` so it matches what seedance.ts looks for (`first-v*.png`/`last-v*.png`).
  - Anything else exits 2. That covers `..`, backslashes, absolute paths, `.png` endings and wrong subfolders, all tested by `parseOut`.
- Gates are checked in order G1, then G3 (only `style` may pass without it), then G3b (blocks first/last). A refusal prints the exact message and exits 1. Codex is never called; the test asserts the log file does not exist.
- `--prompt` and `--ref` are resolved against the cwd. A ref that does not exist exits 2 before codex runs. Refs are passed to codex as absolute paths, in order, as `-i`. Codex runs with cwd set to the film dir.
- The prefix is added only if the file does not already contain it.
- Image lookup: the session id is read from stdout+stderr (real 0.77 prints it on stderr) and the newest `.png` in `<images>/<id>/` is taken. Without an id, it takes the newest `.png` under the images root, searching root plus one level of subfolders, with mtime ≥ start − 1 s. The 1 s allows for timestamp rounding.
- If there is no image: output matching quota/rate limit/额度 exits 5 with `Codex 额度用完`, otherwise it exits 3 with `Codex 没有出图（退出码 N）`. Both also print the last 3 stderr lines so a real failure can be diagnosed. The quota check only runs when there is no image, because the banner echoes the prompt.
- Output: `已出图：style/look-v1.png（1920×1080）`. The path is relative to the film dir, matching review.ts. If the ratio is off by more than 1%, it adds `；比例不是 16:9，提交视频前要裁切`. Width and height are read from the IHDR chunk. The file is created with nextVersionPath + writeNew (mkdir first), so it is never overwritten.
- Exit codes: 0 ok, 1 gate, 2 usage/args, 3 no image, 5 quota.

## Step 1 findings (real codex)
- I ran `codex exec --skip-git-repo-check -s read-only -` twice. The first run used the configured default model gpt-6-astra. The second used `-m gpt-5.6-terra`, the oldest model in the cache. Both returned HTTP 400: "model requires a newer version of Codex". No image was made, and a 400 rejection uses no quota.
- Confirmed: the banner is on stderr and contains `session id: <uuid v7-like hex>`. The existing regex matches it.
- Image folder: the user's existing `~/.codex/generated_images/<session-id>/exec-<uuid>.png` folders (made earlier by a newer Codex) match the session-folder design.
- Checked: `resolveCommand("FILM_CODEX_CMD",["codex"])` resolves the real shim to `node.exe …/@openai/codex/bin/codex.js`, and `--version` runs without a shell.

## Concerns
1. **codex-cli 0.77.0 cannot draw for this account right now.** Every model the account offers asks for a newer CLI. The user needs to upgrade codex (`npm i -g @openai/codex`) before Task 6 works end to end. Until then codex-image exits 3 and prints Codex's own error line. After upgrading, the stdout/image format should be checked again with one real run, because the fixture covers only the banner and not a successful image run.
2. The fallback with no session id could pick up an image from a different Codex session running at the same time. This is the accepted trade-off from the brief.
3. A non-PNG output (e.g. JPEG) is still saved as `.png` and reported as "读不出宽高". Codex currently writes PNG.

## Tests
`node --test "tests/**/*.test.ts"`: 106 pass, 0 fail. RED first: both new test files failed on missing modules, then GREEN.

## Fix 1: quota false positive from the echoed prompt

- Change: new exported `quotaError(output, sentPrompt)` in scripts/codex-image.ts. Before applying QUOTA_RE, it drops every output line that, once trimmed, matches a line of the prompt actually sent on stdin (prefix included; CRLF and LF both handled). `main` keeps the sent prompt in `sent` and uses `quotaError(output, sent)` instead of `QUOTA_RE.test(output)`. I did not limit the check to ERROR lines only, because a real quota message may come without "error" (for example "You've hit your usage limit"). Removing the echoed prompt lines is enough to stop the false positive.
- Covering test: `quota words echoed from the prompt are not a quota error`. A prompt containing quota / rate limit / 额度 / Quota, with CRLF, plus the fake in `noimage` mode → exit 3 `Codex 没有出图`, and no 额度 message. The same prompt plus `noimage,quota` (a real quota error line) → exit 5 `Codex 额度用完`.
- RED: `node --test tests/codex-image.test.ts` gave pass 13, fail 1. GREEN: pass 14, fail 0.
- `npm test`: pass 107, fail 0.
- Commit: a1c95d4 `fix: 额度判断不把回显的提示词算进去`
