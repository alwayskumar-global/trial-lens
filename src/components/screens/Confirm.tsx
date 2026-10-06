"use client";
import { useState } from "react";
import { Button } from "../actions/Button";
import { ProfileChip } from "../forms/ProfileChip";
import { PROFILE, SAMPLE_TEXT, type ProfileGroups } from "@/lib/sample/triallens-sample";
import { Header } from "./Header";

export function Confirm({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [prof, setProf] = useState<ProfileGroups>(PROFILE);
  const edit = (g: keyof ProfileGroups, i: number, v: string) => setProf((p) => ({ ...p, [g]: p[g].map((x, j) => (j === i ? v : x)) }));
  const G = ({ k, title, kind, note }: { k: keyof ProfileGroups; title: string; kind: "known" | "unknown" | "uncertain"; note: string }) => (
    <section className="stack g12">
      <div>
        <h2 className="tl-h3">{title}</h2>
        <p className="tl-small" style={{ color: "var(--muted-foreground)", margin: "4px 0 0" }}>
          {note}
        </p>
      </div>
      <div className="chips">
        {prof[k].map((l, i) => (
          <ProfileChip key={l} kind={kind} label={l} onChange={(v) => edit(k, i, v)} />
        ))}
      </div>
    </section>
  );
  return (
    <div className="app">
      <div className="wrap">
        <Header />
        <main className="page stack g32">
          <div className="stack g12">
            <h1 className="tl-h1">Here is what we understood</h1>
            <p className="lead">Tap any chip to correct it. Unknowns are normal. We&apos;ll show what would help most.</p>
          </div>
          <div className="cols2">
            <details className="disclose" open>
              <summary>What you wrote</summary>
              <div className="in">
                <p style={{ margin: 0, font: "400 17px/27px var(--font-sans)", color: "var(--muted-foreground)", textWrap: "pretty" }}>{SAMPLE_TEXT}</p>
              </div>
            </details>
            <div className="panel stack g24" style={{ borderRadius: "var(--radius-panel)" }}>
              {G({ k: "known", title: "Known", kind: "known", note: "Facts we'll use to compare." })}
              {G({ k: "unknown", title: "Unknown", kind: "unknown", note: "Not mentioned. These become questions, not problems." })}
              {G({ k: "uncertain", title: "Uncertain", kind: "uncertain", note: "Please confirm so we read it correctly." })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Button size="lg" onClick={onNext}>
              Find trials
            </Button>
            <Button size="lg" variant="quiet" onClick={onBack}>
              Edit my description
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
