"use client";
import { Button } from "../actions/Button";
import { CriterionGroup } from "../results/CriterionStrip";
import { StatusGlyph } from "../status/StatusGlyph";
import { TierBadge } from "../status/TierBadge";
import { FAILED_DETAIL, FAILED_TAG, OPEN_ON_CTGOV, PENDING_DETAIL, PENDING_TAG } from "@/lib/live/copy";
import { detailModel, uiTier, type RunState } from "@/lib/live/model";
import type { TrialResult } from "@/schema/assessment";
import { CriterionRow } from "./CriterionRow";
import { LiveShell } from "./LiveShell";

/** Detail for a streamed trial: verbatim criteria with what they were compared to, and the official ClinicalTrials.gov link. */
export function LiveDetail({ run, trial: t, onBack }: { run: RunState; trial: TrialResult; onBack: () => void }) {
  const replay = run.mode === "replay";
  const subject = replay ? "the fictional profile" : "your info";
  const m = detailModel(t, run.profile);
  const unfinished = m.kind !== "assessed";
  return (
    <LiveShell replay={replay} reason={run.reason} label={run.replayLabel}>
      <main className="page stack g24">
        <button type="button" className="back" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5l-5 5 5 5" />
          </svg>
          Back to results
        </button>
        <div className="stack g12">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <TierBadge tier={uiTier(t)} />
            {m.kind === "pending" && <span className="tl-chip tl-chip--dashed">{PENDING_TAG}</span>}
            {m.kind === "failed" && <span className="tl-chip tl-chip--dashed">{FAILED_TAG}</span>}
          </div>
          <h1 className="tl-h1" style={{ maxWidth: "30ch" }}>
            {t.title}
          </h1>
          <div className="meta-row">
            <span>Recruiting</span>
            <span aria-hidden="true">·</span>
            {t.url ? (
              <a className="tl-mono" href={t.url} target="_blank" rel="noopener noreferrer">
                {t.nct_id} on ClinicalTrials.gov
              </a>
            ) : (
              <span className="tl-mono">{t.nct_id}</span>
            )}
          </div>
        </div>
        <div className="res-grid">
          <div className="stack g24">
            {unfinished && (
              <section className="panel stack g12">
                <h2 className="tl-h3">{m.kind === "pending" ? "Not analyzed in this run" : "Couldn't be read"}</h2>
                <p style={{ margin: 0, font: "400 17px/27px var(--font-sans)" }}>{m.kind === "pending" ? PENDING_DETAIL : FAILED_DETAIL}</p>
              </section>
            )}
            <section className="stack g16">
              <div>
                <h2 className="tl-h2">Eligibility criteria</h2>
                <p className="tl-small" style={{ color: "var(--muted-foreground)", margin: "6px 0 0" }}>
                  {unfinished ? "Original wording from ClinicalTrials.gov. Nothing has been compared with your information." : "Original wording from ClinicalTrials.gov, with what we compared it to. Open any row to read it."}
                </p>
              </div>
              {m.attention.length > 0 && (
                <div className="tl-strips">
                  {m.attention.map((r) => (
                    <CriterionRow key={r.id} row={r} subject={subject} kind={m.kind} />
                  ))}
                </div>
              )}
              {m.unknown.length > 0 && (
                <CriterionGroup title={replay ? "Unknown: not in the fictional profile" : "Unknown: not in your information"} count={m.unknown.length} defaultOpen>
                  {m.unknown.map((r) => (
                    <CriterionRow key={r.id} row={r} subject={subject} kind={m.kind} />
                  ))}
                </CriterionGroup>
              )}
              {m.ok.length > 0 && (
                <CriterionGroup title="Looks fine so far" count={m.ok.length}>
                  {m.ok.map((r) => (
                    <CriterionRow key={r.id} row={r} subject={subject} kind={m.kind} />
                  ))}
                </CriterionGroup>
              )}
              {unfinished && (
                <div className="tl-strips">
                  {m.notAnalyzed.map((r) => (
                    <CriterionRow key={r.id} row={r} subject={subject} kind={m.kind} />
                  ))}
                </div>
              )}
            </section>
          </div>
          <aside className="stack g24 sticky">
            {!unfinished && (
              <section className="panel stack g12">
                <h2 className="tl-h3">Why it surfaced</h2>
                <ul className="tl-card__why">
                  <li>
                    <StatusGlyph status={m.ok.length > 0 ? "meets" : "unknown"} />
                    <span>{m.ok.length} criteria look fine so far</span>
                  </li>
                  <li>
                    <StatusGlyph status="unknown" />
                    <span>{m.unknown.length} not in {replay ? "the fictional profile" : "the information given"}</span>
                  </li>
                  {t.verified && t.tier !== "LIKELY_MISMATCH" && (
                    <li>
                      <StatusGlyph status="meets" />
                      <span>A second automated check found no conflict</span>
                    </li>
                  )}
                </ul>
              </section>
            )}
            <section className="panel stack g12">
              <h2 className="tl-h3">Official study page</h2>
              <p className="tl-small" style={{ margin: 0, color: "var(--muted-foreground)" }}>
                ClinicalTrials.gov lists locations and contacts for {t.nct_id}. Only a study team can confirm eligibility.
              </p>
              {t.url && (
                <Button as="a" href={t.url} target="_blank" rel="noopener noreferrer" size="lg">
                  {OPEN_ON_CTGOV}
                </Button>
              )}
            </section>
          </aside>
        </div>
      </main>
    </LiveShell>
  );
}
