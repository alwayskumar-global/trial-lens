import { StatusGlyph } from "../status/StatusGlyph";
import { TierBadge } from "../status/TierBadge";
import { FAILED_CARD, FAILED_TAG, LONG_WORDING, PENDING_CARD, PENDING_TAG } from "@/lib/live/copy";
import type { CardModel } from "@/lib/live/model";

/** Result card for a streamed trial. Quotes a criterion only when it is whole (see usableExcerpt); links to the official study page. */
export function LiveCard({ m, subject, onOpen }: { m: CardModel; subject: string; onOpen: () => void }) {
  const pending = m.kind === "pending", failed = m.kind === "failed";
  return (
    <article className="tl-card">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <TierBadge tier={m.tier} />
        {pending && <span className="tl-chip tl-chip--dashed">{PENDING_TAG}</span>}
        {failed && <span className="tl-chip tl-chip--dashed">{FAILED_TAG}</span>}
      </div>
      <h3 className="tl-card__title">{m.title}</h3>
      <div className="tl-card__meta">
        <span>Recruiting</span>
      </div>
      {pending && <p style={{ margin: 0, font: "400 16px/24px var(--font-sans)" }}>{PENDING_CARD}</p>}
      {failed && <p style={{ margin: 0, font: "400 16px/24px var(--font-sans)" }}>{FAILED_CARD}</p>}
      {m.kind === "assessed" && (
        <div>
          <p className="tl-card__label">Why it surfaced</p>
          <ul className="tl-card__why">
            {m.excerpts.map((e, i) => (
              <li key={i}>
                <StatusGlyph status={e.status} />
                <span>
                  <span className="tl-small" style={{ color: "var(--muted-foreground)" }}>
                    Criterion excerpt:{" "}
                  </span>
                  “{e.text}”
                </span>
              </li>
            ))}
            <li>
              {/* the "meets" tick appears only when at least one criterion is actually met */}
              <StatusGlyph status={m.met > 0 ? "meets" : "unknown"} />
              <span>
                {m.met} criteria look fine so far · {m.unknown} not in {subject}
              </span>
            </li>
          </ul>
        </div>
      )}
      {m.kind === "assessed" && m.biggestUnknown && (
        <div className="tl-card__unknown">
          <StatusGlyph status="unknown" size={18} />
          <span>
            <strong>Biggest unknown:</strong>{" "}
            {m.biggestUnknown.kind === "excerpt" ? (
              <>
                “{m.biggestUnknown.text}” <span className="tl-small">(criterion excerpt)</span>
              </>
            ) : (
              LONG_WORDING
            )}
          </span>
        </div>
      )}
      <div className="tl-card__foot">
        {m.url ? (
          <a className="tl-mono" href={m.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--muted-foreground)" }}>
            {m.nct}
          </a>
        ) : (
          <span className="tl-mono" style={{ color: "var(--muted-foreground)" }}>
            {m.nct}
          </span>
        )}
        <button type="button" className="tl-btn tl-btn--secondary" onClick={onOpen}>
          {m.kind === "assessed" ? "See criteria and full wording" : "See original criteria"}
        </button>
      </div>
    </article>
  );
}
