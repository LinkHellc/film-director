### Task 9: 启用说明与不花钱的整流程试跑（R1）

**Files:**
- Create: `README.md`

- [ ] **Step 1:** 写 `README.md`，包括：
  - 系统是什么（一段话）；
  - 前置条件：Claude 桌面端、Codex 已登录、ffmpeg、`.venv`、`SEEDANCE_API_KEY` 和 `SEEDANCE_BASE_URL`；
  - 开一支新片：在桌面端新开 Code 会话，目录选本项目，说"开一支新片：……"；
  - 怎么继续做一支片子；
  - 进展看哪里：片子目录和 `state.json`；
  - 花钱规则；
  - 常见问题：Codex 额度用完、欠费、会话关了怎么接着做；
  - 可选的后台模式：`scripts/bin/claude-official.*` 和 agent-autoloop，注明"未启用"。
- [ ] **Step 2:** 不花钱的整流程试跑：主控会话在本会话里照 Skill 执行，本人回答关口。
  - 启动假网关：`node tests/fakes/video-server.ts --port 3399 --video <用 ffmpeg testsrc 生成的 5 秒 720p 视频>`；
  - 设 `SEEDANCE_BASE_URL=http://127.0.0.1:3399`、`SEEDANCE_API_KEY=test`；
  - 开片 `试跑`：想法是"一只橘猫在窗台上看雨，雨停后跳下窗台"，5 秒，1 个镜头；
  - 预期得到 `films/试跑/out/final-v1.mp4`（1920×1080、BT.709）和 `lessons.md`，`spend.jsonl` 里有 1 行；
  - 这一步会用到真实的 Codex 额度，不花视频网关的钱。每发现一个问题都记下来，回到对应 Task 去修。
- [ ] **Step 3:** 提交 `docs: 启用说明`。

