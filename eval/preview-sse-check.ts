// Real SSE check against a deployed (or local) /api/run with the PREPARED FICTIONAL profile only. No patient data.
// Usage:  PREVIEW_URL=https://<preview-host> [PREVIEW_SHARE_URL=<vercel bypass link>] [RUN_LIVE=1] [FILL_BUCKET=1] pnpm exec tsx eval/preview-sse-check.ts
//   always     : GET /api/run (expect 405), bad body (expect 400), explicit replay request
//   RUN_LIVE=1 + CONFIRM_LIVE_RUN=one-run-nocache : one PAID live run (≈40-80 LLM calls, 60-105 s): per-event timing, progressive delivery, completion, tiers
//   FILL_BUCKET=1 (needs UPSTASH_REDIS_REST_URL/TOKEN and RATE_BUCKET_ID): fills THAT hourly rate-limit bucket, then expects a labelled
//                rate_limited replay with no live events and no mixed state
// Prints counts, timings and fixed codes only. Never prints the share link, cookies or keys.
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { SAMPLE_TEXT } from "../src/lib/sample/triallens-sample";
import { SseEventSchema } from "../src/schema/sse";
import { liveAssertions, type Timed } from "./lib/live-assertions";

const BASE = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
if (!BASE) { console.error("PREVIEW_URL is required"); process.exit(2); }
const results: Array<[boolean, string]> = [];
const check = (ok: boolean, name: string) => { results.push([ok, name]); console.warn(`${ok ? "PASS" : "FAIL"} ${name}`); };

// Completes the protected-preview sign-in: follows the share link's redirects manually (max 8 hops, only to the preview host or *.vercel.com,
// https only), keeping a per-run cookie jar. Returns the Cookie header for the preview host; "" when no share link is set.
// Never logs URLs, cookie names/values or response bodies; failures are reported as fixed codes.
async function cookieFromShare(): Promise<string> {
  const share = process.env.PREVIEW_SHARE_URL;
  if (!share) return "";
  const previewHost = new URL(BASE).host;
  const jar = new Map<string, Map<string, string>>(); // host -> name -> value
  let url = share;
  for (let hop = 0; hop < 8; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !(u.host === previewHost || u.host === "vercel.com" || u.host.endsWith(".vercel.com"))) throw new Error("share_redirect_host_refused");
    const cookie = [...(jar.get(u.host) ?? [])].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";"); const i = pair!.indexOf("=");
      if (i > 0) { const m = jar.get(u.host) ?? new Map(); m.set(pair!.slice(0, i).trim(), pair!.slice(i + 1)); jar.set(u.host, m); }
    }
    const loc = r.headers.get("location");
    await r.arrayBuffer().catch(() => undefined);
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
    if (r.status === 410 || r.status === 404) throw new Error("share_link_expired_or_invalid");
    break;
  }
  // A valid share link ends with the preview host's _vercel_jwt cookie. A chain that lands on the vercel.com login instead means the link
  // was not accepted (expired or revoked): stop, never fall back to public access.
  const mine = jar.get(previewHost);
  if (!mine?.has("_vercel_jwt")) throw new Error("share_link_not_accepted_expired_or_revoked");
  return [...mine].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function post(body: unknown, cookie: string): Promise<{ status: number; ttfb: number; total: number; events: Timed[]; chunks: number; ct: string }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/run`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const ttfb = performance.now() - t0;
  const events: Timed[] = [];
  let chunks = 0, buf = "";
  if (res.body && res.ok) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks++;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const v = SseEventSchema.safeParse(JSON.parse(line.slice(6)));
        if (v.success) events.push({ e: v.data, t: performance.now() - t0 });
      }
    }
  } else await res.text();
  return { status: res.status, ttfb, total: performance.now() - t0, events, chunks, ct: res.headers.get("content-type") ?? "" };
}
const types = (ev: Timed[]) => Object.fromEntries([...new Set(ev.map((x) => x.e.type))].map((k) => [k, ev.filter((x) => x.e.type === k).length]));
const sec = (ms: number) => (ms / 1000).toFixed(1) + "s";

// ---- live-run assertions live in eval/lib/live-assertions.ts (offline-tested); this file only sends the request ----
async function readCounters(): Promise<Record<string, number | string>> {
  try {
    const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
    const day = new Date().toISOString().slice(0, 10);
    const [runs, inflight] = await Promise.all([redis.get<number>(`tl:runs:${day}`), redis.get<number>("tl:inflight")]);
    let cursor: string | number = 0, buckets = 0;
    do { const [next, keys] = (await redis.scan(cursor, { match: "tl:rl:*", count: 200 })) as [string, string[]]; cursor = next; buckets += keys.length; } while (String(cursor) !== "0");
    return { runs_today: runs ?? 0, inflight: inflight ?? 0, rl_keys: buckets };
  } catch { return { error: "upstash_unreadable" }; }
}


async function main() {
  const cookie = await cookieFromShare();
  const get = await fetch(`${BASE}/api/run`, { headers: cookie ? { cookie } : {} });
  check(get.status === 405, `GET /api/run is 405 (function deployed) [got ${get.status}]`);
  const bad = await fetch(`${BASE}/api/run`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: "not json" });
  check(bad.status === 400, `malformed body is 400 [got ${bad.status}]`);

  // Explicit replays (no model call, no cache write: handler.ts streams replay_id from the Supabase read-only store before the guard/pipeline).
  for (const id of ["her2pos-stage3", "hrpos-stage2", "tnbc-caregiver"]) {
    const rp = await post({ replay_id: id }, cookie);
    const ev = rp.events.map((x) => x.e);
    const first = ev[0];
    const results_ = ev.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));
    const tally = (xs: string[]) => xs.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
    const findings = results_.flatMap((a) => a.findings);
    const legacyKey = (k: string) => /^(question|stage)$/.test(k);
    console.warn(`replay ${id}: status ${rp.status}, label ${first?.type === "mode" ? JSON.stringify(first.label ?? null) : "n/a"}, ttfb ${sec(rp.ttfb)}, total ${sec(rp.total)}`);
    console.warn(`  events ${JSON.stringify(types(rp.events))}`);
    console.warn(`  tiers ${JSON.stringify(tally(results_.map((a) => a.tier)))}`);
    console.warn(`  finding source ${JSON.stringify(tally(findings.map((f) => f.source)))}; status ${JSON.stringify(tally(findings.map((f) => f.status)))}`);
    console.warn(`  verified ${JSON.stringify(tally(results_.map((a) => String(a.verified))))}; verifier_flags ${JSON.stringify(tally(results_.flatMap((a) => a.verifier_flags)))}`);
    check(rp.status === 200 && rp.ct.includes("text/event-stream"), `${id}: text/event-stream 200`);
    if (rp.events.length === 0) { check(false, `${id}: no events streamed (content checks skipped, nothing to verify)`); continue; }
    check(first?.type === "mode" && first.mode === "replay" && first.reason === "requested" && first.replay_id === id, `${id}: starts with labelled mode:replay (requested, id matches)`);
    const last = ev.at(-1);
    check(last?.type === "done" && last.replay === true, `${id}: ends with done(replay:true)`);
    check(rp.events.length > 0 && results_.length > 0, `${id}: streamed trial_result events (${results_.length})`);
    check(!ev.some((e) => legacyKey(e.type)), `${id}: no legacy question or stage events`);
    check(!ev.some((e) => e.type === "error"), `${id}: no error event`);
    const badEvidence = findings.filter((f) => (f.status === "PASS" || f.status === "FAIL") && f.evidence.length === 0);
    check(badEvidence.length === 0, `${id}: every PASS/FAIL finding has evidence (${badEvidence.length} without)`);
    const modelDecided = findings.filter((f) => (f.status === "PASS" || f.status === "FAIL") && f.source !== "code");
    check(modelDecided.length === 0, `${id}: no model-source PASS/FAIL survived (${modelDecided.length})`);
    check(results_.every((a) => a.tier !== "STRONG" && a.tier !== "LIKELY_MISMATCH"), `${id}: no STRONG/LIKELY_MISMATCH tier (Policy R2)`);
    check(results_.every((a) => !a.verifier_flags.includes("reported_conflict") || !a.verified), `${id}: reported_conflict never verified`);
    check(results_.every((a) => a.fact_basis === "visitor_reported"), `${id}: fact_basis visitor_reported on every result`);
    check(!ev.some((e) => e.type === "stage" || e.type === "question"), `${id}: no live-style stage/question events`);
  }

  if (process.env.RUN_LIVE === "1") {
    // Paid, one-shot. Needs an explicit second switch so RUN_LIVE alone (e.g. left in a shell) cannot spend credits.
    if (process.env.CONFIRM_LIVE_RUN !== "one-run-nocache") { console.error("live run refused: CONFIRM_LIVE_RUN=one-run-nocache is required"); process.exit(2); }
    if (process.env.FILL_BUCKET === "1") { console.error("live run refused: do not combine with FILL_BUCKET"); process.exit(2); }
    const counters = await readCounters(); // diagnostic only: other traffic can move these
    const lv = await post({ text: SAMPLE_TEXT }, cookie);
    const after = await readCounters();
    liveAssertions(lv, check);
    console.warn(`  upstash (diagnostic, GET-only; other traffic can interfere): ${JSON.stringify({ before: counters, after })}`);
  }

  if (process.env.FILL_BUCKET === "1") {
    const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
    let cursor: string | number = 0; const ids = new Set<string>();
    do { const [next, keys] = (await redis.scan(cursor, { match: "tl:rl:*", count: 200 })) as [string, string[]]; cursor = next; keys.forEach((k) => ids.add(k.split(":")[2]!)); } while (String(cursor) !== "0");
    console.warn(`rate-limit buckets present: ${ids.size} (this client's bucket is the one created by the live run above)`);
    // Never guess: with several clients' buckets present the first one is not necessarily ours, and filling someone else's bucket
    // would rate-limit them. Without RATE_BUCKET_ID this step is skipped (reported as untested).
    const id = process.env.RATE_BUCKET_ID;
    if (!id) console.warn("  SKIPPED: set RATE_BUCKET_ID to the bucket id you own to run the rate-limit fallback check (not guessing among " + ids.size + " buckets).");
    if (id) {
      const lim = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(Number(process.env.RATE_LIMIT_RUNS_PER_IP_PER_HOUR ?? 8), "1 h"), prefix: "tl:rl", analytics: false });
      for (let i = 0; i < 9; i++) await lim.limit(id);
      const fb = await post({ text: SAMPLE_TEXT }, cookie);
      const f = fb.events[0]?.e;
      console.warn(`fallback: status ${fb.status}, total ${sec(fb.total)}, events ${JSON.stringify(types(fb.events))}`);
      check(f?.type === "mode" && f.mode === "replay" && f.reason === "rate_limited", "refused request streams a labelled mode:replay (rate_limited)");
      check(!fb.events.some((x) => x.e.type === "stage"), "no live-style stage events in the replay (no mixed state)");
      check(fb.events.at(-1)?.e.type === "done" && (fb.events.at(-1)!.e as { replay?: boolean }).replay === true, "replay ends with done(replay:true)");
    }
  }
  const fail = results.filter(([ok]) => !ok).length;
  console.warn(`TOTAL ${results.length} checks, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e: unknown) => { console.error("check failed:", (e as Error)?.message?.slice(0, 160)); process.exit(2); });
