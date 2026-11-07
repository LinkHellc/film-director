import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CMD_JS_RE, cliFromCmd } from "../scripts/bin/claude-official.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WRAPPER = resolve(HERE, "../scripts/bin/claude-official.js");
const WRAPPER_CMD = resolve(HERE, "../scripts/bin/claude-official.cmd");
const FAKE_CLI = resolve(HERE, "fakes/claude-cli.js");

const STRIPPED = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
];

/** 去掉大小写不同的同名键（Windows 上 PATH 可能叫 Path）。 */
function setEnv(env: Record<string, string | undefined>, key: string, value: string | undefined): void {
  for (const k of Object.keys(env)) if (k.toUpperCase() === key.toUpperCase()) delete env[k];
  if (value !== undefined) env[key] = value;
}

interface FakeOut {
  argv: string[];
  CLAUDE_CONFIG_DIR: string | null;
  CLAUDE_CODE_GIT_BASH_PATH: string | null;
  ANTHROPIC_API_KEY: string | null;
  present: Record<string, boolean>;
}

/** 在临时目录里跑包装脚本；默认用假 cli。 */
function run(
  args: string[],
  extra: Record<string, string | undefined> = {},
): { code: number | null; stderr: string; out: FakeOut | null; tmp: string } {
  const tmp = mkdtempSync(join(tmpdir(), "film-claude-"));
  const outFile = join(tmp, "out.json");
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of [...STRIPPED, "ANTHROPIC_API_KEY", "CLAUDE_CODE_GIT_BASH_PATH", "FILM_GIT_BASH"]) setEnv(env, k, undefined);
  setEnv(env, "FILM_REAL_CLAUDE", FAKE_CLI);
  setEnv(env, "FILM_CLAUDE_CONFIG_DIR", join(tmp, "cfg"));
  setEnv(env, "FAKE_OUT", outFile);
  for (const [k, v] of Object.entries(extra)) setEnv(env, k, v);
  const r = spawnSync(process.execPath, [WRAPPER, ...args], { env: env as NodeJS.ProcessEnv, encoding: "utf8" });
  const out = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, "utf8")) as FakeOut) : null;
  return { code: r.status, stderr: r.stderr, out, tmp };
}

test("参数原样传给真正的 claude（换行、&、|、引号、%PATH%、中文）", () => {
  const args = ["-p", "第一行\n第二行", "a & b", "x | y", 'say "hi"', "%PATH%", "导演：开拍", "", "--flag=1 2"];
  const r = run(args);
  try {
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.out?.argv, args);
  } finally {
    rmSync(r.tmp, { recursive: true, force: true });
  }
});

test("去掉 7 个 ANTHROPIC_* 网关变量，保留 ANTHROPIC_API_KEY", () => {
  const extra: Record<string, string> = Object.fromEntries(STRIPPED.map((k) => [k, "gateway"]));
  extra.ANTHROPIC_API_KEY = "test-key";
  const r = run(["--version"], extra);
  try {
    assert.equal(r.code, 0, r.stderr);
    for (const k of STRIPPED) assert.equal(r.out?.present[k], false, k);
    assert.equal(r.out?.ANTHROPIC_API_KEY, "test-key");
  } finally {
    rmSync(r.tmp, { recursive: true, force: true });
  }
});

test("CLAUDE_CONFIG_DIR 等于 FILM_CLAUDE_CONFIG_DIR，且目录已建", () => {
  const r = run([]);
  try {
    const cfg = join(r.tmp, "cfg");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.out?.CLAUDE_CONFIG_DIR, cfg);
    assert.ok(statSync(cfg).isDirectory());
  } finally {
    rmSync(r.tmp, { recursive: true, force: true });
  }
});

test("子进程退出码原样返回", () => {
  const r = run([], { FAKE_CODE: "7" });
  try {
    assert.equal(r.code, 7);
  } finally {
    rmSync(r.tmp, { recursive: true, force: true });
  }
});

test("没设 CLAUDE_CODE_GIT_BASH_PATH 时用 FILM_GIT_BASH", () => {
  const r = run([], { FILM_GIT_BASH: "C:\\fake\\Git\\bin\\bash.exe" });
  try {
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.out?.CLAUDE_CODE_GIT_BASH_PATH, "C:\\fake\\Git\\bin\\bash.exe");
  } finally {
    rmSync(r.tmp, { recursive: true, force: true });
  }
});

test("已有 CLAUDE_CODE_GIT_BASH_PATH 就保留", () => {
  const r = run([], { CLAUDE_CODE_GIT_BASH_PATH: "D:\\keep\\bash.exe", FILM_GIT_BASH: "C:\\other\\bash.exe" });
  try {
    assert.equal(r.out?.CLAUDE_CODE_GIT_BASH_PATH, "D:\\keep\\bash.exe");
  } finally {
    rmSync(r.tmp, { recursive: true, force: true });
  }
});

test("找不到 claude → 退出 127，stderr 说明", () => {
  const empty = mkdtempSync(join(tmpdir(), "film-nopath-"));
  try {
    const r = run([], { FILM_REAL_CLAUDE: join(empty, "nope", "cli.js"), PATH: empty });
    try {
      assert.equal(r.code, 127);
      assert.match(r.stderr, /找不到 claude/);
      assert.equal(r.out, null);
    } finally {
      rmSync(r.tmp, { recursive: true, force: true });
    }
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("从 npm 风格 claude.cmd 解析出 cli.js 绝对路径", () => {
  const dir = mkdtempSync(join(tmpdir(), "film-cmd-"));
  try {
    const cmd = join(dir, "claude.cmd");
    writeFileSync(
      cmd,
      '@ECHO off\r\nSETLOCAL\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n',
      "utf8",
    );
    assert.equal(cliFromCmd(cmd), join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude-official.cmd 恰好两行，且能被 autoloop 的正则解析到 claude-official.js", () => {
  const text = readFileSync(WRAPPER_CMD, "utf8");
  assert.deepEqual(text.split(/\r?\n/).filter((l) => l !== ""), ["@echo off", 'node "%~dp0\\claude-official.js" %*']);
  assert.match(text, CMD_JS_RE);
  assert.equal(cliFromCmd(WRAPPER_CMD), WRAPPER);
});

test("PATH 里的 claude.cmd 能被找到并运行", () => {
  const dir = mkdtempSync(join(tmpdir(), "film-pathcmd-"));
  try {
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, "pkg", "cli.js"), readFileSync(FAKE_CLI, "utf8"), "utf8");
    writeFileSync(join(dir, "claude.cmd"), '@echo off\r\nnode "%~dp0\\pkg\\cli.js" %*\r\n', "utf8");
    const r = run(["hello"], { FILM_REAL_CLAUDE: undefined, PATH: dir, FAKE_CODE: "3" });
    try {
      assert.equal(r.code, 3, r.stderr);
      assert.deepEqual(r.out?.argv, ["hello"]);
    } finally {
      rmSync(r.tmp, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
