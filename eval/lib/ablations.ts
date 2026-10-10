import { createHash } from "node:crypto";
import { AblationSwitchesSchema, type AblationSwitches } from "./types";

export const DEFAULT_SWITCHES: AblationSwitches = { evaluator: "hybrid", tier: "MID", routing: true, verifier: true };

/** Canonical JSON (sorted keys) so the hash is stable across key order. */
export function configHash(c: AblationSwitches): string {
  const v = AblationSwitchesSchema.parse(c);
  const canon = JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))));
  return createHash("sha256").update(canon).digest("hex").slice(0, 12);
}

/** Cartesian grid over the listed values; unlisted switches keep their default. Order is deterministic. */
export function expandAblations(spec: { [K in keyof AblationSwitches]?: readonly AblationSwitches[K][] }): AblationSwitches[] {
  const keys = Object.keys(DEFAULT_SWITCHES) as Array<keyof AblationSwitches>;
  let grid: Array<Partial<AblationSwitches>> = [{}];
  for (const k of keys) {
    const vals = (spec[k] ?? [DEFAULT_SWITCHES[k]]) as readonly unknown[];
    grid = grid.flatMap((g) => vals.map((v) => ({ ...g, [k]: v })));
  }
  return grid.map((g) => AblationSwitchesSchema.parse(g));
}
