"use client";
import { useState } from "react";
import { Button } from "../actions/Button";
import { SafetyBanner } from "../feedback/SafetyBanner";
import { Toast } from "../feedback/Toast";
import { CriterionGroup, CriterionStrip } from "../results/CriterionStrip";
import { StudyTeamQuestions } from "../results/StudyTeamQuestions";
import { StatusGlyph, type CriterionStatus } from "../status/StatusGlyph";
import { TierBadge } from "../status/TierBadge";
import { criteriaFor, DEMO_BANNER, DETAIL_PLAIN, QUESTIONS, type SampleCriterion, type SampleTrial } from "@/lib/sample/triallens-sample";
import { Header } from "./Header";

export function Detail({ trial: t, onBack }: { trial: SampleTrial; onBack: () => void }) {
  const cr = criteriaFor(t);
  const ord: Record<CriterionStatus, number> = { conflict: 0, unknown: 1, judgment: 2, meets: 3 };
  const attn = cr.filter((c) => c.status !== "meets").sort((a, b) => ord[a.status] - ord[b.status]);
  const ok = cr.filter((c) => c.status === "meets");
  const [toast, setToast] = useState<string | null>(null);
  const S = (c: SampleCriterion) => (
    <CriterionStrip key={c.name} status={c.status} name={c.name} original={c.original} plain={c.plain} fromInfo={c.fromInfo} onAsk={() => setToast("Added to your questions for the study team.")} />
  );
  return (
    <div className="app">
      <SafetyBanner>{DEMO_BANNER}</SafetyBanner>
      <div className="wrap">
        <Header />
        <main className="page stack g24">
          <button type="button" className="back" onClick={onBack}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5l-5 5 5 5" />
            </svg>
            Back to results
          </button>
          <div className="stack g12">
            <div>
              <TierBadge tier={t.tier} />
            </div>
            <h1 className="tl-h1" style={{ maxWidth: "30ch" }}>
              {t.title}
            </h1>
            <div className="meta-row">
              <span className="tl-chip">{t.phase}</span>
              <span>{t.site}</span>
              <span aria-hidden="true">·</span>
              <span>{t.distance}</span>
              <span aria-hidden="true">·</span>
              <span>Recruiting</span>
              <a className="tl-mono" href="#">
                {t.nct}
              </a>
            </div>
          </div>
          <div className="res-grid">
            <div className="stack g24">
              <section className="panel stack g12">
                <h2 className="tl-h3">In plain words</h2>
                <p style={{ margin: 0, font: "400 17px/27px var(--font-sans)", textWrap: "pretty" }}>{DETAIL_PLAIN}</p>
              </section>
              <section className="stack g16">
                <div>
                  <h2 className="tl-h2">Eligibility criteria</h2>
                  <p className="tl-small" style={{ color: "var(--muted-foreground)", margin: "6px 0 0" }}>
                    What needs attention comes first. Open any row to see the original wording.
                  </p>
                </div>
                <div className="tl-strips">{attn.map(S)}</div>
                <CriterionGroup title="Looks fine so far" count={ok.length}>
                  {ok.map(S)}
                </CriterionGroup>
                <CriterionGroup title="Practical requirements" count={1}>
                  <CriterionStrip status="meets" name="Study visits" original="Willing and able to comply with scheduled visits and study procedures." plain="You can attend regular visits at the site." fromInfo="Travel up to 100 miles" />
                </CriterionGroup>
              </section>
            </div>
            <aside className="stack g24 sticky">
              <section className="panel stack g12">
                <h2 className="tl-h3">Why it surfaced</h2>
                <ul className="tl-card__why">
                  {t.why.map((w, i) => (
                    <li key={i}>
                      <StatusGlyph status={w.status} />
                      <span>{w.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="panel stack g16">
                <h2 className="tl-h3">Questions for the study team</h2>
                <StudyTeamQuestions questions={QUESTIONS} onCopy={() => setToast("Questions copied.")} />
              </section>
              <section className="panel stack g12">
                <h2 className="tl-h3">Site and contact</h2>
                <p className="tl-small" style={{ margin: 0, color: "var(--muted-foreground)" }}>
                  {t.site}, {t.distance} from you.
                  <br />
                  Sample contact details. Not a real site.
                </p>
                <Button size="lg">Contact study team</Button>
              </section>
            </aside>
          </div>
        </main>
      </div>
      {toast && (
        <div className="toastpos">
          <Toast onClose={() => setToast(null)}>{toast}</Toast>
        </div>
      )}
    </div>
  );
}
