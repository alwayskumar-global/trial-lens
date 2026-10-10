/** Legend for the Fit Line: solid = assessed, dashed = not analyzed this run or couldn't be read. Text, not colour alone. */
export function FitLegend() {
  return (
    <p className="tl-legend">
      <span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="5" fill="currentColor" />
        </svg>
        Assessed
      </span>
      <span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeDasharray="2.4 2.4" />
        </svg>
        Not analyzed this run or couldn&apos;t be read (stays Uncertain)
      </span>
    </p>
  );
}
