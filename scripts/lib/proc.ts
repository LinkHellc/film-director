import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, extname, join, resolve } from "node:path";
// 与 claude-official.js 共用 npm .cmd 包装的解析（autoloop 同款正则）
import { cliFromCmd } from "../bin/claude-official.js";

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Windows：在 PATH 里按 PATHEXT 找可执行文件；找不到返回 null。 */
function whichWin(name: string): string | null {
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir.replace(/^"(.*)"$/, "$1"), name + ext.toLowerCase());
      if (isFile(p)) return resolve(p);
    }
  }
  return null;
}

/**
 * Windows 上把命令变成不用 shell 就能 spawn 的形式：
 * 裸命令名在 PATH 里找；.cmd/.bat（npm 包装）解析出 js 入口，改用当前 node 运行。
 * 其他平台原样返回。
 */
function spawnable(cmd: string[]): string[] {
  if (process.platform !== "win32") return cmd;
  let [prog, ...rest] = cmd;
  if (!/[\\/]/.test(prog) && extname(prog) === "") prog = whichWin(prog) ?? prog;
  if (/\.(cmd|bat)$/i.test(prog)) {
    const js = cliFromCmd(prog) as string | null;
    if (!js || !isFile(js)) throw new Error(`无法不经 shell 运行 ${prog}：认不出里面的 js 入口`);
    return [process.execPath, js, ...rest];
  }
  return [prog, ...rest];
}

/**
 * 外部命令：环境变量 <envName> 若有值，必须是非空字符串 JSON 数组（测试用假程序）；否则用 fallback。
 * 返回可直接 spawn 的 argv（Windows 的 .cmd 包装已解析成 node + js 入口）。
 */
export function resolveCommand(envName: string, fallback: string[]): string[] {
  const raw = process.env[envName];
  let cmd = fallback;
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((x) => typeof x === "string" && x !== "")) {
      throw new Error(`${envName} 必须是非空字符串组成的 JSON 数组`);
    }
    cmd = parsed as string[];
  }
  return spawnable(cmd);
}

/** 运行命令（从不经 shell）。启动失败返回 code 127，超时杀掉并返回 code 124；stderr 里写原因。 */
export function run(
  cmd: string[],
  opts: { cwd?: string; stdin?: string; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const [prog, ...args] = cmd;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const finish = (code: number, extra = "") => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      done({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8") + extra,
      });
    };
    const child = spawn(prog, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => finish(127, `\n启动失败：${prog}：${e.message}`));
    child.on("close", (code) => {
      if (timedOut) finish(124, `\n超时（${opts.timeoutMs}ms）被终止`);
      else finish(code ?? 1);
    });
    child.stdin.on("error", () => {}); // 子进程不读 stdin 就退出时会 EPIPE，忽略
    child.stdin.end(opts.stdin ?? "");
  });
}
