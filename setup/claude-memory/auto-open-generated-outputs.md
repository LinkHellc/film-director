---
name: auto-open-generated-outputs
description: "User wants every generated output (images, clips, final videos) opened for them automatically when it isn't visible in the UI"
metadata:
  node_type: memory
  type: feedback
  originSessionId: df898f9d-aa87-45fd-95e7-c6101a903fb0
  modified: 2026-11-08T08:32:48.416Z
---

Whenever I generate content the user would want to look at (Codex images, video clips, final cuts, sketches), open it for them automatically — e.g. `mcp__ccd_host__reveal_path` on the file — instead of only listing paths.

**Why:** On 2026-11-08 during the AI 短片 dry run the user asked "我在哪查看", then said "每次有生成的内容如果界面看不到自动帮我打开". They don't want to hunt for files in the folder tree.

**How to apply:** After each generated artifact lands (style frames, character sheets, first/last frames, clips, joined/final videos), reveal/open it in the same turn. Related: [[ai-film-director-skill]] should carry the same rule for future director sessions.
