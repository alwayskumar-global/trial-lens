import type { ReactNode } from "react";
import { StatusGlyph, type CriterionStatus } from "../status/StatusGlyph";

function Chev() {
  return (
    <svg className="tl-strip__chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

export interface CriterionStripProps {
  status?: CriterionStatus;
  name: string;
  /** Verbatim criterion text. Never replaced by the plain-words version. */
  original: string;
  plain: string;
  fromInfo?: string | null;
  defaultOpen?: boolean;
  onAsk?: () => void;
}

/** Collapsible criterion: original wording | in plain words | from the fictional profile (+ "Ask the team" for unknown / judgment). */
export function CriterionStrip({ status = "meets", name, original, plain, fromInfo, defaultOpen = false, onAsk }: CriterionStripProps) {
  const ask = status === "unknown" || status === "judgment";
  return (
    <details className={"tl-strip tl-strip--" + status} open={defaultOpen || undefined}>
      <summary>
        <StatusGlyph status={status} withLabel />
        <span className="tl-strip__name">{name}</span>
        <Chev />
      </summary>
      <div className="tl-strip__body">
        <div className="tl-strip__col">
          <h4>Original wording</h4>
          <blockquote className="tl-strip__orig">{original}</blockquote>
        </div>
        <div className="tl-strip__col">
          <h4>In plain words</h4>
          <p className="tl-strip__plain">{plain}</p>
        </div>
        <div className="tl-strip__col">
          <h4>From the fictional profile</h4>
          {fromInfo ? (
            <span className="tl-chip" style={{ color: "var(--foreground)" }}>
              {fromInfo}
            </span>
          ) : (
            <span className="tl-chip" style={{ borderStyle: "dashed" }}>
              Not provided
            </span>
          )}
          {ask && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="tl-btn tl-btn--quiet" style={{ paddingInline: 0 }} onClick={onAsk}>
                Ask the team
              </button>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

export function CriterionGroup({ title, count, defaultOpen = false, children }: { title: string; count?: number; defaultOpen?: boolean; children?: ReactNode }) {
  return (
    <details className="tl-group" open={defaultOpen || undefined}>
      <summary>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 5l5 5-5 5" />
        </svg>
        {title}
        {count != null && " (" + count + ")"}
      </summary>
      <div className="tl-strips">{children}</div>
    </details>
  );
}
