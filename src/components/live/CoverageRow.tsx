import { coverage, type RunState } from "@/lib/live/model";

/** assessed / not analyzed this run / couldn't be read: always three separate figures (zero included). */
export function CoverageRow({ run, replay }: { run: Pick<RunState, "counts" | "trials">; replay: boolean }) {
  const c = coverage(run);
  const { discovered, filtered, selected } = run.counts;
  const parts = [
    discovered !== undefined && `${discovered} recruiting studies found`,
    filtered !== undefined && `${filtered} fit ${replay ? "this profile's" : "your"} age and sex`,
    selected !== undefined && `${selected} selected for review`,
  ].filter(Boolean);
  return (
    <div className="stack g8">
      <div className="summary" style={{ gap: "8px 12px" }}>
        <span className="eyebrow" style={{ margin: 0, minWidth: 74 }}>
          Coverage
        </span>
        <span className="tl-chip" style={{ color: "var(--foreground)" }}>
          {c.assessed} assessed
        </span>
        <span className="tl-chip tl-chip--dashed" style={{ color: "var(--foreground)" }}>
          {c.pending} not analyzed this run
        </span>
        <span className="tl-chip tl-chip--dashed" style={{ color: "var(--foreground)" }}>
          {c.failed} couldn&apos;t be read
        </span>
      </div>
      {parts.length > 0 && (
        <p className="tl-small" style={{ margin: 0, color: "var(--muted-foreground)" }}>
          From ClinicalTrials.gov: {parts.join(", ")}.
        </p>
      )}
    </div>
  );
}
