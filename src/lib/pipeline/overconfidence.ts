// PROTOTYPE, NOT CONNECTED to /api/extract (a test enforces that). Pure post-extraction guards that can only LOWER confidence of a `known`
// fact; they never add a fact or change a value. Proposed from the recorded hardened-1/2 failures (docs/coverage-audit.md §5); they must pass
// fresh fictional cases (false-known reduction AND correctly stated facts staying `known`) before any wiring.
//   G1 inference guard: a `known` fact needs a cue word for its key in the text; otherwise it was inferred → dropped to `unknown`.
//      `age` and `sex` are exempt (a bare number or a pronoun states them); the receptor keys also accept "triple-negative"/"TNBC".
//   G2 hedge guard: a `known` fact whose cue sentence contains a hedge → `uncertain` (value kept).
import { CUES } from "@/lib/engine/atom-checks";
import type { FactKey } from "@/schema/vocabulary";

export interface GuardFact {
  key: FactKey;
  state: "known" | "uncertain" | "unknown";
  value: string | number | boolean | null;
  note?: string | null;
}
export type GuardChange = { key: FactKey; guard: "G1" | "G2"; from: "known"; to: "unknown" | "uncertain" };

const HEDGE = /\b(?:i think|i believe|i guess|maybe|perhaps|probably|not sure|unsure|i don'?t know|as far as i know|that i know of|about|approximately|around|roughly|or so|i'?m not certain|might)\b/i;
const TRIPLE_NEG = /triple[- ]negative|\bTNBC\b/i;
const G1_EXEMPT: ReadonlySet<FactKey> = new Set<FactKey>(["age", "sex"]);
const TRIPLE_NEG_KEYS: ReadonlySet<FactKey> = new Set<FactKey>(["er_status", "pr_status", "her2_status"]);

const sentences = (t: string): string[] => t.split(/(?<=[.!?;:])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const hasCue = (key: FactKey, s: string): boolean => CUES[key].test(s) || (TRIPLE_NEG_KEYS.has(key) && TRIPLE_NEG.test(s));

export function guardOverconfidence(text: string, facts: readonly GuardFact[]): { facts: GuardFact[]; changes: GuardChange[] } {
  const sents = sentences(text);
  const changes: GuardChange[] = [];
  const out = facts.map((f): GuardFact => {
    if (f.state !== "known") return f;
    const cued = sents.filter((s) => hasCue(f.key, s));
    if (!G1_EXEMPT.has(f.key) && cued.length === 0) {
      changes.push({ key: f.key, guard: "G1", from: "known", to: "unknown" });
      return { key: f.key, state: "unknown", value: null };
    }
    if (cued.some((s) => HEDGE.test(s))) {
      changes.push({ key: f.key, guard: "G2", from: "known", to: "uncertain" });
      return { ...f, state: "uncertain" };
    }
    return f;
  });
  return { facts: out, changes };
}
