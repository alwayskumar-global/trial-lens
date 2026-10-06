import { describe, expect, it } from "vitest";
import { parseFrames, streamRun } from "@/lib/live/client";
import type { SseEvent } from "@/schema/sse";

const frame = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;
const streamOf = (...chunks: string[]) => new ReadableStream<Uint8Array>({ start(c) { const enc = new TextEncoder(); chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });

describe("parseFrames", () => {
  it("parses complete frames, keeps a partial frame for the next chunk, drops invalid ones", () => {
    const a = frame({ type: "mode", mode: "live" });
    const { events, rest } = parseFrames(a + "data: {not json}\n\n" + frame({ type: "nope" }) + 'data: {"type":"done"');
    expect(events).toEqual([{ type: "mode", mode: "live" }]);
    expect(rest).toBe('data: {"type":"done"');
  });
});

describe("streamRun", () => {
  it("delivers events across arbitrary chunk boundaries", async () => {
    const full = frame({ type: "mode", mode: "live" }) + frame({ type: "counts", discovered: 3 }) + frame({ type: "done", replay: false });
    const got: SseEvent[] = [];
    const r = await streamRun({ text: "x" }, (e) => got.push(e), { fetchImpl: (async () => new Response(streamOf(full.slice(0, 17), full.slice(17, 60), full.slice(60)))) as unknown as typeof fetch });
    expect(r).toEqual({ ok: true });
    expect(got.map((e) => e.type)).toEqual(["mode", "counts", "done"]);
  });
  it("reports HTTP and network failures with fixed codes", async () => {
    const http = await streamRun({ text: "x" }, () => {}, { fetchImpl: (async () => Response.json({ code: "input_too_long" }, { status: 413 })) as unknown as typeof fetch });
    expect(http).toEqual({ ok: false, status: 413, code: "input_too_long" });
    const net = await streamRun({ text: "x" }, () => {}, { fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    expect(net).toEqual({ ok: false, status: 0, code: "network" });
  });
});
