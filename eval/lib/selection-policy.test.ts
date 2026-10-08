import { describe, expect, it } from "vitest";
import { chooseInRankOrder, rankKey, rankPool, retained } from "./selection-policy";

const ids = Array.from({ length: 500 }, (_, i) => `NCT${String(10_000_000 + i * 7)}`);

describe("hash-ranked-v1 selection policy", () => {
  it("is deterministic and independent of the input order", () => {
    expect(rankPool(ids)).toEqual(rankPool([...ids].reverse()));
    expect(rankKey("NCT00000001")).toBe(rankKey("NCT00000001"));
    expect(new Set(rankPool(ids)).size).toBe(ids.length);
  });
  it("is stable under pool churn: removing or adding a few trials moves almost nothing in the top 30", () => {
    const top = rankPool(ids).slice(0, 30);
    const churned = [...ids.slice(40), ...Array.from({ length: 40 }, (_, i) => `NCT${String(90_000_000 + i)}`)]; // 40 leave, 40 join (8%)
    const next = rankPool(churned).slice(0, 30);
    expect(retained(top, next)).toBeGreaterThan(0.6); // only the leavers/joiners that fall inside the top 30 change it
    // an unsorted window of the same size would retain roughly nothing when the whole window rotates; here rank does not rotate
    const leavers = new Set(ids.slice(0, 40));
    expect(top.filter((x) => !leavers.has(x)).every((x) => next.includes(x))).toBe(true); // survivors always stay selected
  });
  it("prefilter runs in rank order and takes the first n that pass", () => {
    const details = rankPool(ids).slice(0, 10).map((id, i) => ({ nct_id: id, ok: i % 2 === 0 }));
    expect(chooseInRankOrder(details, (t) => t.ok, 3).map((t) => t.nct_id)).toEqual([details[0]!.nct_id, details[2]!.nct_id, details[4]!.nct_id]);
  });
  it("retained() handles empty and full overlap", () => {
    expect(retained([], ["a"])).toBe(1);
    expect(retained(["a", "b"], ["a", "b", "c"])).toBe(1);
    expect(retained(["a", "b"], ["c"])).toBe(0);
  });
});
