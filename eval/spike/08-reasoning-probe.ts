// Phase 1 repair probe: do Nemotron models spend the output budget on reasoning, and can that be
// controlled through Token Factory? Prints token counts / finish_reason / validity only (no bodies).
// Run: pnpm spike:reasoning
import { getNebiusEnv } from "../../src/lib/env";
import { buildClauseBatchUserPrompt, buildClauseParseSystemPrompt } from "../../src/prompts/clause-parse";
import { makeClauseBatchSchema } from "../../src/schema/clause";
import { appendResults, cohortCriteria, loadFixture } from "./lib";
import { z } from "zod";
import { makeClient } from "./llm";

type Variant = { name: string; extra: Record<string, unknown>; sysPrefix?: string };
const VARIANTS: Variant[] = [
  { name: "default (thinking on)", extra: {} },
  { name: "chat_template_kwargs.enable_thinking=false", extra: { chat_template_kwargs: { enable_thinking: false } } },
  { name: "reasoning_effort=low", extra: { reasoning_effort: "low" } },
  { name: "system '/no_think'", extra: {}, sysPrefix: "/no_think\n" },
];

async function main(): Promise<void> {
  const env = getNebiusEnv();
  const model = env.NEMOTRON_MODEL_MID!;
  const client = makeClient();
  const crit = cohortCriteria(loadFixture()).slice(40, 55); // 15 criteria, fixed
  const texts = crit.map((c) => c.text);
  const schema = makeClauseBatchSchema(texts);
  const user = buildClauseBatchUserPrompt(crit.map((c, i) => ({ index: i, type: c.type, text: c.text })));
  const rows: string[] = [];
  for (const v of VARIANTS) {
    const t0 = performance.now();
    try {
      const res = await client.chat.completions.create({
        model, temperature: 0, max_tokens: 16384, response_format: { type: "json_schema", json_schema: { name: "b", strict: true, schema: z.toJSONSchema(schema, { io: "input" }) } },
        messages: [{ role: "system", content: (v.sysPrefix ?? "") + buildClauseParseSystemPrompt() }, { role: "user", content: user }],
        ...v.extra,
      } as never);
      const ch = res.choices[0]!;
      const content = ch.message?.content ?? "";
      const reasoningChars = String((ch.message as unknown as { reasoning_content?: string; reasoning?: string }).reasoning_content ?? (ch.message as unknown as { reasoning?: string }).reasoning ?? "").length;
      let valid = false;
      try { valid = schema.safeParse(JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim())).success; } catch { /* invalid */ }
      const row = `| ${v.name} | ${res.usage?.completion_tokens} | ${ch.finish_reason} | ${content.length} | ${reasoningChars} | ${valid} | ${Math.round(performance.now() - t0)} |`;
      rows.push(row); console.log(row);
    } catch (e) {
      const row = `| ${v.name} | – | error HTTP ${(e as { status?: number }).status ?? "?"} | – | – | – | ${Math.round(performance.now() - t0)} |`;
      rows.push(row); console.log(row);
    }
  }
  appendResults(`\n## ${new Date().toISOString()} — 08-reasoning-probe (MID, 15 fixed criteria, json_schema strict, max_tokens 16384; single run each, so directional only)\n\n| Variant | completion tokens | finish_reason | content chars | reasoning chars | valid (batch schema) | ms |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`);
}
main().catch((e: unknown) => { console.error(`probe failed: ${(e as Error)?.message?.slice(0, 100)}`); process.exit(1); });
