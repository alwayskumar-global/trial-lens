export type CriterionStatus = "meets" | "unknown" | "judgment" | "conflict";

const LABELS: Record<CriterionStatus, string> = {
  meets: "Meets",
  unknown: "Unknown (ask)",
  judgment: "Needs clinical judgment",
  conflict: "Possible conflict",
};

export interface StatusGlyphProps {
  status?: CriterionStatus;
  size?: number;
  withLabel?: boolean;
  label?: string;
}

/** One glyph family from circles; colour is never the only signal (glyph + text). */
export function StatusGlyph({ status = "meets", size = 20, withLabel = false, label }: StatusGlyphProps) {
  const t = label ?? LABELS[status];
  const svg = (
    <svg
      className={"tl-glyph tl-glyph--" + status}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={withLabel ? undefined : "img"}
      aria-label={withLabel ? undefined : t}
      aria-hidden={withLabel ? true : undefined}
    >
      {status === "meets" && (
        <>
          <circle cx="12" cy="12" r="9" fill="currentColor" />
          <path className="on" d="M8 12.3l2.8 2.8L16 9.5" />
        </>
      )}
      {status === "unknown" && (
        <>
          <circle cx="12" cy="12" r="9" strokeDasharray="3.2 3.2" />
          <path d="M9.8 9.6a2.3 2.3 0 114 1.5c-.8.7-1.8 1.1-1.8 2.3M12 16.6v.1" />
        </>
      )}
      {status === "judgment" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 000 18z" fill="currentColor" />
        </>
      )}
      {status === "conflict" && (
        <>
          <path d="M10.6 4.6a1.6 1.6 0 012.8 0l7.6 13.6a1.6 1.6 0 01-1.4 2.4H4.4A1.6 1.6 0 013 18.2z" />
          <path d="M12 9.8v4.4M12 17.3v.1" />
        </>
      )}
    </svg>
  );
  if (!withLabel) return svg;
  return (
    <span className={"tl-status tl-status--" + status}>
      {svg}
      {t}
    </span>
  );
}
