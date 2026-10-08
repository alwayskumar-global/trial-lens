import { describe, expect, it } from "vitest";
import { classifyScope, comparePolicy, jaccard, overlapCount, samePosition, type Snapshot } from "./selection-compare";

describe("classifyScope", () => {
  const base = { ancestors: [] as string[], conditions: [] as string[], studyType: "INTERVENTIONAL" };
  it("breast-only is breast_specific; breast plus another MeSH disease is breast_with_other; no breast signal at all is no_breast_signal", () => {
    expect(classifyScope({ ...base, mesh: ["Triple Negative Breast Neoplasms"], ancestors: ["Breast Neoplasms", "Breast Diseases"] })).toBe("breast_specific");
    expect(classifyScope({ ...base, mesh: ["Neoplasm Metastasis", "Breast Neoplasms"] })).toBe("breast_with_other");
    expect(classifyScope({ ...base, mesh: ["Lung Neoplasms"], ancestors: ["Neoplasms by Site"], conditions: ["NSCLC"] })).toBe("no_breast_signal");
    expect(classifyScope({ ...base, mesh: [], conditions: ["Menopause", "Obesity"] })).toBe("no_breast_signal");
  });
  it("a new study with no MeSH mapping but a breast condition string is still breast-specific, not out of scope", () => {
    expect(classifyScope({ ...base, mesh: [], conditions: ["HER2-positive Early Breast Cancer"] })).toBe("breast_specific");
    expect(classifyScope({ ...base, mesh: [], conditions: ["TNBC", "Adjuvant Therapy"] })).toBe("breast_specific");
  });
  it("breast plus a non-breast MeSH disease stays breast_with_other even when the breast signal is only in the condition text", () => {
    expect(classifyScope({ ...base, mesh: ["Prostatic Neoplasms"], conditions: ["Breast Adenocarcinoma", "Prostate Cancer"] })).toBe("breast_with_other");
  });
});

describe("snapshot comparison", () => {
  const snap = (ts: string, order: string[], sel: string[]): Snapshot => ({ taken_at: ts, data_timestamp: ts, policies: { p: { policy: "p", order, selected_union: sel } } });
  it("overlap, jaccard and same-position", () => {
    expect(overlapCount(["a", "b", "c"], ["b", "c", "d"])).toBe(2);
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    expect(samePosition(["a", "b", "c"], ["a", "c", "b"])).toBe(1);
    expect(jaccard([], [])).toBe(1);
  });
  it("comparePolicy reports kept counts and whether the data refresh timestamp differs", () => {
    const c = comparePolicy(snap("T0", ["a", "b", "c", "d"], ["a", "b"]), snap("T1", ["b", "a", "e", "f"], ["b", "e"]), "p");
    expect(c).toEqual({ policy: "p", refresh_changed: true, selected: { before: 2, after: 2, kept: 1, jaccard: 0.333 }, top120: { kept: 2, same_position: 0 } });
    expect(comparePolicy(snap("T0", ["a"], ["a"]), snap("T0", ["a"], ["a"]), "p").refresh_changed).toBe(false);
    expect(() => comparePolicy(snap("T0", [], []), snap("T1", [], []), "missing")).toThrow();
  });

  it("refuses to compare snapshots taken with different scopes", () => {
    const a = snap("T0", ["a"], ["a"]), b = { ...snap("T1", ["a"], ["a"]), scope_filter: "interventional" };
    expect(() => comparePolicy(a, b, "p")).toThrow("scope_mismatch");
    expect(() => comparePolicy({ ...a, scope_filter: "all" }, snap("T1", ["a"], ["a"]), "p")).not.toThrow();
  });
});
