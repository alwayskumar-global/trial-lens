import { describe, expect, it } from "vitest";
import { DOT_PITCH, FIT_ZONES, fitLinePositions } from "./fit-line";

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

  it("wraps into rows past the columns that fit the zone", () => {
    const trials = Array.from({ length: 30 }, (_, i) => ({ id: "t" + i, tier: "uncertain" as const }));
    const { pos, height } = fitLinePositions(trials);
    expect(pos.t0!.top).not.toBe(pos.t29!.top);
    expect(height).toBeGreaterThan(96);
  });

  it("contains 30 dots in any single tier at desktop widths (no overlap, inside zone and track)", () => {
    for (const px of [900, 1100, 1400]) {
      for (const z of FIT_ZONES) {
        const trials = Array.from({ length: 30 }, (_, i) => ({ id: "t" + i, tier: z.k }));
        const { pos, starts, height } = fitLinePositions(trials, px);
        const pts = trials.map((t) => {
          const m = /calc\(50% \+ (-?[\d.]+)px\)/.exec(pos[t.id]!.top)!;
          return { x: (parseFloat(pos[t.id]!.left) / 100) * px, y: height / 2 + parseFloat(m[1]!) };
        });
        const x0 = (starts[z.k] / 100) * px, x1 = x0 + (z.w / 100) * px;
        for (const p of pts) {
          expect(p.x - 6).toBeGreaterThanOrEqual(x0);
          expect(p.x + 6).toBeLessThanOrEqual(x1);
          expect(p.y - 6).toBeGreaterThanOrEqual(0);
          expect(p.y + 6).toBeLessThanOrEqual(height);
        }
        for (let i = 0; i < pts.length; i++)
          for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)).toBeGreaterThanOrEqual(DOT_PITCH - 0.01);
      }
    }
  });
});
