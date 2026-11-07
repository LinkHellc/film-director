import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/new-film.ts";
import { readState } from "../scripts/lib/state.ts";

const SUBDIRS = ["story", "board", "style", "shots", "reviews", "quotes", "approvals", "post", "out"];
const ENV_KEYS = ["FILM_ROOT", "AGENT_AUTOLOOP_URL", "AGENT_AUTOLOOP_FILM_KEY"] as const;

/** 临时 FILM_ROOT + 环境变量保存/恢复 + 捕获 console 输出。 */
async function withEnv(
  env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: (root: string, out: string[]) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "film-new-"));
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const out: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    process.env.FILM_ROOT = root;
    for (const k of ["AGENT_AUTOLOOP_URL", "AGENT_AUTOLOOP_FILM_KEY"] as const) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    await fn(root, out);
  } finally {
    console.log = log;
    console.error = err;
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const IDEA = "一个雨夜邮差把最后一封信送给了自己。";

test("--no-emit 建出全部目录和三个文件，stage 为 setup", async () => {
  await withEnv({}, async (root) => {
    const code = await main(["测试片", IDEA, "--no-emit"]);
    assert.equal(code, 0);
    const dir = join(root, "films", "测试片");
    for (const d of SUBDIRS) assert.ok(statSync(join(dir, d)).isDirectory(), d);
    assert.equal(readFileSync(join(dir, "brief.md"), "utf8").trim(), IDEA);
    const req = readFileSync(join(dir, "requirements.md"), "utf8").split(/\r?\n/);
    assert.equal(req[0], "# 本人要求");
    const firstItem = req.find((l) => l.startsWith("- "));
    assert.equal(firstItem, `- ${IDEA}`);
    const s = readState("测试片");
    assert.equal(s.film, "测试片");
    assert.equal(s.stage, "setup");
    assert.deepEqual(s.settings, {
      seconds: null, aspect: "16:9", budgetCNY: null, music: null, subtitles: false, model: "mini",
    });
    assert.deepEqual(s.gates, {});
    assert.deepEqual(s.shots, {});
    assert.equal(s.spentCNY, 0);
  });
});

test("片子目录已存在时返回非零且不改动已有文件", async () => {
  await withEnv({}, async (root, out) => {
    const dir = join(root, "films", "测试片");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "brief.md"), "旧想法");
    const code = await main(["测试片", IDEA, "--no-emit"]);
    assert.notEqual(code, 0);
    assert.equal(readFileSync(join(dir, "brief.md"), "utf8"), "旧想法");
    assert.deepEqual(readdirSync(dir), ["brief.md"]);
    assert.match(out.join("\n"), /已存在/);
  });
});

test("片名不合法或缺参数时返回非零且不建目录", async () => {
  await withEnv({}, async (root, out) => {
    assert.notEqual(await main(["../x", IDEA, "--no-emit"]), 0);
    assert.match(out.join("\n"), /片名不合法：\.\.\/x/);
    assert.notEqual(await main(["测试片"]), 0);
    assert.equal(existsSync(join(root, "films", "测试片")), false);
  });
});

test("发事件到假中台：subject、Authorization 和事件体正确", async () => {
  const got: { auth?: string; url?: string; method?: string; body?: any } = {};
  const server = createServer((req: IncomingMessage, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      got.auth = req.headers.authorization;
      got.url = req.url;
      got.method = req.method;
      got.body = JSON.parse(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ event: 7, duplicate: false, routed: [] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const longIdea = "长".repeat(250);
    await withEnv(
      { AGENT_AUTOLOOP_URL: `http://127.0.0.1:${port}`, AGENT_AUTOLOOP_FILM_KEY: "k-test-123" },
      async (root, out) => {
        const code = await main(["测试片", longIdea]);
        assert.equal(code, 0);
        assert.equal(got.method, "POST");
        assert.equal(got.url, "/v1/events");
        assert.equal(got.auth, "Bearer k-test-123");
        assert.equal(got.body.subject, "film:测试片");
        assert.equal(got.body.id, "film.new:测试片");
        assert.equal(got.body.type, "film.new");
        assert.equal(got.body.summary, "长".repeat(200));
        assert.ok(existsSync(join(root, "films", "测试片", "state.json")));
        assert.match(out.join("\n"), /事件 7/);
      },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("没设 AGENT_AUTOLOOP_FILM_KEY 时目录照建，退出码非零并说明原因", async () => {
  await withEnv({ AGENT_AUTOLOOP_URL: "http://127.0.0.1:9" }, async (root, out) => {
    const code = await main(["测试片", IDEA]);
    assert.notEqual(code, 0);
    assert.ok(existsSync(join(root, "films", "测试片", "state.json")));
    assert.match(out.join("\n"), /没有发出事件：缺少 AGENT_AUTOLOOP_FILM_KEY/);
  });
});

test("中台返回非 200 时退出码非零并说明没有发出事件", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(401);
    res.end("no");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await withEnv(
      { AGENT_AUTOLOOP_URL: `http://127.0.0.1:${port}`, AGENT_AUTOLOOP_FILM_KEY: "bad" },
      async (_root, out) => {
        const code = await main(["测试片", IDEA]);
        assert.notEqual(code, 0);
        assert.match(out.join("\n"), /没有发出事件：.*401/);
      },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
