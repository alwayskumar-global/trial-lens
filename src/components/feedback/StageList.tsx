export interface Stage {
  label: string;
  state: "done" | "active" | "waiting";
  count?: string;
}

/** Vertical processing stage list with live counts. Announced politely to screen readers. */
export function StageList({ stages }: { stages: readonly Stage[] }) {
  return (
    <ol className="tl-stages" aria-live="polite">
      {stages.map((s, i) => (
        <li key={i} className={"tl-stage tl-stage--" + s.state} aria-current={s.state === "active" ? "step" : undefined}>
          <span className="tl-stage__mark">
            {s.state === "done" && (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" style={{ color: "var(--tier-strong-fg)" }} aria-label="Done">
                <circle cx="12" cy="12" r="9" fill="currentColor" />
                <path d="M8 12.3l2.8 2.8L16 9.5" stroke="var(--tier-strong-bg)" />
              </svg>
            )}
            {s.state === "active" && (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--primary)" strokeWidth="1.75" strokeLinecap="round" aria-label="In progress">
                <circle cx="12" cy="12" r="9" opacity=".3" />
                <path d="M12 3a9 9 0 019 9">
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="2.4s" repeatCount="indefinite" />
                </path>
              </svg>
            )}
            {s.state === "waiting" && (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--border-strong)" strokeWidth="1.75" aria-label="Waiting">
                <circle cx="12" cy="12" r="9" strokeDasharray="3.2 3.2" />
              </svg>
            )}
          </span>
          <span>{s.label}</span>
          <span className="tl-stage__count">{s.count}</span>
        </li>
      ))}
    </ol>
  );
}
