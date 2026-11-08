### Task 1: 片子状态与开新片

**Files:**
- Create: `scripts/lib/state.ts`、`scripts/lib/hub.ts`（只先写 `emitEvent`）、`scripts/new-film.ts`
- Test: `tests/state.test.ts`、`tests/new-film.test.ts`

**Interfaces:**
- Consumes: Task 0 全部
- Produces:
  ```ts
  type Stage = "setup"|"story"|"board"|"style"|"keyframes"|"prompts"|"generate"|"post"|"wrap"|"done";
  type GateId = "G0"|"G1"|"G2"|"G3"|"G3b"|"G4"|"G5"|"G6";
  type GateState = "pending"|"asked"|"approved"|"rejected";
  interface Shot { seconds: number; status: string; clip: string | null }
  interface FilmState {
    film: string; stage: Stage;
    settings: { seconds: number|null; aspect: string; budgetCNY: number|null; music: string|null; subtitles: boolean; model: "mini"|"2.5" };
    gates: Partial<Record<GateId, GateState>>;
    shots: Record<string, Shot>;   // 键形如 "S01"
    spentCNY: number;
  }
  readState(film: string): FilmState
  writeState(state: FilmState): void            // 先写 state.json.tmp 再 rename
  isApproved(state: FilmState, gate: GateId): boolean
  emitEvent(event: { id: string; type: string; subject: string; summary: string }): Promise<{ event: number }>
  ```
  `new-film.ts <片名> "<一句话想法>" [--no-emit]`：建 `films/<片名>/` 及子目录 `story board style shots reviews quotes approvals post out`，写 `brief.md`（想法原文）、`requirements.md`（首行 `# 本人要求`，第一条为想法原文）、`state.json`（`stage: "setup"`，`settings.aspect: "16:9"`，`model: "mini"`，其余为 null/空），然后发事件 `{ id: "film.new:<片名>", type: "film.new", subject: "film:<片名>", summary: <想法前 200 字> }`。

- [ ] **Step 1: 写失败测试**：
  - `writeState` 再 `readState` 得到同一对象；`isApproved` 对缺失关口返回 false。
  - `new-film` 带 `--no-emit` 在临时 `FILM_ROOT` 下建出全部目录和三个文件，`state.stage === "setup"`。
  - 片子目录已存在时 `main` 返回非零，且不改动已有文件。
  - 不带 `--no-emit` 时，对本地假中台（`node:http` 起在随机端口，`AGENT_AUTOLOOP_URL` 指向它）发出的请求体 `subject === "film:测试片"`、`Authorization: Bearer <AGENT_AUTOLOOP_FILM_KEY>`。
  - 没设 `AGENT_AUTOLOOP_FILM_KEY` 时目录照建，退出码非零并输出 `没有发出事件：缺少 AGENT_AUTOLOOP_FILM_KEY`。
- [ ] **Step 2:** `node --test tests/state.test.ts tests/new-film.test.ts`，预期 FAIL。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 同一命令，预期 PASS。
- [ ] **Step 5:** 提交 `feat: 片子状态与开新片`。

