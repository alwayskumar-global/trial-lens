export type Tier = "strong" | "possible" | "uncertain" | "mismatch";

export const TIER_LABELS: Record<Tier, string> = {
  strong: "Strong potential match",
  possible: "Possible match",
  uncertain: "Uncertain",
  mismatch: "Likely mismatch",
};

export interface TierBadgeProps {
  tier?: Tier;
  label?: string;
}

export function TierBadge({ tier = "strong", label }: TierBadgeProps) {
  return (
    <span className={"tl-badge tl-badge--" + tier}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        {tier === "strong" && (
          <>
            <circle cx="8" cy="8" r="6.5" />
            <circle cx="8" cy="8" r="3" fill="currentColor" />
          </>
        )}
        {tier === "possible" && <circle cx="8" cy="8" r="4.5" fill="currentColor" />}
        {tier === "uncertain" && <circle cx="8" cy="8" r="6.2" strokeDasharray="2.6 2.6" />}
        {tier === "mismatch" && <circle cx="8" cy="8" r="3.2" />}
      </svg>
      {label ?? TIER_LABELS[tier]}
    </span>
  );
}
