// 用独立配置目录运行 Anthropic 官方 Claude Code，绕开全局 ~/.claude/settings.json 里的网关设置（不改那个文件）。
// 用法：claude-official.js [任意参数...]  —— 参数原样传给真正的 claude。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

/** autoloop 用来从 .cmd 包装里认出 js 入口的正则（照抄）。 */
export const CMD_JS_RE = /"%(?:dp0%|~dp0)\\?([^"\r\n]+\.(?:[cm]?js))"\s+%\*/i;

/** 要删掉的网关变量。 */
export const STRIPPED_VARS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 从 npm 风格的 .cmd 包装里解析出 js 入口的绝对路径（相对 .cmd 所在目录）；解析不出返回 null。 */
export function cliFromCmd(cmdPath) {
  let text;
  try {
    text = readFileSync(cmdPath, "utf8");
  } catch {
    return null;
  }
  const m = CMD_JS_RE.exec(text);
  return m ? resolve(dirname(cmdPath), m[1]) : null;
}

/** 在 PATH 里找文件，返回第一个存在的绝对路径。 */
function findOnPath(name, pathValue) {
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir.replace(/^"(.*)"$/, "$1"), name);
    if (isFile(p)) return resolve(p);
  }
  return null;
}

/** 大小写无关地取环境变量（复制出来的 env 对象在 Windows 上不再大小写无关）。 */
function getVar(env, name) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function deleteVar(env, name) {
  for (const k of Object.keys(env)) if (k.toUpperCase() === name) delete env[k];
}

function setVar(env, name, value) {
  deleteVar(env, name);
  env[name] = value;
}

/** 找真正的 claude cli.js：FILM_REAL_CLAUDE 优先，否则 PATH 里的 claude.cmd。 */
export function findRealClaude(env) {
  const explicit = getVar(env, "FILM_REAL_CLAUDE");
  if (explicit && isFile(explicit)) return resolve(explicit);
  const cmd = findOnPath("claude.cmd", getVar(env, "PATH"));
  if (cmd) {
    const cli = cliFromCmd(cmd);
    if (cli && isFile(cli)) return cli;
  }
  return null;
}

/** git bash：已有 CLAUDE_CODE_GIT_BASH_PATH 保留；否则 FILM_GIT_BASH；否则由 PATH 里的 git.exe 推出 ..\bin\bash.exe（存在才用）。 */
export function findGitBash(env) {
  const existing = getVar(env, "CLAUDE_CODE_GIT_BASH_PATH");
  if (existing) return existing;
  const film = getVar(env, "FILM_GIT_BASH");
  if (film) return film;
  const git = findOnPath("git.exe", getVar(env, "PATH"));
  if (git) {
    const bash = resolve(dirname(git), "..", "bin", "bash.exe");
    if (isFile(bash)) return bash;
  }
  return null;
}

/** 组装给真正 claude 的环境。 */
export function buildEnv(source) {
  const env = { ...source };
  for (const name of STRIPPED_VARS) deleteVar(env, name);
  const userProfile = getVar(env, "USERPROFILE") || homedir();
  const configDir = getVar(env, "FILM_CLAUDE_CONFIG_DIR") || join(userProfile, ".claude-film");
  mkdirSync(configDir, { recursive: true });
  setVar(env, "CLAUDE_CONFIG_DIR", configDir);
  const bash = findGitBash(env);
  if (bash) setVar(env, "CLAUDE_CODE_GIT_BASH_PATH", bash);
  return env;
}

function main(args) {
  const env = buildEnv(process.env);
  const cli = findRealClaude(env);
  if (!cli) {
    process.stderr.write("找不到 claude：请装 Claude Code 或设置 FILM_REAL_CLAUDE\n");
    process.exitCode = 127;
    return;
  }
  const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit", env });
  const forward = (sig) => {
    try {
      child.kill(sig);
    } catch {
      // 子进程可能已经退出
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("error", (err) => {
    process.stderr.write(`启动 claude 失败：${err.message}\n`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1));
  });
}

if (import.meta.main) main(process.argv.slice(2));
