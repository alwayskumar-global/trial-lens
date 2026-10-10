export interface WordmarkProps {
  variant?: "full" | "mark";
  size?: number;
  color?: string;
}

/** Lowercase serif 'triallens' with lens-ring mark; mark-only for favicon. Placeholder name pending a collision check. */
export function Wordmark({ variant = "full", size = 28, color = "currentColor" }: WordmarkProps) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden={variant === "full" ? true : undefined}
      aria-label={variant === "mark" ? "triallens" : undefined}
      role={variant === "mark" ? "img" : undefined}
    >
      <circle cx="16" cy="16" r="13.5" />
      <circle cx="16" cy="16" r="8" />
      <circle cx="16" cy="16" r="2.6" fill="var(--primary)" stroke="none" />
    </svg>
  );
  if (variant === "mark") return mark;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3, color }}>
      {mark}
      <span style={{ font: "600 " + size * 0.95 + "px/1 var(--font-display)", letterSpacing: "-0.02em" }}>triallens</span>
    </span>
  );
}
