// 假的 claude 入口：把收到的参数和关心的环境变量写进 FAKE_OUT，然后以 FAKE_CODE 退出。
import { writeFileSync } from "node:fs";

const WATCHED = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
];

const out = {
  argv: process.argv.slice(2),
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null,
  CLAUDE_CODE_GIT_BASH_PATH: process.env.CLAUDE_CODE_GIT_BASH_PATH ?? null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
  present: Object.fromEntries(WATCHED.map((k) => [k, process.env[k] !== undefined])),
};

if (process.env.FAKE_OUT) writeFileSync(process.env.FAKE_OUT, JSON.stringify(out), "utf8");
process.exit(Number(process.env.FAKE_CODE ?? 0));
