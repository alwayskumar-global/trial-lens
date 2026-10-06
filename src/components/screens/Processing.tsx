"use client";
import { useEffect, useState } from "react";
import { Button } from "../actions/Button";
import { LensRings } from "../brand/LensRings";
import { StageList, type Stage } from "../feedback/StageList";
import { Header } from "./Header";

// Sample counts from the design prototype. VERIFY (Phase 2): stream the real SSE stage/count events here.
const L: ReadonlyArray<readonly [string, string]> = [
  ["Searching recruiting studies", "143 found"],
  ["Checking basics like age, sex and distance", "31 remain"],
  ["Reading eligibility criteria", "31 of 31"],
  ["Comparing with your history", "8 worth a closer look"],
  ["Double-checking the top matches", "4 checked"],
];

export function Processing({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setStep((s) => s + 1), 1500);
    return () => clearInterval(h);
  }, []);
  useEffect(() => {
    if (step >= 5) {
      const h = setTimeout(onDone, 700);
      return () => clearTimeout(h);
    }
  }, [step, onDone]);
  const stages: Stage[] = L.map(([label, c], i) => ({ label, state: i < step ? "done" : i === step ? "active" : "waiting", count: i <= step ? c : "" }));
  return (
    <div className="app">
      <div className="wrap">
        <Header />
        <main className="page proc">
          <div className="stack g12" style={{ alignItems: "center" }}>
            <LensRings size={220} animate tone="strong" />
            <h1 className="tl-h1" style={{ marginTop: -8 }}>
              Reading trial criteria
            </h1>
            <p className="lead" style={{ textAlign: "center" }}>
              This usually takes under a minute. Nothing here is a decision. It&apos;s a map to bring to your care team.
            </p>
          </div>
          <div className="stages panel">
            <StageList stages={stages} />
          </div>
          <Button variant="quiet" onClick={onDone}>
            Skip to results
          </Button>
        </main>
      </div>
    </div>
  );
}
