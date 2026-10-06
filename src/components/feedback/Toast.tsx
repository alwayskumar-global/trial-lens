import type { ReactNode } from "react";

/** Transient confirmation, e.g. after an answer re-tiers trials. Bottom-left of the viewport. */
export function Toast({ children, onClose }: { children?: ReactNode; onClose?: () => void }) {
  return (
    <div className="tl-toast" role="status">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M6.8 10.2l2.2 2.2 4.2-4.4" />
      </svg>
      <span style={{ flex: 1 }}>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", minWidth: 24, minHeight: 24, font: "600 16px/1 var(--font-sans)" }}>
          ×
        </button>
      )}
    </div>
  );
}
