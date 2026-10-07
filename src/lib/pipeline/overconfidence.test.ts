// PROTOTYPE tests with hand-written inputs (no model output). These are NOT the fresh fictional validation required before wiring.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guardOverconfidence, type GuardFact } from "./overconfidence";

const known = (key: GuardFact["key"], value: GuardFact["value"]): GuardFact => ({ key, state: "known", value });
const guard = (text: string, ...facts: GuardFact[]) => guardOverconfidence(text, facts);

describe("G1 inference guard", () => {
  it("drops a known fact with no cue in the text (taxane is not 'chemotherapy' stated)", () => {
    const r = guard("I had a taxane and trastuzumab.", known("prior_chemo_any", true), known("prior_taxane", true));
    expect(r.facts.find((f) => f.key === "prior_chemo_any")).toMatchObject({ state: "unknown", value: null });
    expect(r.facts.find((f) => f.key === "prior_taxane")?.state).toBe("known");
  });
  it("drops a CNS fact the text never mentions", () => {
    expect(guard("It spread to my bones and liver.", known("cns_mets", "none")).facts[0]!.state).toBe("unknown");
  });
  it("keeps correctly stated facts: age and sex without cue words, receptors via 'triple-negative'", () => {
    const r = guard("I'm 49. She has triple-negative breast cancer.", known("age", 49), known("sex", "female"), known("er_status", "negative"), known("her2_status", "negative"));
    expect(r.changes).toEqual([]);
  });
  it("keeps explicitly stated negatives", () => {
    const r = guard("I have no history of heart disease and I am not pregnant or breastfeeding.", known("cardiac_disease", "none"), known("pregnant", false), known("lactating", false));
    expect(r.changes).toEqual([]);
  });
});

describe("G2 hedge guard", () => {
  it("lowers a hedged known fact to uncertain and keeps its value", () => {
    const r = guard("No heart problems that I know of.", known("cardiac_disease", "none"));
    expect(r.facts[0]).toMatchObject({ state: "uncertain", value: "none" });
  });
  it("lowers 'I believe ... positive'", () => {
    expect(guard("I believe the tumor tested positive for estrogen receptors.", known("er_status", "positive")).facts[0]!.state).toBe("uncertain");
  });
  it("does not lower a fact whose cue sentence is plain, even if another sentence hedges", () => {
    const r = guard("The pathology said ER positive. I'm not sure about HER2.", known("er_status", "positive"));
    expect(r.changes).toEqual([]);
  });
  it("known limitation: 'about' lowers a stated fact in the same sentence (documented cost)", () => {
    expect(guard("I have HER2 positive disease, about 3 years now.", known("her2_status", "positive")).facts[0]!.state).toBe("uncertain");
  });
});

describe("invariants", () => {
  it("only lowers: never adds a fact, never changes a value, leaves uncertain/unknown alone, idempotent", () => {
    const input: GuardFact[] = [known("cardiac_disease", "none"), { key: "stage", state: "uncertain", value: "II" }, { key: "ecog", state: "unknown", value: null }];
    const text = "No heart problems that I know of. Maybe stage II.";
    const once = guardOverconfidence(text, input);
    expect(once.facts).toHaveLength(input.length);
    expect(once.facts.map((f) => f.key)).toEqual(input.map((f) => f.key));
    expect(once.facts[1]).toEqual(input[1]);
    expect(once.facts[2]).toEqual(input[2]);
    expect(once.facts[0]!.value).toBe("none");
    expect(guardOverconfidence(text, once.facts).changes).toEqual([]);
  });
  it("is NOT connected to the extraction path (needs fresh fictional validation first)", () => {
    for (const f of readdirSync("src/lib/pipeline").filter((x) => x.endsWith(".ts") && !x.includes("overconfidence") && !x.endsWith(".test.ts"))) {
      expect(readFileSync(`src/lib/pipeline/${f}`, "utf8")).not.toMatch(/overconfidence/);
    }
  });
});
