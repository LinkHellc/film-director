# SDD ledger — plan: docs/superpowers/plans/2026-11-07-ai-film-autoloop.md
Spec: docs/superpowers/specs/2026-11-07-ai-film-autoloop-design.md
Branch: dev (base main c6b1a98)
User authorized up front: git init + per-task commits (local only, no push); winget ffmpeg; Pillow in .venv; agent-autoloop install incl. init, film source key, ~/.claude/skills junction, rules merge. NOT authorized yet: Feishu config, any real Seedance spend (Task 10).
Methodology text: .superpowers/sdd/2026-11-07-ai-film-autoloop/methodology.txt ; pitfalls table image: pitfalls-table.png

## Preflight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T0 self | creates .gitignore | .gitignore already exists from controller git init (adds .superpowers/, __pycache__/) → Ruling below |
| T0 self | package.json test = `node --test tests/` | Node 24 does not take a bare dir reliably → Ruling below |
| T0→all | paths/versioned/hash | consistent names used in T1–T7 |
| T1→T2,T5,T6 | FilmState, readState/writeState/isApproved | consistent |
| T1→T4 | hub.ts emitEvent then T4 modifies hub.ts | consistent (same file, additive) |
| T2↔T3 | T2 reads latest reviews/pre-submit-<shot>-v*.json (ReviewRecord, defined in T3) but runs before T3 | ordering gap → Ruling below |
| T2→T5 | Quote.shots[].reviewHash, spend.jsonl `cny` | consistent |
| T3→T5 | ReviewRecord.files path→sha256 | consistent |
| T4→T5 | findApproval, getState | consistent |
| T5→T9 | tests/fakes/ark-server.ts used standalone with --port in T9 Step 6 | T5 brief does not require CLI mode → Ruling below |
| T3,T8 | config/reviews.json patterns ↔ stage file names | T8 test checks consistency; ok |
| T6↔T8 | codex exit 5 → later 1h | covered in T8 SKILL text |
| T7↔T8 | grayscale --board board/board.json | consistent |
| T2,T5,T6,T7,T8,T9,T10 self | internally consistent | ok |

Ruling: T0 Step 1 (ask about git) already satisfied — user approved; repo initialized by controller, commits on dev. T0 should MODIFY existing .gitignore keeping its entries — cost if wrong: none.
Ruling: test script = `node --test "tests/**/*.test.ts"` instead of `node --test tests/` — Node 24 glob support; plan's intent (run all tests) preserved — cost if wrong: trivial script edit.
Ruling: T2 implements reading ReviewRecord JSON shape `{kind,film,shot,verdict,at,files}` ahead of T3, tests fabricate such files; T3 must emit exactly this shape — cost if wrong: field-name rework in T2.
Ruling: T5 fake ark server must also run standalone: `node tests/fakes/ark-server.ts --port <n> --video <mp4>` — needed by T9 Step 6 — cost if wrong: small extra code.

## Progress
Task 0: dispatched implementer (sonnet), BASE c6b1a98
Task 0: dispatch failed — model alias sonnet→MiniMax-M2.7 (user ~/.claude/settings.json maps all aliases to MiniMax gateway) → 404 inside desktop app. No changes made.
Ruling: dispatch all subagents with model omitted (inherits session model) — only working option; aliases all map to MiniMax — cost if wrong: higher token spend per subagent.
NOTE for user (system impact): standalone `claude -p` (autoloop director + review.ts) will run on MiniMax-M2.7 via ANTHROPIC_BASE_URL/ANTHROPIC_MODEL in ~/.claude/settings.json, not Claude. Surface at finish.
Task 0: complete (commits c6b1a98..6b7dc93, review clean)
Task 0: minor (deferred): writeNew doesn't mkdir parents; case-sensitive version match on Windows; empty FILM_ROOT falls back silently; paths use OS separators (normalize to / for display)
agent-autoloop installed (~/.agent-autoloop, init --agent claude, desktop channel). try FAILED: claude CLI → MiniMax gateway 402 insufficient balance. Awaiting user decision on director model.
Task 1: complete (commits 6b7dc93..78189eb, review clean)
Task 1: minor (deferred): multi-line idea breaks requirements.md list item; no way to re-emit film.new after failed emit (consider --emit-only); renameSync EPERM retry on Windows; summary truncated twice (harmless). Exit codes: 2 usage/bad name, 1 exists/emit failed.
Ruling: pricing.json resolved relative to repo (script location), not FILM_ROOT — config is code — cost if wrong: path tweak.
Ruling: null budget → quote.ts exit 2 "还没有设总预算" (can't satisfy budget check) — cost if wrong: message change.
Ruling: latest pre-submit review per shot decides; newer fail supersedes older pass — cost if wrong: gate semantics rework in T2/T5.
Task 2: dispatched (BASE 78189eb)
USER DECISION (in chat): 导演和审核走 Anthropic 官方.
Ruling: add Task 2b — scripts/bin/claude-official.{js,cmd} wrapper: isolated CLAUDE_CONFIG_DIR=~/.claude-film, strips MiniMax ANTHROPIC_* vars, runs real cli.js via node with argv array. Used as autoloop agent `program` and as review.ts default (FILM_CLAUDE_CMD default = ["node","<repo>/scripts/bin/claude-official.js"]) — cost if wrong: wrapper rework; user's global settings untouched.
Ruling: skill moves from skills/film-director/ to .claude/skills/film-director/ (project skill, found under any CLAUDE_CONFIG_DIR, cwd=repo); drop ~/.claude/skills junction step in T9; T3 checklists go to .claude/skills/film-director/references/reviews/ — cost if wrong: path moves.
User must log in once: CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-film claude → /login (user does it; credentials not handled by me).
Ruling: billableSeconds minimum 2s (plan test 0.3→2 contradicts rule alone) — provisional; Task 5 must verify Seedance min/allowed durations from Ark docs and adjust floor — cost if wrong: quotes off by ≤1s/shot.
Task 2: review → Needs fixes (2 Important: NaN passes budget check; rounded spent used in comparison). Fix round 1 sent to implementer (FIX_BASE 8afee77).
Ruling: billable rule is "≤ 0.5 adds a second" (plan tests 4.5→6 win over constraint wording "<") — cost if wrong: +1s on exact x.5 shots.
Task 2: minor (deferred): zero-padded review filenames (v01) rebuild wrong path; round1(1.15)→1.1 display; review files hashes not re-checked here (Task 5 does it); over-budget quote file still written (Task 5 must reject overBudget:true).
Login check: ~/.claude-film NOT logged in (my earlier PowerShell one-liner was mangled by bash $env expansion). Wrapper must also set CLAUDE_CODE_GIT_BASH_PATH (E:\AI\tools\Git\bin\bash.exe) — autoloop strips CLAUDE_CODE_* vars. Opened terminal with login-official.ps1 for user.
USER DECISION (in chat): Seedance via third-party new-api gateway https://newapi.dragon3api.com (user supplied key in chat — NOT to be written by me into any file/log; user sets env var).
Ruling: Task 5 targets that gateway; implementer must find the gateway's Seedance/video task API (new-api docs) instead of Ark direct; base URL + key from env — cost if wrong: client rework.
Task 2: fix round 1/5 (2 addressed, 0 open; commits 8afee77..3ad866b)
Task 2: complete (commits 78189eb..3ad866b, review clean)
Task 2: minor (deferred): over-budget message can show remaining ¥5.0 next to quote ¥5.0 when only rounding tips it; extra checks added (镜头重复, 总预算不合法, 单价不合法).
Ruling: video gateway env vars renamed SEEDANCE_BASE_URL / SEEDANCE_API_KEY (third-party new-api gateway, not Ark) — replaces ARK_BASE_URL/ARK_API_KEY in Task 5/8/9 — cost if wrong: rename.
Gateway pricing verified (public /api/pricing): seedance-2.0-mini ¥0.15/s @720p, seedance-2.5 ¥0.55/s @720p (first/last-frame support for 2.5 UNVERIFIED), endpoint POST /v1/videos. Notes: gateway-notes.md
Ruling: Task 5 updates config/pricing.json → mini {id:"seedance-2.0-mini", cnyPerSecond720p:0.15}, 2.5 {id:"seedance-2.5", cnyPerSecond720p:0.55}; Task 2 tests that assert 5.0/15.0 must be updated to the new prices (or read prices from a test fixture) — cost if wrong: re-pricing.
Task 2b: complete (commits 3ad866b..89238a8, review clean)
Task 2b: minor (deferred): login-official.ps1 ignores FILM_CLAUDE_CONFIG_DIR; ps1 env changes persist in the user's window; mingw64 git path not handled; mkdir failure raw stack; no mixed-case env test.
USER DECISION (in chat): 导演 = 这个桌面端 Claude Code 会话（加载 film-director Skill），审核 = 它开的子 agent；不用后台登录，autoloop 不再启动导演，关口直接在对话里问。→ Architecture change; presenting revised design to user before replanning Tasks 3–9. Task 2b wrapper becomes optional (kept for possible background use).
Plan revised per R1 (commit below): T3 prepare/record; T4 approve.ts; T5 gateway + wait; T8 interactive skill at .claude/skills; T9 README + in-session dry run; T10 ~¥1 smoke. Spec R1 at 13de06a.
Task 3: dispatched (BASE 777f0d8)
Task 3: complete (commits 777f0d8..05ccef9, review clean)
Task 3: minor (deferred): parseVerdict rejects "通过。"/“通过”/*通过*/结论：通过 (fail-closed; costs a re-review); .prompt.md not tamper-checked in record; final mp4/frames n not required equal; films with no character sheets blocked at keyframes/pre-submit; keyframe-plan items 6/8 visual; isForbidden throws.
Ruling: Task 8 Skill must have the director paste the CONTENT of the .prompt.md into the reviewer subagent prompt (not its path, which sits inside reviews/ next to old verdicts) — per T3 review finding #2 — cost if wrong: reviewer may see old verdicts.
Task 4: complete (commits 05ccef9..e9c6de2, review clean)
Task 4: minor (deferred): readApproval returns raw JSON (Task 5 checks quote/totalCNY); overBudget is a snapshot (Task 5 rechecks budget).
Ruling: approve.ts --said must reject negations — add lookbehind (?<![不别勿没未])批准 Q<n>(?!\d) — folded into Task 5 dispatch (one-line + tests) — cost if wrong: a negated reply could be recorded as approval.
Task 5: implementer DONE 1dd6496 (gateway format from docs.dragon3api.com/video-references; billable floor 4s; 2.5 no first/last; uncertain submits recorded as spend uncertain:true; .submit.lock)
Task 5: review → Needs fixes (2 Important: bookkeeping failure after create → reported unsubmitted + lock released → double spend; 404 task stalls wait). Fix round 1 sent (FIX_BASE 1dd6496).
Task 5: minor (deferred): stale .submit.lock message unclear (should print pid/quote/time + why); poll --json prints unscrubbed videoUrl; uncertain spend rows can't be reconciled; concurrent wait+fetch can double-download / state.clip may point to older gen; negation lookbehind narrow (拒绝/取消/暂缓 accepted); lock unlink is a deletion exception to document.
Task 5: fix round 1/5 (2 addressed, 0 open; commits 1dd6496..fcea651)
Task 5: complete (commits e9c6de2..fcea651, review clean)
Task 5: minor (deferred): 404/410 marks paid task failed permanently with no retry (misconfigured base URL could mark all failed); timeout path ignores fetchAll rc; fetchAll bookkeeping failure after download → re-download as new version. Exit codes: submit 0/1/4(arrears)/7(unrecorded, lock kept); poll 0/10; wait 0/1/6.
Task 6: implementer DONE_WITH_CONCERNS df3a4b6 — real codex 0.77.0 returns HTTP 400 'requires a newer version of Codex' → codex upgrade needed (NOT pre-authorized; ask user). Real success output not verified.
Task 6: review → Needs fixes (1 Important: quota false positive from echoed prompt). Fix round 1 sent (FIX_BASE df3a4b6).
Task 6: minor (deferred): non-PNG outputs (.webp/.jpg) ignored → misleading exit 3; no-id fallback may pick concurrent session's image (warn?); id found but image elsewhere → no fallback (recheck after codex upgrade); resolveCommand throw not caught in main.
Task 6: fix round 1/5 (1 addressed, 0 open; commits df3a4b6..a1c95d4)
Task 6: complete (commits fcea651..a1c95d4, review clean) — PENDING: real successful Codex run after user upgrades codex (0.77.0 → latest); recheck echo/layout then.
Task 7: implementer DONE 0f42f0e (ffmpeg 9.0.2 via winget, .venv Pillow 13.0.0)
Task 7: complete (commits a1c95d4..0f42f0e, review clean)
Task 7: minor (deferred): post.py unlink on ffmpeg failure can delete a file another process created in the race window; unsharp applied to already-1080p clips, non-16:9 stretched; tv range forced (pc range sources misread); primaries tagged not converted (doc); grade/trim tag bt709 unconditionally; extract one ffmpeg per frame (slow); grayscale skips surrounded blocks silently; read_list no unescape; concat list path w/ space+CJK untested; Pillow unpinned (>=10.1).
Codex upgraded by controller at user's request: node_global prefix now codex-cli 0.167.0 (an extra 0.167.0 copy also landed in AppData\Roaming\npm — not on PATH, left in place).
Task 6 real verification PASSED: codex-image.ts in temp FILM_ROOT, kind style → style/look-v1.png 1672×941, exit 0 (session id parsing + image folder OK on 0.167.0).
Task 8: review → Needs fixes (1 Important: trial batch → quote rest before human G5 motion check; files disagree). Fix round 1 sent (FIX_BASE be9a612).
Task 8: minor (deferred, money-path ones flagged for final review): [money] G4 numbered-option fallback — reply "1" isn't 批准 Q<n>, tell human to type it; [money] resume step for approved-but-unsubmitted quote → re-ask G4; [money] after exit 7/uncertain resolved → leftover shots need new quote+G4; requirements.md gate lines leak prior approvals to final reviewer; Python frame round-trips don't pin bt601; shot-entry creation vs editable-fields wording; push-in crop example defaults top-left; billable table one-decimal note; review prepare uncaught throw exit 1 unlisted.
Task 8: fix round 1/5 (1 addressed, 0 open; commits be9a612..846a081)
Task 8: complete (commits 0f42f0e..846a081, review clean)
Task 8: minor (deferred): gates.md converted to CRLF (diff noise); G5 gate state after mid-film "都可以" ambiguous (general rule says approved, G5 section only at all accepted).
Task 9 Step1/3: README e100018 (npm --prefix method matches what controller actually did and verified)
Task 9 (Step 1+3 README): complete (commits 846a081..e100018, review clean). Step 2 dry run pending (needs user to answer gates).
Task 9: minor (deferred): README.md:35 machine-specific "这台机器有两个 npm 全局目录" wording; README.md:140 mentions recharging (user may want removed).
Final review: dispatched over c6b1a98..HEAD
Final review: With fixes. Critical: reviewer subagent_type "Explore" → haiku alias → MiniMax (fails/wrong model). Important: 404 writes off paid task; no reconcile for uncertain submits; approve.ts accepts 拒绝/取消/暂缓/？/吗 forms; e2e never run. Fix-before-real-use triage: + push-in crop centering.
Ruling: ONE final fix dispatch per final-fix-brief.md (C1 film-reviewer project agent model:inherit tools Read/Glob/Grep; I1 404 not terminal + nested/empty status + baseUrl per spend row; I2 reconcile command; I3 strict approval text; centred crop; resume approved-unsubmitted; per-model max seconds; quote refuses non-first/last models; .gitattributes) — cost if wrong: one more fix wave.
Note for user: final reviewer read ~/.claude/settings.json (printed only non-secret keys) to confirm alias mapping — harness flagged settings-json pattern.
Final fix: dispatched (FIX_BASE e100018)
Final fix: done (9 commits e100018..4fd5db2). Controller checks: npm test 5× = 142/142 each (flaky queryShape not reproduced); film-reviewer agent dispatched once in this desktop session → ran and returned "通过" (C1 wiring verified).
Final fix re-review: all findings addressed, no new Critical/Important. HEAD 4fd5db2.
Final: parked — unrecognised/erroring query status 5× in a row (~2.5 min at 30 s) inside wait permanently marks a PAID task failed in fetched.jsonl (nothing resubmitted) — Ruling: stands for now (brief required it; fails closed on spending, but can strand a paid clip; recovery = manual) — surface to user as follow-up: raise MAX_QUERY_ERRORS or require errors spread over ≥10 min, and add a "refetch" path.
Final: parked — poll/wait exit 0 when all pending rows skipped for baseUrl mismatch (message is printed; shot stays generating) — Ruling: acceptable, distinct exit code is a follow-up.
DRY RUN: story review failed 4 rounds in a row (fresh reviewer each round, no severity threshold → non-convergent). USER DECISION: 先补审核门槛再继续.
Ruling: add a severity rule to all 5 checklists + film-reviewer agent: only 硬伤 (likely to make the model fail/waste a paid generation, violates a 本人 requirement, or self-contradiction in logic/timeline/orientation) → 不通过; everything else listed as 建议 and does not block. pre-submit additionally: any mismatch between prompt text and first/last frames (position, left/right, colour, count, props, clothing, expression) or between first/last frames' camera/background is 硬伤. — cost if wrong: reviews slightly more lenient on story/keyframe stages; money gate stays strict.
Threshold change: complete (commits 4fd5db2..4b3005c, review clean)
Threshold: minor (deferred, [money]): pre-submit image-vs-设定图/配色规则 mismatch no longer automatically 硬伤 (only prompt-vs-frame & first-vs-last); 硬伤+"可能" overload; tests weak on exact sentence.

DRY RUN finished (film 试跑 done, G6 accepted). USER: "Fix them now" → dryrun-fix-brief.md (D1 exit 127, D2 cny rounding, D3 sketch columns, D4–D8 Skill text). Dispatched.
Dry-run fixes D1–D8: complete (commits 4b3005c..2407bc3, review clean). Controller verified tests/exit.test.ts 5× pass; no process.exit( left except claude-official forward.
Dry-run fixes: minor (deferred): review checklists keyframe-plan/pre-submit don't know the "静止，后期剪掉" tail (pre-submit may wrongly fail a correct D5 prompt); D5 assumes in-film part at start (2-board "best N seconds" case); D6 doesn't say latest [设定] line wins; D4 ">" wording; D7 reveal_path is deferred (Skill should say load via ToolSearch); new-film.ts writes multi-line idea raw; proc.run timeout grandchild hang (pre-existing).
Minor fixes M1–M6: complete (commits 2407bc3..066ffde, review clean). Follow-up (spec gap, deferred): add M2 "剪出最好的 N 秒" exception + M3 "最后一条为准" rule into reviewer checklists; pre-submit note "静止尾巴里的画面仍须和尾帧一致"; 4-keyframes exception should name "中间发生什么".
USER: "做正片吧" — SEEDANCE_API_KEY not set (session + user env). Asked user to set it; asked which content.
seedance-2.0 added (commits 066ffde..cd3cce8): 4–15s, ¥0.45/s, first/last frame per docs (untested by gateway); pre-deduct 15s×0.45=¥6.75/shot. Flaky: mini test '提交时连接断开（结果不明）' 1/15 fail.
seedance-2.0: complete (commits 066ffde..cd3cce8, review clean). minor deferred: G4 2.5-option condition says 'mini' (should be 'not 2.5'); G4 text should state 2.0 pre-deduct ¥6.75/shot; video-api.ts:28 comment add 2.0.
