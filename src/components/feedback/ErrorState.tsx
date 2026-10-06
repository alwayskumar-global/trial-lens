import type { ReactNode } from "react";
import { StatusGlyph } from "../status/StatusGlyph";

/** Friendly error card with a next step. Uses the conflict glyph and mismatch tone; role=alert. */
export function ErrorState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="tl-error" role="alert">
      <StatusGlyph status="conflict" size={24} />
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
        {actions && <div className="tl-error__actions">{actions}</div>}
      </div>
    </div>
  );
}
