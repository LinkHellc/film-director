# Task 8 report: 导演 Skill

Status: DONE. Commit `be9a612` on `dev`, local only, not pushed. The untracked PDF is not committed.

## Files
- `.claude/skills/film-director/SKILL.md` covers: frontmatter; identity and roles; the 7 rules verbatim plus the 总原则; opening a new film (`--no-emit`); resuming a film (checks `.submit.lock`, shots still `generating`, gates still `asked`); per-step loop (AskUserQuestion, `requirements.md` line format, which `state.json` fields the director may edit); review procedure; waiting for clips; a command table with exit codes; error handling; prohibitions; stage index.
- `references/stages/0-setup.md` … `8-wrap.md` (9 files). Each one says what to do, which methodology prompts apply (quoted verbatim), the artifact names, the commands and reviews to run, and how `state` changes when the stage is done. Gates are referenced through `../gates.md`.
- `references/gates.md` has one section each for G0, G1, G2, G3, G3b, G4 and G5. G4 includes an over-budget variant. G6 has its own section. There are two extra unnumbered sections: 改图 (asking before editing keyframes, as the methodology requires) and 审核卡住 (3 fails in a row). Each section gives the question text, the options, the files to attach and what to do after the answer.
- `references/pitfalls.md` has the 20 rows from the image. Truncated text is marked `〔补：…〕`, and I added a column for how each row is handled in this pipeline. `references/seven-part-prompt.md` has the template verbatim plus fill-in rules.
- `tests/skill.test.ts` has 10 tests. It was run first and failed 8/10, then passed 10/10. Full `npm test`: 117/117 pass.

## Rulings applied
1. The reviewer runs as `subagent_type: "Explore"`. Its prompt is the full text of `.prompt.md`, read with `cat` (not Read, because Read adds line numbers) and pasted verbatim. The path is never passed. The reply is saved as `reviews/<base>-v<n>.reply.md` (the nextRound regex in review.ts does not count `.reply.md`). Then `record` runs.
2. G4 offers `改用 2.5 重新报价` only when the quote is mini and `models["2.5"].firstLastFrame === true`. gates.md includes a node one-liner to check this. With today's config, G4 offers only `批准 Q<n>（¥合计）` and `先不拍`. A test checks that the label with Q3 filled in passes `saidApproves(…,"Q3")` and does not pass for Q31.
3. Python runs as `.venv/Scripts/python scripts/py/…`, and ffmpeg is located through `common.ffmpeg_bin()`. 7-post says `concat` does the 601→709 conversion and the lanczos upscale, and that `grade`/`trim` are only for the concatenated film. Per-clip fixes are done before concat as FFV1 lossless with no scaling or matrix change.
4. 2-board has a table of 片中时长 → billable seconds, matching quote.ts: ≤3.4 s → 4, 3.5–4.4 → 5, … ≤14.4 s → 15 (the mini maximum). `state.shots.seconds` holds 片中时长, and "整段 X 秒" uses the billable value.
5. `submit` exit 7: the director stops, relays everything printed, and does not patch `spend.jsonl`, delete `.submit.lock` or resubmit. The same handling applies to the stale-lock and "提交结果不明" exit-1 cases.
6. Updated per your message: 0-setup keeps `codex --version`. The HTTP 400 "requires a newer version of Codex" case is a troubleshooting note telling the human to upgrade with `npm install -g @openai/codex@latest`. SKILL.md and 3-style say the same.
7. No Skill file contains `SEEDANCE_API_KEY=`, `ARK_API_KEY` or `agent-autoloop`; a test checks every file under the skill. The Key check prints only 有 or 没有.

## Self-review against the code
I re-checked every command line against the source: arguments, flags, the `--shot` requirement per review type, the `--out` rules (`style/<name>`, `shots/S\d{2,3}/first|last`) and every exit code (new-film 0/1/2; review prepare 0/2/3 and record 0/1/2/3; codex-image 0/1/2/3/5; quote 0/2 including the "超预算：" text; approve 0/1/2; submit 0/1/2/4/7; wait 0/1/2/6; poll 0/10/1/2; fetch 0/1/2; Python 0/1/2).

I also ran the setup check commands themselves: the Pillow, ffmpeg/ffprobe, Key and pricing one-liners work.

## Decisions and concerns for the controller
- **Free-text approvals.** If the human types "批准 Q<n>" as free text, that counts as approval. Vague answers ("可以") never count, and G4 is asked again. This is slightly wider than "明确选了".
- **Retrying a failed Seedance task.** Under R1 every submission needs a new quote and G4, so "retry once" means re-quoting the same unchanged files and saying it is a retry in G4. Only the human can confirm whether the failed attempt was charged; the director cannot see billing. The failed row in `spend.jsonl` still counts against the budget and cannot be edited, so the budget looks tighter than it is.
- **`final` review frames.** The frames go into one directory, `out/final-v<n>-frames/`, using two `--around` runs: cut points with n=3, then mid-shot points with n=0 at least 0.2 s from any cut. This avoids filename clashes, because `extract` refuses the whole batch if any frame name already exists.
- **Image-prompt file names.** These are `*-prompt-v<n>.txt` (for example `shots/S01/last-prompt-v1.txt`), so they never match review or submit patterns. A test enforces that reviewed stems such as `first-v`, `plan-v` and `storyboard-v` only appear under their configured directories.
- **G0 aspect ratio.** 9:16 is offered with a warning that sketch, crop169 and concat assume 16:9.
- **Not covered by any tool, left to the director's own code:** motion-blur transitions, per-region colour protection (only Pillow is installed, no numpy), music mixing and beat timing, and subtitles. 7-post describes how to do each but nothing tests them.
- **Not tested in a real session.** The skill text has not been run end to end; that is Task 9's dry run.

## Fix round 1: trial batch must pass G5 before the remaining shots are quoted

The issue: the old text let the remaining shots be quoted and paid for once the director's own frame check said the trial "行得通", before the human had seen any motion. That contradicted rule 6 and the G5 section of gates.md.

The change:
- **6-generate.md**: the old steps 4 (quote the remaining shots) and 5 (G5) are swapped. Step 4 is now "问 G5（每批都问，试拍那批也要问）" and says the trial's success is decided by the human at G5, not by the director's frame check. Step 5 now reads: `试拍的镜头本人在 G5 看过、选了"都可以"后，再给其余镜头报价`, and adds that nothing is quoted or submitted before that answer.
- **5-prompts.md**, step 3 (line 29): after the trial clips come out and the director has checked the frames, the director asks G5 (6-generate step 4). The remaining shots are quoted only after the human picks "都可以". The text also says the director's frame check does not replace G5.
- **gates.md**, G5 section:
  - "什么时候问" now covers every batch, including the 1–2 trial shots, and says nothing is quoted or submitted before "都可以".
  - The question became `这批可以用吗？` and the option `都可以，进后期` became `都可以`, so it also fits a batch that is not the last one.
  - "选完之后" for `都可以`: if shots remain, only now quote the next batch; once all shots are accepted, move to post.

Covering test: a new test in `tests/skill.test.ts`, "trial batch: G5 (human motion check) comes before quoting the remaining shots". It checks:
- in 6-generate.md the "### N. 问 G5" heading comes before "再给其余镜头报价", and the exact step-4 sentence is present;
- in 5-prompts.md "G5" appears before "才给其余镜头报价";
- the G5 section of gates.md mentions 试拍 and no longer has an option ending in "进后期".

Commands and output:
- With the fix stashed (old Skill text): `node --test tests/skill.test.ts` → pass 10, fail 1 (the new test fails).
- With the fix: `node --test tests/skill.test.ts` → pass 11, fail 0.
- `npm test` → tests 118, pass 118, fail 0.

Commit: `fix: 试拍那批先过 G5 再给其余镜头报价`, on `dev`, not pushed.
