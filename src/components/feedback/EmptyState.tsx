import type { ReactNode } from "react";
import { LensRings } from "../brand/LensRings";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="tl-empty">
      <LensRings size={96} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
