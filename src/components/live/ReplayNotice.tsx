import { REPLAY_NOTICE_LEAD, replayNotice, type ReplayReason } from "@/lib/live/copy";

/** Persistent, prominent notice on every replay screen. A replay is never presented as a live analysis. */
export function ReplayNotice({ reason, label }: { reason?: ReplayReason | undefined; label?: string | undefined }) {
  return (
    <div className="tl-notice" role="status">
      <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 8a5.5 5.5 0 109.4-3.9M12.5 1.5v3h-3" />
      </svg>
      <span>
        <strong style={{ fontWeight: 600 }}>{REPLAY_NOTICE_LEAD}</strong> {replayNotice(reason, label)}
      </span>
    </div>
  );
}
