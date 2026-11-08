import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filmDir } from "./paths.ts";

export type Stage =
  | "setup" | "story" | "board" | "style" | "keyframes"
  | "prompts" | "generate" | "post" | "wrap" | "done";
export type GateId = "G0" | "G1" | "G2" | "G3" | "G3b" | "G4" | "G5" | "G6";
export type GateState = "pending" | "asked" | "approved" | "rejected";

export interface Shot {
  seconds: number;
  status: string;
  clip: string | null;
}

export interface FilmState {
  film: string;
  stage: Stage;
  settings: {
    seconds: number | null;
    aspect: string;
    budgetCNY: number | null;
    music: string | null;
    subtitles: boolean;
    model: "mini" | "2.0" | "2.5";
  };
  gates: Partial<Record<GateId, GateState>>;
  shots: Record<string, Shot>; // 键形如 "S01"
  spentCNY: number;
}

function statePath(film: string): string {
  return join(filmDir(film), "state.json");
}

/** 读 films/<片名>/state.json。 */
export function readState(film: string): FilmState {
  return JSON.parse(readFileSync(statePath(film), "utf8")) as FilmState;
}

/** 原地更新 state.json：先写 state.json.tmp 再 rename，避免写一半。 */
export function writeState(state: FilmState): void {
  const path = statePath(state.film);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, path);
}

/** 只有 "approved" 算批准；缺失关口返回 false。 */
export function isApproved(state: FilmState, gate: GateId): boolean {
  return state.gates[gate] === "approved";
}
