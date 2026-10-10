import type { ReactNode } from "react";
import { DEMO_LABEL } from "@/lib/sample/triallens-sample";
import { Wordmark } from "../brand/Wordmark";

export function Header({ right, tag = DEMO_LABEL }: { right?: ReactNode; tag?: string }) {
  return (
    <header className="hdr">
      <Wordmark size={28} />
      <div className="r">
        <span className="tl-sample">{tag}</span>
        {right}
      </div>
    </header>
  );
}
