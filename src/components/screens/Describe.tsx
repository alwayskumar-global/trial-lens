import { Button } from "../actions/Button";
import { LensRings } from "../brand/LensRings";
import { Textarea } from "../forms/Textarea";
import { DEMO_SAMPLE_TEXT_KEY, SAMPLES } from "@/lib/sample/triallens-sample";
import { Header } from "./Header";

export function Describe({ text, setText, onNext }: { text: string; setText: (t: string) => void; onNext: () => void }) {
  const hasResults = SAMPLES.find((s) => s.t === text)?.n === DEMO_SAMPLE_TEXT_KEY;
  return (
    <div className="app">
      <div className="lensbg">
        <LensRings size={720} />
      </div>
      <div className="wrap" style={{ zIndex: 1 }}>
        <Header />
        <div className="strip-q">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M10 9v4.5M10 6.5v.1" />
          </svg>
          A map, not a verdict. Only a study team can confirm eligibility.
        </div>
        <main className="page stack g32 narrow" style={{ marginLeft: 0 }}>
          <div className="stack g16">
            <h1 className="tl-display">Find clinical trials worth asking about.</h1>
            <p className="lead">Describe your situation in your own words. We&apos;ll show where you stand, what&apos;s unknown, and what to ask.</p>
          </div>
          <div className="stack g16">
            <Textarea
              id="desc"
              label="Your situation"
              helper={hasResults ? "This demo reads only the fictional samples below. Typing is turned off." : "Prepared demo results exist only for the first sample."}
              value={text}
              readOnly
            />
            <div className="stack g8">
              <p className="eyebrow" style={{ margin: 0 }}>
                Try a sample
              </p>
              <div className="chips">
                {SAMPLES.map((s) => (
                  <button key={s.n} type="button" className="tl-chip" style={{ minHeight: 44, padding: "8px 16px", cursor: "pointer", font: "500 15px/22px var(--font-sans)", color: "var(--foreground)" }} onClick={() => setText(s.t)}>
                    {s.n}
                  </button>
                ))}
              </div>
            </div>
            <details className="disclose">
              <summary>Add location and travel distance</summary>
              <div className="in" style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <label className="stack g8 tl-small" style={{ fontWeight: 600 }}>
                  City or ZIP code
                  <input className="field" placeholder="e.g. a mid-sized city" />
                </label>
                <label className="stack g8 tl-small" style={{ fontWeight: 600 }}>
                  Travel up to
                  <select className="field" defaultValue="100 miles">
                    <option>50 miles</option>
                    <option>100 miles</option>
                    <option>250 miles</option>
                  </select>
                </label>
              </div>
            </details>
          </div>
          <div>
            <Button size="lg" disabled={!hasResults} onClick={onNext}>
              Review what we understood
            </Button>
          </div>
        </main>
        <footer className="foot">TrialLens does not store your information.</footer>
      </div>
    </div>
  );
}
