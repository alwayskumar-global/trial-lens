import type { ReactNode } from "react";

/** Persistent not-an-eligibility-confirmation notice for Results and Detail. Default copy is the approved safety wording for the prepared fictional profile. */
export function SafetyBanner({ children }: { children?: ReactNode }) {
  return (
    <aside className="tl-safety" aria-label="Demo notice">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M10 9v4.5M10 6.5v.1" />
      </svg>
      <span>{children ?? "TrialLens compares public trial criteria with the prepared fictional profile. It can't confirm eligibility. Only a study team can."}</span>
    </aside>
  );
}
