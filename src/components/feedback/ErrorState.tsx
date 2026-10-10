import type { ReactNode } from "react";
import { StatusGlyph } from "../status/StatusGlyph";

/** Friendly error card with a next step. Uses the conflict glyph and mismatch tone; role=alert. */
/** `headingLevel` 1 is for a screen whose only content is the error (it would otherwise have no h1); same look either way. */
export function ErrorState({ title, children, actions, headingLevel = 3 }: { title: string; children?: ReactNode; actions?: ReactNode; headingLevel?: 1 | 3 }) {
  const Heading = headingLevel === 1 ? "h1" : "h3";
  return (
    <div className="tl-error" role="alert">
      <StatusGlyph status="conflict" size={24} />
      <div>
        <Heading>{title}</Heading>
        <p>{children}</p>
        {actions && <div className="tl-error__actions">{actions}</div>}
      </div>
    </div>
  );
}
