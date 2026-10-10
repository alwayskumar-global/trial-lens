// Browser-side SSE client for POST /api/run. Frames are Zod-validated; an invalid frame is dropped, never rendered.
// The request body is sent once and never stored or logged by this module.
import { SseEventSchema, type SseEvent } from "@/schema/sse";

export type StreamResult = { ok: true } | { ok: false; status: number; code: string };

/** Parses complete `data: <json>` frames out of a text buffer; returns the events and the unconsumed rest. */
export function parseFrames(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];
  for (const p of parts) {
    const line = p.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    try {
      const v = SseEventSchema.safeParse(JSON.parse(line.slice(6)));
      if (v.success) events.push(v.data);
    } catch {
      /* drop malformed frame */
    }
  }
  return { events, rest };
}

export async function streamRun(body: { text?: string; replay_id?: string; profile?: unknown; extract_token?: string }, onEvent: (e: SseEvent) => void, o: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<StreamResult> {
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(o.signal ? { signal: o.signal } : {}) });
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
  if (!res.ok || !res.body) {
    const code = await res.json().then((j: { code?: string }) => j.code ?? "http_error").catch(() => "http_error");
    return { ok: false, status: res.status, code };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseFrames(buf);
      buf = rest;
      for (const e of events) onEvent(e);
    }
  } catch {
    return { ok: false, status: 0, code: "stream_closed" };
  }
  return { ok: true };
}
