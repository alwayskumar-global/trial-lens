import { describe, expect, it } from "vitest";
import {
  ASK_COSTS,
  FACT_KEYS,
  FACT_TYPES,
  FactKeySchema,
  FactSchema,
  ParsedCriterionSchema,
  PatientProfileSchema,
  SseEventSchema,
  VOCABULARY,
  type Fact,
  type FactKey,
} from "./index";

function blankProfileFacts(): Record<FactKey, Fact> {
  return Object.fromEntries(FACT_KEYS.map((k) => [k, { key: k, state: "unknown" }])) as Record<
    FactKey,
    Fact
  >;
}

describe("fact vocabulary", () => {
  it("every key is unique", () => {
    const keys = VOCABULARY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(VOCABULARY.map((e) => [e.key, e] as const))("%s has a valid type and ask_cost", (_k, e) => {
    expect(FACT_TYPES).toContain(e.type);
    if (e.askable) {
      expect(ASK_COSTS).toContain(e.ask_cost);
    } else {
      expect(e.ask_cost).toBeNull();
    }
    if (e.type === "enum") {
      const values = "values" in e ? e.values : [];
      expect(values.length).toBeGreaterThan(0);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("matches SCHEMA.md key count (19 core + 16 breast)", () => {
    expect(VOCABULARY.filter((e) => e.pack === "core")).toHaveLength(19);
    expect(VOCABULARY.filter((e) => e.pack === "breast")).toHaveLength(16);
  });

  it("FactKeySchema accepts every vocabulary key and rejects others", () => {
    for (const k of FACT_KEYS) expect(FactKeySchema.safeParse(k).success).toBe(true);
    expect(FactKeySchema.safeParse("tnbc").success).toBe(false); // derived, not a vocabulary key
  });
});

describe("PatientProfile", () => {
  it("accepts a profile with every key present", () => {
    expect(PatientProfileSchema.safeParse({ facts: blankProfileFacts() }).success).toBe(true);
  });

  it("rejects a profile missing a vocabulary key", () => {
    const facts: Partial<Record<FactKey, Fact>> = blankProfileFacts();
    delete facts.her2_status;
    expect(PatientProfileSchema.safeParse({ facts }).success).toBe(false);
  });

  it("rejects a fact whose key does not match its record key", () => {
    const facts = blankProfileFacts();
    facts.age = { key: "sex", state: "unknown" };
    expect(PatientProfileSchema.safeParse({ facts }).success).toBe(false);
  });
});

describe("ParsedCriterion / SseEvent smoke", () => {
  it("parses a typed criterion", () => {
    const r = ParsedCriterionSchema.safeParse({
      id: "NCT00000000:inclusion:0",
      nct_id: "NCT00000000",
      type: "inclusion",
      category: "organ_function",
      original_text: "LVEF >= 50%",
      fact_key: "lvef_percent",
      operator: "gte",
      value: 50,
      unit: "%",
      depends_on: [],
      scoring: true,
    });
    expect(r.success).toBe(true);
  });

  it("defaults an absent unit to null and accepts an explicit null", () => {
    const base = {
      id: "NCT00000000:inclusion:1",
      nct_id: "NCT00000000",
      type: "inclusion",
      category: "lab",
      original_text: "ANC >= 1500",
      fact_key: "anc",
      operator: "gte",
      value: 1500,
      depends_on: [],
      scoring: true,
    };
    const absent = ParsedCriterionSchema.parse(base);
    expect(absent.unit).toBeNull();
    expect(ParsedCriterionSchema.parse({ ...base, unit: null }).unit).toBeNull();
  });

  it("rejects an unknown SSE event type", () => {
    expect(SseEventSchema.safeParse({ type: "progress" }).success).toBe(false);
    expect(SseEventSchema.safeParse({ type: "done", replay: false }).success).toBe(true);
  });
});

describe("Fact: known requires a vocabulary-valid value", () => {
  it("rejects known without a value", () => {
    expect(FactSchema.safeParse({ key: "ecog", state: "known" }).success).toBe(false);
  });
  it("accepts known with a conforming value", () => {
    expect(FactSchema.safeParse({ key: "ecog", state: "known", value: "1" }).success).toBe(true);
    expect(FactSchema.safeParse({ key: "age", state: "known", value: 57 }).success).toBe(true);
    expect(FactSchema.safeParse({ key: "pregnant", state: "known", value: false }).success).toBe(true);
  });
  it("rejects known with a non-conforming value", () => {
    expect(FactSchema.safeParse({ key: "ecog", state: "known", value: "9" }).success).toBe(false);
    expect(FactSchema.safeParse({ key: "age", state: "known", value: "old" }).success).toBe(false);
    expect(FactSchema.safeParse({ key: "age", state: "known", value: Number.NaN }).success).toBe(false);
    expect(FactSchema.safeParse({ key: "pregnant", state: "known", value: "no" }).success).toBe(false);
  });
  it("unknown must not carry a value; uncertain may", () => {
    expect(FactSchema.safeParse({ key: "ecog", state: "unknown", value: "1" }).success).toBe(false);
    expect(FactSchema.safeParse({ key: "ecog", state: "unknown" }).success).toBe(true);
    expect(FactSchema.safeParse({ key: "ecog", state: "uncertain", value: "1", note: "approximate" }).success).toBe(true);
  });
  it("profile rejects a known fact without a value", () => {
    const facts = blankProfileFacts();
    facts.ecog = { key: "ecog", state: "known" };
    expect(PatientProfileSchema.safeParse({ facts }).success).toBe(false);
  });
});
