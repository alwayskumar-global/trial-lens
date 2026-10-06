import { Button } from "../actions/Button";
import { LensRings } from "../brand/LensRings";
import { DEMO_SAMPLE_NAME, SAMPLE_TEXT } from "@/lib/sample/triallens-sample";
import { Header } from "./Header";

export function Describe({ onNext, tag }: { onNext: () => void; tag?: string }) {
  return (
    <div className="app">
      <div className="lensbg">
        <LensRings size={720} />
      </div>
      <div className="wrap" style={{ zIndex: 1 }}>
        <Header {...(tag ? { tag } : {})} />
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
            <p className="lead">This demo uses one prepared fictional profile. It does not read anything you type.</p>
          </div>
          <div className="stack g12">
            <p className="eyebrow" style={{ margin: 0 }}>
              Prepared fictional profile
            </p>
            <div className="panel stack g12">
              <span className="tl-chip" style={{ alignSelf: "flex-start" }}>
                {DEMO_SAMPLE_NAME}
              </span>
              <p style={{ margin: 0, font: "400 17px/27px var(--font-sans)", color: "var(--foreground)", textWrap: "pretty" }}>{SAMPLE_TEXT}</p>
            </div>
          </div>
          <div>
            <Button size="lg" onClick={onNext}>
              Review what we understood
            </Button>
          </div>
        </main>
        <footer className="foot">TrialLens does not store your information.</footer>
      </div>
    </div>
  );
}
