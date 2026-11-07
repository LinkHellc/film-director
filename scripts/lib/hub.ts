export interface HubEvent {
  id: string;
  type: string;
  subject: string;
  summary: string;
}

/** 中台地址：AGENT_AUTOLOOP_URL，默认 http://127.0.0.1:3350（去掉末尾斜杠）。 */
export function hubUrl(): string {
  return (process.env.AGENT_AUTOLOOP_URL || "http://127.0.0.1:3350").replace(/\/+$/, "");
}

/** 截到前 n 个字（按码点，不切断代理对）。 */
export function firstChars(s: string, n: number): string {
  return Array.from(s).slice(0, n).join("");
}

/**
 * 用来源密钥 AGENT_AUTOLOOP_FILM_KEY 向中台 POST /v1/events。
 * 缺密钥、网络失败、非 2xx、回复里没有数字 event 时抛错（信息为中文，不含密钥）。
 */
export async function emitEvent(event: HubEvent): Promise<{ event: number }> {
  const key = process.env.AGENT_AUTOLOOP_FILM_KEY;
  if (!key) throw new Error("缺少 AGENT_AUTOLOOP_FILM_KEY");
  const body = JSON.stringify({ ...event, summary: firstChars(event.summary, 200) });
  let res: Response;
  try {
    res = await fetch(`${hubUrl()}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`连不上中台 ${hubUrl()}（${(err as Error).message}）`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`中台返回 ${res.status}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("中台回复不是 JSON");
  }
  const n = (parsed as { event?: unknown }).event;
  if (typeof n !== "number") throw new Error("中台回复里没有事件编号");
  return { event: n };
}
