import { describe, expect, it } from "vitest";
import { FACT_KEYS } from "@/schema/vocabulary";
import { add, countProvided, emptyDrafts, enumOptions, FACT_LABEL, parseExtractResponse, remove, setSure, setValue, toRunProfile, validate, valueLabel } from "./facts";

const M = { needValue: "need", badNumber: "num", outOfRange: "range" };
const body = (facts: Record<string, unknown>) => ({ profile: { facts }, extract_token: "tok" });
const base = () => parseExtractResponse(body({ age: { key: "age", state: "known", value: 52 }, sex: { key: "sex", state: "uncertain", value: "female" }, stage: { key: "stage", state: "unknown" } }))!.drafts;

describe("visitor facts model", () => {
  it("every vocabulary key has a plain-language label", () => {
    for (const k of FACT_KEYS) expect(FACT_LABEL[k], k).toBeTruthy();
  });
  it("parses a server extraction into exhaustive drafts; malformed bodies are null", () => {
    const d = base();
    expect(Object.keys(d)).toHaveLength(FACT_KEYS.length);
    expect(d.age).toEqual({ key: "age", state: "known", value: 52 });
    expect(d.sex.state).toBe("uncertain");
    expect(d.stage.state).toBe("unknown");
    expect(parseExtractResponse({})).toBeNull();
    expect(parseExtractResponse(body({ age: { key: "nope", state: "known", value: 1 } }))).toBeNull();
    expect(parseExtractResponse({ profile: { facts: {} } })).toBeNull(); // no token
  });
  it("edit, mark unsure, remove and add each change the right draft and nothing else", () => {
    let d = base();
    d = setValue(d, "age", "50");
    expect(d.age.value).toBe(50);
    d = setSure(d, "age", false);
    expect(d.age.state).toBe("uncertain");
    d = remove(d, "sex");
    expect(d.sex).toEqual({ key: "sex", state: "unknown" });
    d = add(d, "stage");
    expect(d.stage).toEqual({ key: "stage", state: "known" });
    d = setValue(d, "stage", "III");
    expect(d.stage.value).toBe("III");
    d = setValue(d, "age", "");
    expect(d.age.value).toBeUndefined();
    expect(setValue(emptyDrafts(), "age", "5").age.state).toBe("unknown"); // unknown facts take no value
    expect(countProvided(d)).toBe(2);
  });
  it("validates like the server: known needs a value of the right type; numbers need range; uncertain may be empty", () => {
    let d = base();
    expect(validate(d, M)).toEqual({});
    d = setValue(d, "age", "");
    expect(validate(d, M).age).toBe("need");
    d = setValue(d, "age", "abc");
    expect(validate(d, M).age).toBe("num");
    d = setValue(d, "age", "250");
    expect(validate(d, M).age).toBe("range");
    d = setSure(setValue(d, "age", ""), "age", false);
    expect(validate(d, M).age).toBeUndefined();
    d = setValue(add(d, "pregnant"), "pregnant", "");
    expect(validate(d, M).pregnant).toBe("need");
    d = setValue(d, "pregnant", "true");
    expect(d.pregnant.value).toBe(true);
    expect(validate(d, M).pregnant).toBeUndefined();
  });
  it("the run profile is exhaustive, unknown carries no value, and never carries notes or labels", () => {
    const p = toRunProfile(setValue(base(), "age", "61"));
    expect(Object.keys(p.facts)).toHaveLength(FACT_KEYS.length);
    expect(p.facts.age).toEqual({ key: "age", state: "known", value: 61 });
    expect(p.facts.stage).toEqual({ key: "stage", state: "unknown" });
    expect(JSON.stringify(p)).not.toMatch(/note|provenance|edited/);
  });
  it("value labels are readable", () => {
    expect(valueLabel("her2_status", "positive")).toBe("Positive");
    expect(valueLabel("pregnant", false)).toBe("No");
    expect(valueLabel("age", 52)).toBe("52 years");
    expect(enumOptions("stage").map((o) => o.value)).toEqual(["0", "I", "II", "III", "IV"]);
  });
});
