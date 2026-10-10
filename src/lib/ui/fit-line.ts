// Pure geometry for the Fit Line (design: guidelines/handoff.md "Fit Line animation").
// Zones left→right: Likely mismatch 16% · Uncertain 20% · Possible 30% · Strong potential 34%.
// Dot positions are a per-zone pixel-pitch grid (columns derived from the zone width) so the same key re-renders into a new zone and CSS glides it.
import type { Tier } from "@/components/status/TierBadge";

export interface FitZone {
  k: Tier;
  n: string;
  w: number;
}
export const FIT_ZONES: readonly FitZone[] = [
  { k: "mismatch", n: "Likely mismatch", w: 16 },
  { k: "uncertain", n: "Uncertain", w: 20 },
  { k: "possible", n: "Possible", w: 30 },
  { k: "strong", n: "Strong potential", w: 34 },
];

export interface FitTrial {
  id: string;
  tier: Tier;
}

/** One visible dot size for every tier (CSS `.tl-dot`); the pitch leaves a gap so neighbours never touch. */
export const DOT_PX = 12;
export const DOT_PITCH = 22;
const ZONE_PAD = 8;
const MIN_TRACK = 96;
const TRACK_PAD = 28;

/**
 * Per-zone grid on a fixed pixel pitch: columns = what fits the zone's pixel width, rows = however many that needs, and the
 * track height grows to contain the tallest zone (so any count of dots in any tier stays inside the track).
 * `trackPx` is the measured track width (default: a typical desktop width).
 */
export function fitLinePositions(
  trials: readonly FitTrial[],
  trackPx = 1000,
): { pos: Record<string, { left: string; top: string }>; starts: Record<Tier, number>; height: number } {
  let start = 0;
  let maxRows = 1;
  const pos: Record<string, { left: string; top: string }> = {};
  const starts = {} as Record<Tier, number>;
  for (const z of FIT_ZONES) {
    const items = trials.filter((t) => t.tier === z.k);
    const zonePx = (z.w / 100) * trackPx;
    const cols = Math.max(1, Math.floor((zonePx - 2 * ZONE_PAD) / DOT_PITCH));
    const rows = Math.ceil(items.length / cols) || 1;
    maxRows = Math.max(maxRows, rows);
    const used = Math.min(cols, items.length) || 1;
    items.forEach((t, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const dx = (c - (used - 1) / 2) * DOT_PITCH;
      pos[t.id] = { left: start + z.w / 2 + (dx / trackPx) * 100 + "%", top: "calc(50% + " + (r - (rows - 1) / 2) * DOT_PITCH + "px)" };
    });
    starts[z.k] = start;
    start += z.w;
  }
  return { pos, starts, height: Math.max(MIN_TRACK, maxRows * DOT_PITCH + TRACK_PAD) };
}
