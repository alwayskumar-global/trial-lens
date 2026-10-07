import type { StudyQuestionItem } from "@/schema/assessment";

export const PANEL_TITLE = "Questions worth asking the study team";
export const PANEL_SUB =
  "Some criteria in these studies can't be checked from the information in the prepared fictional profile. The study team can confirm the detail.";
export const PANEL_NOTE =
  "These questions relate to the prepared fictional profile. They do not change the results shown.";
export const PANEL_EMPTY =
  "No question could be identified from the criteria assessed in this run.";

const NCT = /^NCT\d{8}$/;
const TYPE_LABEL = { inclusion: "Inclusion", exclusion: "Exclusion" } as const;

function Items({ questions }: { questions: readonly StudyQuestionItem[] }) {
  return (
    <ol className="tl-qlist">
      {questions.map((q) => (
        <li key={q.fact_key}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <strong style={{ font: "600 16px/24px var(--font-sans)" }}>{q.topic}</strong>
            <span className="tl-small" style={{ color: "var(--muted-foreground)" }}>
              Open in {q.study_count} {q.study_count === 1 ? "study" : "studies"}
            </span>
            <details style={{ marginTop: 2 }}>
              <summary
                style={{
                  cursor: "pointer",
                  font: "500 14px/22px var(--font-sans)",
                  color: "var(--primary)",
                }}
              >
                Show studies and criterion wording
              </summary>
              <div style={{ margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 12 }}>
                {q.studies.map((s) => (
                  <div key={s.nct_id} style={{ font: "400 14px/20px var(--font-sans)" }}>
                    {NCT.test(s.nct_id) ? (
                      <a
                        className="tl-link"
                        href={`https://clinicaltrials.gov/study/${s.nct_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.nct_id}
                      </a>
                    ) : (
                      <span>{s.nct_id}</span>
                    )}
                    {s.criteria.map((c) => (
                      <div key={c.criterion_id} style={{ marginTop: 2 }}>
                        <span style={{ color: "var(--muted-foreground)" }}>
                          {TYPE_LABEL[c.type]} criterion
                        </span>
                        <blockquote
                          style={{
                            margin: "2px 0 0",
                            paddingLeft: 10,
                            borderLeft: "2px solid var(--border)",
                            color: "var(--foreground)",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {c.text}
                        </blockquote>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          </div>
        </li>
      ))}
    </ol>
  );
}

const Body = ({ questions }: { questions: readonly StudyQuestionItem[] }) => (
  <>
    <p className="tl-qcard__sub">{PANEL_SUB}</p>
    <Items questions={questions} />
    <p className="tl-small" style={{ margin: 0, color: "var(--muted-foreground)" }}>
      {PANEL_NOTE}
    </p>
  </>
);

/**
 * Option B panel (no answer step, no tier prediction). `questions` is the event's list: [] = the computation ran and found no supported item
 * (small neutral state, never hidden); the caller renders nothing at all when the event never arrived.
 * Desktop: a card with the title. Mobile: a collapsed disclosure whose summary is the title, with no repeated heading inside it.
 */
export function StudyTeamPanel({ questions }: { questions: readonly StudyQuestionItem[] }) {
  if (questions.length === 0) {
    return (
      <section
        className="stack g8"
        aria-labelledby="tl-sq-empty"
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          background: "var(--card)",
          padding: 16,
        }}
      >
        <h2 className="tl-h3" id="tl-sq-empty" style={{ margin: 0 }}>
          {PANEL_TITLE}
        </h2>
        <p className="tl-small" style={{ margin: 0, color: "var(--muted-foreground)" }}>
          {PANEL_EMPTY}
        </p>
      </section>
    );
  }
  return (
    <>
      <div className="only-d">
        <section className="tl-qcard" aria-labelledby="tl-sq">
          <div className="tl-qcard__eyebrow">For the study team</div>
          <h2 className="tl-qcard__q" id="tl-sq">
            {PANEL_TITLE}
          </h2>
          <Body questions={questions} />
        </section>
      </div>
      <div className="only-m">
        <details className="disclose">
          <summary>
            {PANEL_TITLE} ({questions.length})
          </summary>
          <div className="in stack g16">
            <Body questions={questions} />
          </div>
        </details>
      </div>
    </>
  );
}
