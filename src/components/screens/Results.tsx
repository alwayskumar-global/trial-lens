"use client";
import { useState } from "react";
import { Toast } from "../feedback/Toast";
import { SafetyBanner } from "../feedback/SafetyBanner";
import { FitBar } from "../results/FitBar";
import { FitLine } from "../results/FitLine";
import { QuestionCard } from "../results/QuestionCard";
import { TrialCard } from "../results/TrialCard";
import { TierBadge, type Tier } from "../status/TierBadge";
import { ADAPTIVE_QUESTION, DEMO_BANNER, TIERS, type SampleTrial } from "@/lib/sample/triallens-sample";
import { Header } from "./Header";

export interface ResultsProps {
  trials: readonly SampleTrial[];
  answer: string | null;
  onAnswer: (a: string) => void;
  updated: readonly string[];
  onOpen: (id: string) => void;
  toast: string | null;
  setToast: (t: string | null) => void;
}

export function Results({ trials, answer, onAnswer, updated, onOpen, toast, setToast }: ResultsProps) {
  const [filter, setFilter] = useState<Tier | null>(null);
  const counts = Object.fromEntries(TIERS.map((t) => [t.k, trials.filter((x) => x.tier === t.k).length])) as Record<Tier, number>;
  const toCard = (t: SampleTrial) => (
    <TrialCard key={t.id} title={t.title} tier={t.tier} phase={t.phase} site={t.site} distance={t.distance} why={t.why} unknown={t.unknown} reason={t.reason} nctId={t.nct} updated={updated.includes(t.id)} onOpen={() => onOpen(t.id)} />
  );
  const shown = TIERS.filter((t) => !filter || filter === t.k);
  const sharpen = trials.filter((t) => t.unknown && /heart|LVEF/i.test(t.unknown)).length;
  return (
    <div className="app">
      <SafetyBanner>{DEMO_BANNER}</SafetyBanner>
      <div className="wrap">
        <Header />
        <main className="page stack g24">
          <div className="summary">
            <h1 className="tl-h1">{trials.length} sample trials</h1>
            {TIERS.map((t) => (
              <TierBadge key={t.k} tier={t.k} label={counts[t.k] + " " + t.n.replace(" match", "")} />
            ))}
          </div>
          <div className="only-d">
            <FitLine trials={trials} onSelect={(t) => onOpen(t.id)} />
          </div>
          <div className="only-m">
            <FitBar counts={counts} active={filter} onSelect={setFilter} />
          </div>
          <div className="res-grid">
            <div className="stack g32">
              {shown
                .filter((t) => t.k !== "mismatch")
                .map((tier) => {
                  const list = trials.filter((t) => t.tier === tier.k);
                  if (!list.length) return null;
                  return (
                    <section key={tier.k} className="stack g16">
                      <h2 className="tl-h2">
                        {tier.n} <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>({list.length})</span>
                      </h2>
                      {list.map(toCard)}
                    </section>
                  );
                })}
              {shown.some((t) => t.k === "mismatch") && counts.mismatch > 0 && (
                <details className="disclose" open={filter === "mismatch" || undefined}>
                  <summary>{counts.mismatch} likely mismatches (see why)</summary>
                  <div className="in stack g16">
                    {trials.filter((t) => t.tier === "mismatch").slice(0, 1).map(toCard)}
                    <p className="tl-small" style={{ color: "var(--muted-foreground)", margin: 0 }}>
                      The other {counts.mismatch - 1} studies are for situations that differ from yours, such as other cancer types or settings. Sample entries are not shown.
                    </p>
                  </div>
                </details>
              )}
            </div>
            <aside className="sticky rail">
              <QuestionCard
                question={ADAPTIVE_QUESTION.question}
                sub={"Answering this could sharpen " + sharpen + " of " + trials.length + " trials."}
                answers={ADAPTIVE_QUESTION.answers}
                selected={answer}
                onAnswer={onAnswer}
              />
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
