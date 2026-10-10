export interface ProfileChipProps {
  /** known = solid; unknown = dashed; uncertain = hatched */
  kind?: "known" | "unknown" | "uncertain";
  label: string;
  detail?: string;
}

/** Read-only chip showing one fact of the fixed demo profile (or that it is unknown). Not interactive: no handlers, not focusable. */
export function ProfileChip({ kind = "known", label, detail }: ProfileChipProps) {
  const sub = detail ?? (kind === "unknown" ? "We don't know yet" : kind === "uncertain" ? "Not confirmed" : null);
  return (
    <span className={"tl-pchip tl-pchip--" + kind} role="listitem" style={{ cursor: "default", pointerEvents: "none" }}>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </span>
  );
}
