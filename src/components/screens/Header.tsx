import type { ReactNode } from "react";
import { Wordmark } from "../brand/Wordmark";

export function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="hdr">
      <Wordmark size={28} />
      <div className="r">
        <span className="tl-sample">Sample data</span>
        {right}
      </div>
    </header>
  );
}
