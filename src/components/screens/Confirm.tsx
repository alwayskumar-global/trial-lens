import { Button } from "../actions/Button";
import { ProfileChip } from "../forms/ProfileChip";
import { PROFILE, SAMPLE_TEXT, type ProfileGroups } from "@/lib/sample/triallens-sample";
import { Header } from "./Header";

export function Confirm({ onBack, onNext, nextLabel = "View sample trials", tag }: { onBack: () => void; onNext: () => void; nextLabel?: string; tag?: string }) {
  const prof: ProfileGroups = PROFILE;
  const G = ({ k, title, kind, note }: { k: keyof ProfileGroups; title: string; kind: "known" | "unknown" | "uncertain"; note: string }) => (
    <section className="stack g12">
      <div>
        <h2 className="tl-h3">{title}</h2>
        <p className="tl-small" style={{ color: "var(--muted-foreground)", margin: "4px 0 0" }}>
          {note}
        </p>
      </div>
      <div className="chips" role="list">
        {prof[k].map((l) => (
          <ProfileChip key={l} kind={kind} label={l} />
        ))}
      </div>
    </section>
  );
  return (
    <div className="app">
      <div className="wrap">
        <Header {...(tag ? { tag } : {})} />
        <main className="page stack g32">
          <div className="stack g12">
            <h1 className="tl-h1">Prepared fictional profile</h1>
            <p className="lead">These fixed example details are used throughout this demo. They cannot be edited here.</p>
          </div>
          <div className="cols2">
            <details className="disclose" open>
              <summary>Example description</summary>
              <div className="in">
                <p style={{ margin: 0, font: "400 17px/27px var(--font-sans)", color: "var(--muted-foreground)", textWrap: "pretty" }}>{SAMPLE_TEXT}</p>
              </div>
            </details>
            <div className="panel stack g24" style={{ borderRadius: "var(--radius-panel)" }}>
              {G({ k: "known", title: "Known", kind: "known", note: "Facts we'll use to compare." })}
              {G({ k: "unknown", title: "Unknown", kind: "unknown", note: "Not mentioned. These become questions, not problems." })}
              {G({ k: "uncertain", title: "Uncertain", kind: "uncertain", note: "These details are not confirmed in the fictional profile." })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Button size="lg" onClick={onNext}>
              {nextLabel}
            </Button>
            <Button size="lg" variant="quiet" onClick={onBack}>
              Back
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
