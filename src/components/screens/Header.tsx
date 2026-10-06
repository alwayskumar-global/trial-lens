import type { ReactNode } from "react";
import { DEMO_LABEL } from "@/lib/sample/triallens-sample";
import { Wordmark } from "../brand/Wordmark";

export function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="hdr">
      <Wordmark size={28} />
      <div className="r">
        <span className="tl-sample">{DEMO_LABEL}</span>
        {right}
      </div>
    </header>
  );
}
