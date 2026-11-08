import sys

plan, t345, t8910 = sys.argv[1:]
s = open(plan, encoding="utf-8").read()
a = open(t345, encoding="utf-8").read()
b = open(t8910, encoding="utf-8").read()

i3 = s.index("### Task 3:")
i6 = s.index("### Task 6:")
i8 = s.index("### Task 8:")
s = s[:i3] + a + s[i6:i8] + b

g0 = s.index("## Global Constraints")
g1 = s.index("## Review Focus")
repl = {
    "- 默认模型": "- 默认模型 `seedance-2.0-mini`（网关价 720p ¥0.15/秒）；可选 `seedance-2.5`（¥0.55/秒，首尾帧支持核实前不可用）。单价只放在 `config/pricing.json`。（R1）",
    "- 视频接口": "- 视频接口：第三方 new-api 网关 `POST {SEEDANCE_BASE_URL}/v1/videos`，`SEEDANCE_BASE_URL` 默认 `https://newapi.dragon3api.com`；Key 只从环境变量 `SEEDANCE_API_KEY` 读，永不打印、不进日志、不写文件。（R1）",
    "- 审核进程": "- 审核：导演会话开的只读子 agent；`review.ts` 只做 prepare/record，不启动模型。（R1）",
    "- 外部命令都可用环境变量覆盖": "- 外部命令可用环境变量覆盖成 JSON 数组（测试用假程序）：`FILM_CODEX_CMD`；Codex 出图目录用 `FILM_CODEX_IMAGES` 覆盖（默认 `~/.codex/generated_images`）。",
    "- 中台地址": "- 导演是本人在 Claude 桌面端开的 Code 会话（工作目录 = 本项目），Skill 在 `.claude/skills/film-director/`；agent-autoloop 不参与制作流程。（R1）",
}
lines = []
for line in s[g0:g1].split("\n"):
    for prefix, new in repl.items():
        if line.startswith(prefix):
            line = new
            break
    lines.append(line)
s = s[:g0] + "\n".join(lines) + s[g1:]
s = s.replace(
    "**Spec:** `docs/superpowers/specs/2026-11-07-ai-film-autoloop-design.md`",
    "**Spec:** `docs/superpowers/specs/2026-11-07-ai-film-autoloop-design.md`（以\"修订 R1\"一节为准）",
)
open(plan, "w", encoding="utf-8").write(s)
print("ok")
