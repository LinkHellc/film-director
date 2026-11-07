// 假的 codex：模仿 codex-cli 0.77 `exec` 的行为。
// - 每次调用往 FAKE_CODEX_LOG 追加一行 JSON：{ argv, stdin }。
// - 把 codex-output.txt（真实开头，已脱敏）填上 session id 和提示词后写到 stderr（真 codex 的开头也在 stderr）。
// - 出图：<FILM_CODEX_IMAGES>/<session id>/exec-<uuid>.png，尺寸 FAKE_CODEX_SIZE（默认 1920x1080）。
// FAKE_CODEX_MODE（可逗号组合）：ok（默认）| quota（报额度错、不出图、退出 1）| noimage（不出图、退出 0）| noid（不打印 session id，图放在 <出图目录>/other/）。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** 只有 PNG 签名 + IHDR + IEND 的最小 PNG（CRC 填 0，读宽高够用）。 */
function png(width: number, height: number): Uint8Array {
  const buf = Buffer.alloc(8 + 25 + 12);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf.writeUInt8(8, 24); // bit depth
  buf.writeUInt8(2, 25); // color type RGB
  // IHDR 的 CRC 在 29..32（全 0）；IEND：长度 0 在 33，类型在 37，CRC 在 41（全 0）
  buf.write("IEND", 37, "ascii");
  return buf;
}

const argv = process.argv.slice(2);
const stdin = readStdin();
if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ argv, stdin }) + "\n", "utf8");

const modes = new Set((process.env.FAKE_CODEX_MODE ?? "ok").split(","));
const session = modes.has("noid") ? null : randomUUID();
const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "codex-output.txt"), "utf8");
let banner = fixture.replace("{{PROMPT}}", stdin.trimEnd());
banner = session ? banner.replace("{{SESSION_ID}}", session) : banner.replace(/^session id:.*\r?\n/m, "");
process.stderr.write(banner);

if (modes.has("quota")) {
  process.stderr.write("ERROR: You've hit your usage limit (rate limit / quota exceeded). Try again later.\n");
  process.exit(1);
}
if (modes.has("noimage")) {
  process.stdout.write("I could not generate an image.\n");
  process.exit(0);
}

const [w, h] = (process.env.FAKE_CODEX_SIZE ?? "1920x1080").split("x").map(Number);
const root = process.env.FILM_CODEX_IMAGES!;
const dir = join(root, session ?? "other");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `exec-${randomUUID()}.png`), png(w, h));
process.stdout.write("Generated one image.\n");
process.exit(0);
