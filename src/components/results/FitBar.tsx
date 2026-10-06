import type { Tier } from "../status/TierBadge";

const SEG: ReadonlyArray<{ k: Tier; n: string }> = [
  { k: "strong", n: "Strong potential" },
  { k: "possible", n: "Possible" },
  { k: "uncertain", n: "Uncertain" },
  { k: "mismatch", n: "Likely mismatch" },
];
const COL: Record<Tier, string> = {
  strong: "var(--tier-strong-fg)",
  possible: "var(--tier-possible-fg)",
  uncertain: "var(--tier-uncertain-fg)",
  mismatch: "var(--tier-mismatch-fg)",
};

export interface FitBarProps {
  counts: Record<Tier, number>;
  active?: Tier | null;
  onSelect?: (tier: Tier | null) => void;
}

/** Mobile fallback of the Fit Line: segmented bar with tappable per-tier counts that filter the list. */
export function FitBar({ counts, active, onSelect }: FitBarProps) {
  return (
    <div className="tl-fitbar" role="group" aria-label="Filter trials by fit">
      <div className="tl-fitbar__bar" aria-hidden="true">
        {SEG.map((s) => (
          <i key={s.k} style={{ flex: Math.max(counts[s.k], 0.4), background: COL[s.k], opacity: s.k === "mismatch" ? 0.5 : 1 }} />
        ))}
      </div>
      <div className="tl-fitbar__segs">
        {SEG.map((s) => (
          <button key={s.k} type="button" className={"tl-seg tl-seg--" + s.k} aria-pressed={active === s.k} onClick={() => onSelect?.(active === s.k ? null : s.k)}>
            <b>{counts[s.k]}</b>
            {s.n}
          </button>
        ))}
      </div>
    </div>
  );
}
