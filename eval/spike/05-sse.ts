// Phase 1 spike 05: SSE streaming check. Usage:
//   pnpm spike:sse                     (against http://localhost:3055)
//   SSE_BASE_URL=https://<deploy> pnpm spike:sse     (after you deploy with SPIKE_SSE_ENABLED=true)
// Verifies events arrive incrementally (not buffered to the end) for >= SSE_SECONDS (default 70).
import { appendResults } from "./lib";

async function main(): Promise<void> {
  const base = process.env.SSE_BASE_URL ?? "http://localhost:3055";
  const seconds = Number(process.env.SSE_SECONDS ?? "70");
  const t0 = performance.now();
  const res = await fetch(`${base}/api/spike/sse?seconds=${seconds}`, { headers: { Accept: "text/event-stream" } });
  console.log(`HTTP ${res.status} content-type=${res.headers.get("content-type")}`);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const arrivals: number[] = [];
  let events = 0;
  let done = false;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done: d } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (frame.startsWith("data:")) {
        events++;
        arrivals.push(Math.round(performance.now() - t0));
        if (frame.includes('"type":"done"')) done = true;
      }
    }
  }
  const total = Math.round(performance.now() - t0);
  const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i]!);
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  const firstEventMs = arrivals[0] ?? -1;
  // Incremental if first event arrives long before the end and gaps are ~5s, not one burst.
  const incremental = events > 3 && firstEventMs < 3000 && maxGap < 8000;
  const host = new URL(base).host;
  const md = `\n## ${new Date().toISOString()} — 05-sse (${host})\n\n- ${events} events over ${total} ms (requested ${seconds}s); first event at ${firstEventMs} ms; max inter-event gap ${maxGap} ms; \`done\` event received: ${done}.\n- Verdict: ${incremental && done && total >= seconds * 1000 * 0.95 ? "STREAMS INCREMENTALLY for the full duration" : "NOT CONFIRMED (buffered, cut off, or too short)"}.\n`;
  appendResults(md);
  console.log(md);
}

main().catch((e: unknown) => {
  console.error(`05-sse failed: ${(e as Error)?.message?.slice(0, 120)}`);
  process.exit(1);
});
