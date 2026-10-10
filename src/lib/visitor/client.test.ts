import { describe, expect, it } from "vitest";
import { canReuse, fetchInputMode, requestExtraction, REUSE_MS } from "./client";

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const f = (r: Response | Error) => (async () => { if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch;
const okBody = { profile: { facts: { age: { key: "age", state: "known", value: 52 } } }, extract_token: "t" };

describe("requestExtraction", () => {
  it("returns drafts and the token, and posts only {text}", async () => {
    let sent = "";
    const fetchImpl = (async (_u: string, init: RequestInit) => { sent = String(init.body); return res(200, okBody); }) as unknown as typeof fetch;
    const r = await requestExtraction("fictional", { fetchImpl });
    expect(r.ok && r.token).toBe("t");
    expect(JSON.parse(sent)).toEqual({ text: "fictional" });
  });
  it("maps statuses and codes; network failures and malformed bodies never throw", async () => {
    expect(await requestExtraction("x", { fetchImpl: f(res(403, { code: "visitor_input_disabled" })) })).toEqual({ ok: false, status: 403, code: "visitor_input_disabled" });
    expect(await requestExtraction("x", { fetchImpl: f(res(429, { code: "rate_limited" })) })).toEqual({ ok: false, status: 429, code: "rate_limited" });
    expect(await requestExtraction("x", { fetchImpl: f(new Error("down")) })).toEqual({ ok: false, status: 0, code: "network" });
    expect(await requestExtraction("x", { fetchImpl: f(res(200, { nope: 1 })) })).toMatchObject({ ok: false, code: "bad_response" });
    expect(await requestExtraction("x", { fetchImpl: f(new Response("<html>", { status: 502 })) })).toMatchObject({ ok: false, status: 502, code: "http_error" });
  });
});

describe("fetchInputMode", () => {
  it("reads the server's effective mode", async () => {
    expect(await fetchInputMode({ fetchImpl: f(res(200, { visitor_input: "open", extract_ready: true, max_input_chars: 1500 })) })).toEqual({ mode: "open", extractReady: true, maxChars: 1500 });
  });
  it("any failure or malformed answer means gated (samples, no extraction): never an input the server would refuse", async () => {
    const gated = { mode: "samples", extractReady: false, maxChars: 2000 };
    expect(await fetchInputMode({ fetchImpl: f(new Error("x")) })).toEqual(gated);
    expect(await fetchInputMode({ fetchImpl: f(res(500, {})) })).toEqual(gated);
    expect(await fetchInputMode({ fetchImpl: f(res(200, { visitor_input: "everything" })) })).toEqual(gated);
  });
});

describe("canReuse", () => {
  const ex = { text: "a", at: 1000 };
  it("reuses only the same text inside the window", () => {
    expect(canReuse(ex, "a", 1000 + 1000)).toBe(true);
    expect(canReuse(ex, "b", 2000)).toBe(false);
    expect(canReuse(ex, "a", 1000 + REUSE_MS)).toBe(false);
    expect(canReuse(null, "a", 0)).toBe(false);
  });
});
