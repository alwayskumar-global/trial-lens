export interface LensRingsProps {
  size?: number;
  /** Gently expanding rings (processing) */
  animate?: boolean;
  tone?: "quiet" | "strong";
}

/** Thin concentric-circle lens motif for empty states, processing, backgrounds. */
export function LensRings({ size = 240, animate = false, tone = "quiet" }: LensRingsProps) {
  return (
    <svg
      className={"tl-lens" + (animate ? " tl-lens--animate" : "") + (tone === "strong" ? " tl-lens--strong" : "")}
      width={size}
      height={size}
      viewBox="0 0 240 240"
      aria-hidden="true"
    >
      <circle cx="120" cy="120" r="116" />
      <circle cx="120" cy="120" r="88" />
      <circle cx="120" cy="120" r="60" />
      <circle cx="120" cy="120" r="32" />
    </svg>
  );
}
