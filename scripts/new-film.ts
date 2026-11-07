import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { filmDir } from "./lib/paths.ts";
import { writeNew } from "./lib/versioned.ts";
import { writeState, type FilmState } from "./lib/state.ts";
import { emitEvent, firstChars } from "./lib/hub.ts";

const SUBDIRS = ["story", "board", "style", "shots", "reviews", "quotes", "approvals", "post", "out"];
const USAGE = '用法：new-film.ts <片名> "<一句话想法>" [--no-emit]';

function human(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function main(argv: string[]): Promise<number> {
  const noEmit = argv.includes("--no-emit");
  const args = argv.filter((a) => a !== "--no-emit");
  const [film, idea] = args;
  if (args.length !== 2 || !film || !idea || !idea.trim()) {
    console.error(USAGE);
    return 2;
  }

  let dir: string;
  try {
    dir = filmDir(film);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  // 非递归 mkdir：目录已存在就 EEXIST，什么都不动。
  mkdirSync(dirname(dir), { recursive: true });
  try {
    mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(`片子已存在：${human(dir)}，没有改动任何文件。`);
      return 1;
    }
    throw err;
  }

  for (const d of SUBDIRS) mkdirSync(join(dir, d));
  writeNew(join(dir, "brief.md"), `${idea}\n`);
  writeNew(join(dir, "requirements.md"), `# 本人要求\n\n- ${idea}\n`);
  const state: FilmState = {
    film,
    stage: "setup",
    settings: { seconds: null, aspect: "16:9", budgetCNY: null, music: null, subtitles: false, model: "mini" },
    gates: {},
    shots: {},
    spentCNY: 0,
  };
  writeState(state);

  if (noEmit) {
    console.log(`已开新片：${human(dir)}（没有通知中台）。`);
    return 0;
  }
  try {
    const { event } = await emitEvent({
      id: `film.new:${film}`,
      type: "film.new",
      subject: `film:${film}`,
      summary: firstChars(idea, 200),
    });
    console.log(`已开新片：${human(dir)}，已通知中台（事件 ${event}）。`);
    return 0;
  } catch (err) {
    console.error(`没有发出事件：${(err as Error).message}（片子目录已建好：${human(dir)}）。`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
