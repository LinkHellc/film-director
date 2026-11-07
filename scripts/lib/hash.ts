import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** 文件内容的 SHA-256，小写十六进制。 */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
