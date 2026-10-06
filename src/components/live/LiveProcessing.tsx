import { LensRings } from "../brand/LensRings";
import { StageList, type Stage } from "../feedback/StageList";
import { PROCESSING_FOOT, PROCESSING_LEAD, PROCESSING_TITLE, STAGE_LABELS } from "@/lib/live/copy";
import type { RunState } from "@/lib/live/model";
import { LiveShell } from "./LiveShell";

/** Counts attached to a stage exist only once their event arrived. */
function stageCount(stage: string, s: RunState): string {
  if (stage === "extraction" && s.profile) return `${s.profile.length} details found`;
  if (stage === "discovery") {
    const { discovered, filtered, selected } = s.counts;
    const parts = [discovered !== undefined && `${discovered} found`, filtered !== undefined && `${filtered} fit the prepared fictional profile's age and sex`, selected !== undefined && `${selected} selected`].filter(Boolean);
    return parts.join(" · ");
  }
  return "";
}

/** Live Processing: only steps that have started are listed; no percentages, durations or waiting rows. */
export function LiveProcessing({ run }: { run: RunState }) {
  const stages: Stage[] = run.stages
    .filter((r) => STAGE_LABELS[r.stage])
    .map((r) => ({ label: STAGE_LABELS[r.stage]!, state: r.status === "done" ? "done" : "active", count: stageCount(r.stage, run) }));
  return (
    <LiveShell replay={false}>
      <main className="page proc">
        <div className="stack g12" style={{ alignItems: "center" }}>
          <LensRings size={220} animate tone="strong" />
          <h1 className="tl-h1" style={{ marginTop: -8 }}>
            {PROCESSING_TITLE}
          </h1>
          <p className="lead" style={{ textAlign: "center" }}>
            {PROCESSING_LEAD}
          </p>
        </div>
        {stages.length > 0 && (
          <div className="stages panel">
            <StageList stages={stages} />
          </div>
        )}
        <p className="tl-small" style={{ margin: 0, color: "var(--muted-foreground)", textAlign: "center" }}>
          {PROCESSING_FOOT}
        </p>
      </main>
    </LiveShell>
  );
}
