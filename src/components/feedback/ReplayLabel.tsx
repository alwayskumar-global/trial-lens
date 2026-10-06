import type { ReactNode } from "react";

/** Calm informational pill for saved-example (replay) mode. Not an error: uses the Uncertain tone. */
export function ReplayLabel({ children }: { children?: ReactNode }) {
  return (
    <span className="tl-replay" role="status">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 8a5.5 5.5 0 109.4-3.9M12.5 1.5v3h-3" />
      </svg>
      {children ?? "Showing a saved example run. Live search is paused."}
    </span>
  );
}
