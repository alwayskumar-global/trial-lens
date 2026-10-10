import { Button } from "../actions/Button";
import { LensRings } from "../brand/LensRings";
import { ErrorState } from "../feedback/ErrorState";
import { Textarea } from "../forms/Textarea";
import { Header } from "../screens/Header";
import * as C from "@/lib/visitor/copy";
import type { FlowError } from "@/lib/visitor/copy";
import { REPLAY_PROFILES } from "@/lib/sample/replay-profiles";

export interface VisitorDescribeProps {
  /** "open": typing works. "gated": the server has typed input switched off, so the box is visibly inactive and only fictional examples work. */
  mode: "open" | "gated";
  text: string;
  maxChars: number;
  busy: boolean;
  /** Client validation message (empty text). */
  invalid?: string | undefined;
  /** Server-side failure of the extraction request. */
  error?: FlowError | undefined;
  tag: string;
  footer: string;
  onText: (t: string) => void;
  onSample: (t: string) => void;
  onSubmit: () => void;
  onErrorAction?: (a: NonNullable<FlowError["action"]>) => void;
}

/** "Your situation": an editable textarea and fictional examples. In the gated state the textarea is disabled and says why. */
export function VisitorDescribe(p: VisitorDescribeProps) {
  const gated = p.mode === "gated";
  return (
    <div className="app">
      <div className="lensbg">
        <LensRings size={720} />
      </div>
      <div className="wrap" style={{ zIndex: 1 }}>
        <Header tag={p.tag} />
        <aside className="strip-q" aria-label="Demo notice">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M10 9v4.5M10 6.5v.1" />
          </svg>
          A map, not a verdict. Only a study team can confirm eligibility.
        </aside>
        <main className="page stack g32 narrow" style={{ marginLeft: 0 }}>
          <div className="stack g16">
            <h1 className="tl-display">{C.D_TITLE}</h1>
            <p className="lead">{gated ? C.G_NOTICE_BODY : C.D_LEAD}</p>
          </div>
          {gated && (
            <p role="note" className="panel" style={{ margin: 0, font: "600 16px/24px var(--font-sans)" }}>
              {C.G_NOTICE_TITLE}
            </p>
          )}
          {!gated && (
            <p className="panel" style={{ margin: 0, font: "400 16px/24px var(--font-sans)", color: "var(--foreground)" }}>
              {C.D_PRIVACY}
            </p>
          )}
          <form
            className="stack g16"
            onSubmit={(e) => {
              e.preventDefault();
              if (!p.busy) p.onSubmit();
            }}
          >
            <Textarea
              id="tl-situation"
              label={C.D_LABEL}
              helper={gated ? "Typing is switched off. Choose an example below." : C.D_HELPER}
              placeholder={gated ? C.G_PLACEHOLDER : C.D_PLACEHOLDER}
              value={p.text}
              maxLength={p.maxChars}
              disabled={gated || p.busy}
              error={p.invalid}
              minHeight={160}
              onChange={(e) => p.onText(e.target.value)}
            />
            <div className="stack g12">
              <p className="eyebrow" style={{ margin: 0 }}>
                {C.D_SAMPLES_HEADING}
              </p>
              <div className="chips">
                {REPLAY_PROFILES.map((s) => (
                  <button key={s.id} type="button" className="tl-achip" aria-pressed={p.text === s.text} disabled={p.busy} onClick={() => p.onSample(s.text)}>
                    {s.label.replace(/^Fictional profile: /, "")}
                  </button>
                ))}
              </div>
            </div>
            {p.error && (
              <ErrorState
                title={p.error.title}
                actions={
                  p.error.action === "example" ? (
                    <Button size="sm" variant="secondary" onClick={() => p.onErrorAction?.("example")}>
                      {C.EXAMPLE_BUTTON}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => p.onErrorAction?.("retry")}>
                      {C.RETRY_BUTTON}
                    </Button>
                  )
                }
              >
                {p.error.body}
              </ErrorState>
            )}
            <div>
              <Button size="lg" type="submit" disabled={p.busy || p.text.trim().length === 0} aria-busy={p.busy || undefined}>
                {p.busy ? C.D_CTA_BUSY : C.D_CTA}
              </Button>
            </div>
          </form>
        </main>
        <footer className="foot">{p.footer}</footer>
      </div>
    </div>
  );
}
