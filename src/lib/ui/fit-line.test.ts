import { describe, expect, it } from "vitest";
import { FIT_ZONES, fitLinePositions } from "./fit-line";

describe("fitLinePositions", () => {
  it("zone widths sum to 100", () => {
    expect(FIT_ZONES.reduce((a, z) => a + z.w, 0)).toBe(100);
  });

  it("places each dot inside its tier's zone", () => {
    const { pos, starts } = fitLinePositions([
      { id: "a", tier: "uncertain" },
      { id: "b", tier: "strong" },
    ]);
    const left = (id: string) => parseFloat(pos[id]!.left);
    expect(left("a")).toBeGreaterThan(starts.uncertain);
    expect(left("a")).toBeLessThan(starts.uncertain + 20);
    expect(left("b")).toBeGreaterThan(starts.strong);
  });

  it("moves a dot to the new zone when its tier changes (same key)", () => {
    const before = fitLinePositions([{ id: "a", tier: "uncertain" }]).pos.a!;
    const after = fitLinePositions([{ id: "a", tier: "possible" }]).pos.a!;
    expect(parseFloat(after.left)).toBeGreaterThan(parseFloat(before.left));
  });

  it("wraps into rows past the zone's column count", () => {
    const trials = Array.from({ length: 5 }, (_, i) => ({ id: "t" + i, tier: "uncertain" as const }));
    const { pos } = fitLinePositions(trials);
    expect(pos.t0!.top).not.toBe(pos.t4!.top);
  });
});
