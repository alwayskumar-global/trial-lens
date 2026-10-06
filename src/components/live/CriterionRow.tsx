import { StatusGlyph } from "../status/StatusGlyph";
import { ASK_TEAM, FAILED_TAG } from "@/lib/live/copy";
import { factLabel, rowTitle, type RowModel, type TrialKind } from "@/lib/live/model";

/** Criterion row for live/replay Detail: Original wording | From the profile (+ Automated note). No plain-language column until rewrites exist. */
export function CriterionRow({ row, subject, kind, defaultOpen }: { row: RowModel; subject: string; kind: TrialKind; defaultOpen?: boolean }) {
  const t = rowTitle(row.text);
  const notAnalyzed = row.status === "not_analyzed";
  const status = notAnalyzed ? "unknown" : row.status;
  const ask = row.status === "unknown" || row.status === "judgment";
  return (
    <details className={"tl-strip tl-strip--" + status} open={defaultOpen || undefined}>
      <summary>
        {notAnalyzed ? <span className="tl-chip tl-chip--dashed">{kind === "failed" ? FAILED_TAG : "Not analyzed"}</span> : <StatusGlyph status={row.status as Exclude<RowModel["status"], "not_analyzed">} withLabel />}
        <span className="tl-strip__name">
          {t.cut && (
            <span className="tl-small" style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
              Criterion excerpt:{" "}
            </span>
          )}
          {t.text}
        </span>
        <svg className="tl-strip__chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </summary>
      <div className="tl-strip__body tl-strip__body--two">
        <div className="tl-strip__col">
          <h4>Original wording</h4>
          <blockquote className="tl-strip__orig">{row.text}</blockquote>
        </div>
        <div className="tl-strip__col">
          <h4>From {subject}</h4>
          {notAnalyzed ? (
            <span className="tl-chip tl-chip--dashed">Not compared</span>
          ) : row.evidence.length > 0 ? (
            row.evidence.map((e) => (
              <span key={e.key} className="tl-chip" style={{ color: "var(--foreground)", marginRight: 6 }}>
                {factLabel(e)}
              </span>
            ))
          ) : (
            <span className="tl-chip tl-chip--dashed">Not provided</span>
          )}
          {row.note && (
            <p className="tl-small" style={{ margin: "12px 0 0", color: "var(--muted-foreground)" }}>
              <strong>Automated note:</strong> {row.note}
            </p>
          )}
          {ask && (
            <p className="tl-small" style={{ margin: "12px 0 0", color: "var(--muted-foreground)" }}>
              {ASK_TEAM}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
