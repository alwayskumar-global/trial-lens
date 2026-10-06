// Pure geometry for the Fit Line (design: guidelines/handoff.md "Fit Line animation").
// Zones left→right: Likely mismatch 16% · Uncertain 20% · Possible 30% · Strong potential 34%.
// Dot positions are a per-zone grid (cols 10/4/5/4) so the same key re-renders into a new zone and CSS glides it.
import type { Tier } from "@/components/status/TierBadge";

export interface FitZone {
  k: Tier;
  n: string;
  w: number;
  cols: number;
}
export const FIT_ZONES: readonly FitZone[] = [
  { k: "mismatch", n: "Likely mismatch", w: 16, cols: 10 },
  { k: "uncertain", n: "Uncertain", w: 20, cols: 4 },
  { k: "possible", n: "Possible", w: 30, cols: 5 },
  { k: "strong", n: "Strong potential", w: 34, cols: 4 },
];

export interface FitTrial {
  id: string;
  tier: Tier;
}

export function fitLinePositions(trials: readonly FitTrial[]): { pos: Record<string, { left: string; top: string }>; starts: Record<Tier, number> } {
  let start = 0;
  const pos: Record<string, { left: string; top: string }> = {};
  const starts = {} as Record<Tier, number>;
  for (const z of FIT_ZONES) {
    const items = trials.filter((t) => t.tier === z.k);
    const rows = Math.ceil(items.length / z.cols) || 1;
    const gap = z.k === "mismatch" ? 14 : 24;
    items.forEach((t, i) => {
      const c = i % z.cols;
      const r = Math.floor(i / z.cols);
      pos[t.id] = { left: start + z.w * ((c + 0.5) / z.cols) + "%", top: "calc(50% + " + (r - (rows - 1) / 2) * gap + "px)" };
    });
    starts[z.k] = start;
    start += z.w;
  }
  return { pos, starts };
}
