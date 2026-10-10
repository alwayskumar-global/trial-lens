"use client";
import { useState, type ReactNode } from "react";
import { FitBar } from "../results/FitBar";
import { FitLine } from "../results/FitLine";
import { StudyTeamPanel } from "../results/StudyTeamPanel";
import { TierBadge, type Tier } from "../status/TierBadge";
import { NOT_ANALYZED_GROUP, NOT_ANALYZED_GROUP_NOTE, REPLAY_SUBJECT } from "@/lib/live/copy";
import { cardModel, tierCounts, trialKind, uiTier, type RunState } from "@/lib/live/model";
import type { TrialResult } from "@/schema/assessment";
import { CoverageRow } from "./CoverageRow";
import { FitLegend } from "./FitLegend";
import { LiveCard } from "./LiveCard";
import { useLiveCopy } from "./LiveCopy";
import { LiveShell } from "./LiveShell";

const TIER_NAMES: Record<Tier, string> = { strong: "Strong potential", possible: "Possible", uncertain: "Uncertain", mismatch: "Likely mismatch" };
const SECTION_NAMES: Record<Tier, string> = { strong: "Strong potential match", possible: "Possible match", uncertain: "Uncertain", mismatch: "Likely mismatch" };
const dashedNote = (t: TrialResult) => (trialKind(t) === "pending" ? "not analyzed this run" : trialKind(t) === "failed" ? "couldn't be read" : undefined);

/** Live and replay Results. Replay differs only by its labels and notice; the layout is the same so nothing imitates live progress. */
export function LiveResults({ run, onOpen, actions }: { run: RunState; onOpen: (nct: string) => void; actions?: ReactNode }) {
  const lc = useLiveCopy();
  const [filter, setFilter] = useState<Tier | null>(null);
  const replay = run.mode === "replay";
  const subject = replay ? REPLAY_SUBJECT : lc.subject;
  const trials = run.trials;
  const counts = tierCounts(trials);
  const unfinished = trials.filter((t) => trialKind(t) !== "assessed");
  const assessed = trials.filter((t) => trialKind(t) === "assessed");
  const unfinishedUncertain = unfinished.length; // pending and failed trials are always UNCERTAIN
  const tiers: Tier[] = ["strong", "possible", "uncertain", "mismatch"];
  const card = (t: TrialResult) => <LiveCard key={t.nct_id} m={cardModel(t)} subject={subject} onOpen={() => onOpen(t.nct_id)} />;
  const sectionTiers = (["strong", "possible", "uncertain"] as const).filter((k) => !filter || filter === k);
  const mismatches = assessed.filter((t) => uiTier(t) === "mismatch");
  return (
    <LiveShell replay={replay} reason={run.reason} label={run.replayLabel}>
      <main className="page stack g24">
        <div className="stack g12">
          <h1 className="tl-h1">{run.counts.selected ?? trials.length} studies selected for review</h1>
          <CoverageRow run={run} replay={replay} />
          <div className="summary">
            {tiers.map((k) => (
              <TierBadge key={k} tier={k} label={counts[k] + " " + TIER_NAMES[k]} />
            ))}
          </div>
        </div>
        <div className="stack g8">
          <div className="only-d">
            <FitLine
              trials={trials.map((t) => {
                const note = dashedNote(t);
                return { id: t.nct_id, title: t.title, tier: uiTier(t), ...(note ? { dashedNote: note } : {}) };
              })}
              onSelect={(t) => onOpen(t.id)}
            />
          </div>
          <div className="only-m">
            <FitBar counts={counts} active={filter} onSelect={setFilter} notes={unfinishedUncertain > 0 ? { uncertain: `including ${unfinishedUncertain} not analyzed this run or couldn't be read` } : {}} />
            {unfinishedUncertain > 0 && (
              <p className="tl-small" style={{ margin: "8px 0 0", color: "var(--muted-foreground)" }}>
                {unfinishedUncertain} of the {counts.uncertain} Uncertain studies were not analyzed this run or couldn&apos;t be read.
              </p>
            )}
          </div>
          <FitLegend />
        </div>
        {actions}
        <div className={run.studyQuestions ? "res-grid" : undefined}>
        <div className="stack g32">
          {sectionTiers.map((k) => {
            const list = assessed.filter((t) => uiTier(t) === k);
            if (!list.length) return null;
            return (
              <section key={k} className="stack g16">
                <h2 className="tl-h2">
                  {SECTION_NAMES[k]} <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>({list.length})</span>
                </h2>
                {list.map(card)}
              </section>
            );
          })}
          {unfinished.length > 0 && (!filter || filter === "uncertain") && (
            <section className="stack g16">
              <h2 className="tl-h2">
                {NOT_ANALYZED_GROUP} <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>({unfinished.length})</span>
              </h2>
              <p className="tl-small" style={{ margin: 0, color: "var(--muted-foreground)" }}>
                {NOT_ANALYZED_GROUP_NOTE}
              </p>
              {unfinished.map(card)}
            </section>
          )}
          {mismatches.length > 0 && (!filter || filter === "mismatch") && (
            <details className="disclose" open={filter === "mismatch" || undefined}>
              <summary>{mismatches.length} likely mismatches (see why)</summary>
              <div className="in stack g16">{mismatches.map(card)}</div>
            </details>
          )}
        </div>
        {run.studyQuestions && (
          <aside className="sticky rail">
            <StudyTeamPanel questions={run.studyQuestions} copy={replay ? undefined : { sub: lc.panelSub, note: lc.panelNote }} />
          </aside>
        )}
        </div>
      </main>
    </LiveShell>
  );
}
