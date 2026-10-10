"use client";
import { useEffect } from "react";
import { LensRings } from "../brand/LensRings";
import { Header } from "./Header";

/** Brief transition into the prepared fictional results. No search or analysis happens here, so no stages or counts are shown. */
export function Processing({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const h = setTimeout(onDone, 1200);
    return () => clearTimeout(h);
  }, [onDone]);
  return (
    <div className="app">
      <div className="wrap">
        <Header />
        <main className="page proc">
          <div className="stack g12" style={{ alignItems: "center" }}>
            <LensRings size={220} animate tone="strong" />
            <h1 className="tl-h1" style={{ marginTop: -8 }}>
              Loading fixed demo
            </h1>
            <p className="lead" style={{ textAlign: "center" }}>
              No search or analysis is running. This is a prepared fictional example.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
