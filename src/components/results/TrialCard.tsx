import { StatusGlyph, type CriterionStatus } from "../status/StatusGlyph";
import { TierBadge, type Tier } from "../status/TierBadge";

export interface TrialCardProps {
  title: string;
  tier?: Tier;
  site?: string;
  distance?: string;
  phase?: string;
  why?: ReadonlyArray<{ status: CriterionStatus; text: string }>;
  unknown?: string;
  reason?: string;
  nctId?: string;
  updated?: boolean;
  /** Shows the "Sample data" tag. The design labels every fictional entry. */
  sample?: boolean;
  onOpen?: () => void;
}

export function TrialCard({ title, tier = "strong", site, distance, phase, why = [], unknown, reason, nctId, updated = false, sample = true, onOpen }: TrialCardProps) {
  return (
    <article className={"tl-card" + (updated ? " tl-card--updated" : "")}>
      {updated && <span className="tl-updated">Updated</span>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <TierBadge tier={tier} />
        {sample && <span className="tl-sample">Sample data</span>}
      </div>
      <h3 className="tl-card__title">{title}</h3>
      <div className="tl-card__meta">
        {phase && <span className="tl-chip">{phase}</span>}
        {site && <span>{site}</span>}
        {distance && (
          <>
            <span aria-hidden="true">·</span>
            <span>{distance}</span>
          </>
        )}
      </div>
      {why.length > 0 && (
        <div>
          <p className="tl-card__label">Why it surfaced</p>
          <ul className="tl-card__why">
            {why.map((w, i) => (
              <li key={i}>
                <StatusGlyph status={w.status} />
                <span>{w.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {reason && <p style={{ margin: 0, color: "var(--muted-foreground)", font: "400 15px/22px var(--font-sans)" }}>{reason}</p>}
      {unknown && (
        <div className="tl-card__unknown">
          <StatusGlyph status="unknown" size={18} />
          <span>
            <strong>Biggest unknown:</strong> {unknown}
          </span>
        </div>
      )}
      <div className="tl-card__foot">
        {nctId && (
          <span className="tl-mono" style={{ color: "var(--muted-foreground)" }}>
            {nctId}
          </span>
        )}
        <button type="button" className="tl-btn tl-btn--secondary" onClick={onOpen}>
          See eligibility details
        </button>
      </div>
    </article>
  );
}
