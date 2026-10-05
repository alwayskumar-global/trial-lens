// Phase 1 spike 01: Token Factory smoke test. Run: pnpm spike:smoke
//
// Output rules: never print the API key (or any part of it), request/response
// bodies, or provider error messages (some providers echo a masked key prefix in
// 401 messages). Only status codes, counts, model IDs, latencies and booleans.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { EnvError, getNebiusEnv, type NebiusEnv } from "../../src/lib/env";

const RESULTS_PATH = fileURLToPath(new URL("../../docs/spike-results.md", import.meta.url));
const TIMEOUT_MS = 30_000;

// VERIFY: Token Factory public API host. Probed without credentials.
const NETWORK_TARGETS = [
  { host: "api.tokenfactory.nebius.com", url: "https://api.tokenfactory.nebius.com/" },
  { host: "clinicaltrials.gov", url: "https://clinicaltrials.gov/api/v2/version" },
];

let secretsToRedact: string[] = [];
function redact(s: string): string {
  let out = s;
  for (const secret of secretsToRedact) if (secret.length >= 4) out = out.split(secret).join("[REDACTED]");
  return out;
}
function say(s = ""): void {
  console.log(redact(s));
}

interface NetResult {
  host: string;
  reachable: boolean;
  detail: string;
}

async function checkNetwork(): Promise<NetResult[]> {
  return Promise.all(
    NETWORK_TARGETS.map(async ({ host, url }) => {
      try {
        const res = await fetch(url, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          signal: AbortSignal.timeout(15_000),
        });
        await res.body?.cancel();
        // Any HTTP response from the origin means the host is reachable.
        return { host, reachable: true, detail: `HTTP ${res.status}` };
      } catch (e) {
        const cause = (e as { cause?: { code?: unknown } }).cause;
        const code = typeof cause?.code === "string" ? cause.code : (e as Error).name;
        return { host, reachable: false, detail: `blocked/unreachable (${code})` };
      }
    }),
  );
}

// Fixed, key-free messages per status. Never surfaces the provider's message text.
function describeApiError(e: unknown): { status: string; message: string } {
  if (e instanceof OpenAI.APIConnectionTimeoutError) {
    return { status: "timeout", message: `Request timed out after ${TIMEOUT_MS} ms.` };
  }
  if (e instanceof OpenAI.APIConnectionError) {
    return {
      status: "network",
      message:
        "Could not connect. Check NEBIUS_BASE_URL and whether the egress policy allows the host.",
    };
  }
  if (e instanceof OpenAI.APIError) {
    switch (e.status) {
      case 401:
        return {
          status: "401",
          message: "Unauthorized: NEBIUS_API_KEY was rejected (missing, revoked or wrong project).",
        };
      case 403:
        return {
          status: "403",
          message: "Forbidden: key lacks access to this resource/model, or region/account restriction.",
        };
      case 404:
        return {
          status: "404",
          message: "Not found: check NEBIUS_BASE_URL path (e.g. trailing /v1/) or the model ID.",
        };
      case 429:
        return { status: "429", message: "Rate limited or quota exhausted. Retry later; check credits." };
      default:
        return { status: String(e.status ?? "?"), message: "Provider returned an error." };
    }
  }
  return { status: "error", message: `Unexpected ${(e as Error)?.name ?? "error"}.` };
}

interface ChatResult {
  tier: string;
  model: string;
  ok: boolean;
  latencyMs: number | null;
  nonEmpty: boolean | null;
  finishReason: string | null;
  completionTokens: number | null;
  error: string | null;
}

async function chatOnce(client: OpenAI, tier: string, model: string): Promise<ChatResult> {
  const started = performance.now();
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      temperature: 0,
      // Small cap; reasoning-style models may spend tokens before content (see finish_reason).
      max_tokens: 32,
    });
    const latencyMs = Math.round(performance.now() - started);
    const choice = res.choices[0];
    const content = choice?.message?.content ?? "";
    return {
      tier,
      model,
      ok: true,
      latencyMs,
      nonEmpty: content.trim().length > 0,
      finishReason: choice?.finish_reason ?? null,
      completionTokens: res.usage?.completion_tokens ?? null,
      error: null,
    };
  } catch (e) {
    const { status, message } = describeApiError(e);
    return {
      tier,
      model,
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      nonEmpty: null,
      finishReason: null,
      completionTokens: null,
      error: `${status}: ${message}`,
    };
  }
}

function appendResults(md: string): void {
  if (!existsSync(RESULTS_PATH)) {
    writeFileSync(
      RESULTS_PATH,
      "# Spike results\n\nAppend-only log written by `eval/spike/*` scripts. No secrets, no response bodies.\n",
    );
  }
  appendFileSync(RESULTS_PATH, redact(md));
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const md: string[] = [`\n## ${startedAt} — 01-smoke (Token Factory)\n`];

  let env: NebiusEnv;
  try {
    env = getNebiusEnv();
  } catch (e) {
    if (e instanceof EnvError) {
      say(e.message); // names variables only
      md.push(`Env check failed: missing/invalid ${e.variables.join(", ")}.\n`);
      appendResults(md.join("\n"));
      return 1;
    }
    throw e;
  }
  secretsToRedact = [env.NEBIUS_API_KEY];
  const base = new URL(env.NEBIUS_BASE_URL);
  const baseDisplay = `${base.origin}${base.pathname}`;

  // a. Network
  say("== a. Network (no credentials) ==");
  const net = await checkNetwork();
  for (const r of net) say(`  ${r.host.padEnd(32)} ${r.reachable ? "reachable" : "BLOCKED"}  ${r.detail}`);
  md.push(`- Node ${process.version}; base URL: \`${baseDisplay}\``);
  md.push("\n### a. Network (unauthenticated GET)\n");
  md.push("| Host | Result | Detail |\n|---|---|---|");
  for (const r of net) md.push(`| ${r.host} | ${r.reachable ? "reachable" : "blocked"} | ${r.detail} |`);

  const client = new OpenAI({
    apiKey: env.NEBIUS_API_KEY,
    baseURL: env.NEBIUS_BASE_URL,
    timeout: TIMEOUT_MS,
    maxRetries: 0, // surface 429 directly in the spike
  });

  // b. Models list
  say("\n== b. Models list ==");
  md.push("\n### b. Models list\n");
  let nemotronIds: string[] = [];
  try {
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    nemotronIds = ids.filter((id) => /nemotron/i.test(id)).sort();
    say(`  total models: ${ids.length}`);
    say(`  nemotron models (${nemotronIds.length}):`);
    for (const id of nemotronIds) say(`    - ${id}`);
    md.push(`- OpenAI SDK \`models.list()\`: OK, ${ids.length} models total`);
    md.push(`- Nemotron IDs (${nemotronIds.length}):`);
    for (const id of nemotronIds) md.push(`  - \`${id}\``);
  } catch (e) {
    const { status, message } = describeApiError(e);
    say(`  FAILED ${status}: ${message}`);
    md.push(`- \`models.list()\` FAILED — ${status}: ${message}`);
    appendResults(md.join("\n") + "\n");
    return 1;
  }

  // c. One chat completion per configured tier
  say("\n== c. Chat completion per tier ==");
  md.push("\n### c. Chat completion (\"Reply with the single word: ok\", temperature 0, max_tokens 32)\n");
  const tiers: Array<[string, string | undefined]> = [
    ["FAST", env.NEMOTRON_MODEL_FAST],
    ["MID", env.NEMOTRON_MODEL_MID],
    ["DEEP", env.NEMOTRON_MODEL_DEEP],
  ];
  const configured = tiers.filter((t): t is [string, string] => t[1] !== undefined);
  if (configured.length === 0) {
    say("  NEMOTRON_MODEL_FAST / MID / DEEP are not set. Pick from the Nemotron IDs above,");
    say("  set them as environment variables (not in a committed file), and re-run pnpm spike:smoke.");
    md.push("Skipped: `NEMOTRON_MODEL_FAST|MID|DEEP` not set. Candidates listed in (b).");
    appendResults(md.join("\n") + "\n");
    return 0;
  }

  // Sequential so latencies are not distorted by concurrency.
  const results: ChatResult[] = [];
  for (const [tier, model] of configured) results.push(await chatOnce(client, tier, model));
  md.push("| Tier | Model | OK | Latency ms | Non-empty | finish_reason | completion tokens | Error |");
  md.push("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    say(
      `  ${r.tier.padEnd(4)} ${r.model}  ok=${r.ok} latency=${r.latencyMs}ms nonEmpty=${r.nonEmpty} finish=${r.finishReason}${r.error ? `  ${r.error}` : ""}`,
    );
    md.push(
      `| ${r.tier} | \`${r.model}\` | ${r.ok ? "yes" : "no"} | ${r.latencyMs ?? "–"} | ${r.nonEmpty ?? "–"} | ${r.finishReason ?? "–"} | ${r.completionTokens ?? "–"} | ${r.error ?? ""} |`,
    );
  }
  const unset = tiers.filter((t) => t[1] === undefined).map((t) => `NEMOTRON_MODEL_${t[0]}`);
  if (unset.length) md.push(`\nNot set (skipped): ${unset.join(", ")}`);
  appendResults(md.join("\n") + "\n");
  return results.every((r) => r.ok) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    // Never print the raw error: it may carry request config.
    say(`Smoke test crashed: ${(e as Error)?.name ?? "unknown error"}`);
    process.exit(1);
  },
);
