import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCommand, run } from "../scripts/lib/proc.ts";

function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "film-proc-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("resolveCommand: env JSON array wins over fallback", () => {
  withEnv({ FILM_TEST_CMD: JSON.stringify([process.execPath, "x.js", "--flag"]) }, () => {
    assert.deepEqual(resolveCommand("FILM_TEST_CMD", ["nope"]), [process.execPath, "x.js", "--flag"]);
  });
});

test("resolveCommand: bad env value throws", () => {
  for (const bad of ["codex", "[]", "[1]", '{"a":1}']) {
    withEnv({ FILM_TEST_CMD: bad }, () => {
      assert.throws(() => resolveCommand("FILM_TEST_CMD", ["x"]), /FILM_TEST_CMD/);
    });
  }
});

test("resolveCommand: npm .cmd shim on PATH resolves to node + js entry", { skip: process.platform !== "win32" }, async () => {
  await withTmp((dir) => {
    mkdirSync(join(dir, "node_modules", "fake", "bin"), { recursive: true });
    const js = join(dir, "node_modules", "fake", "bin", "fake.js");
    writeFileSync(js, "");
    writeFileSync(
      join(dir, "fakecli.cmd"),
      '@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\fake\\bin\\fake.js" %*\r\n',
    );
    withEnv({ FILM_TEST_CMD: undefined, PATH: `${dir};${process.env.PATH}` }, () => {
      assert.deepEqual(resolveCommand("FILM_TEST_CMD", ["fakecli", "--x"]), [process.execPath, js, "--x"]);
    });
  });
});

test("run: passes stdin, captures stdout/stderr and exit code, no shell interpretation", async () => {
  const script = [
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{",
    "process.stdout.write(JSON.stringify({argv:process.argv.slice(1),stdin:s}));",
    "process.stderr.write('err');process.exit(3);});",
  ].join("");
  const tricky = ['a & echo pwned', '"quoted"', "%PATH%", "^|<>", "中文 参数"];
  const r = await run([process.execPath, "-e", script, ...tricky], { stdin: "提示词 & stuff\n" });
  assert.equal(r.code, 3);
  assert.equal(r.stderr, "err");
  const got = JSON.parse(r.stdout);
  assert.deepEqual(got.argv, tricky);
  assert.equal(got.stdin, "提示词 & stuff\n");
});

test("run: missing program returns non-zero instead of throwing", async () => {
  const r = await run(["definitely-not-a-program-xyz"], {});
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /definitely-not-a-program-xyz/);
});

test("run: timeout kills the child", async () => {
  const t = Date.now();
  const r = await run([process.execPath, "-e", "setTimeout(()=>{},60000)"], { timeoutMs: 300 });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /超时/);
  assert.ok(Date.now() - t < 10_000);
});
