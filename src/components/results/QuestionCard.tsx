import { AnswerChip } from "../forms/AnswerChip";

export interface QuestionCardProps {
  question: string;
  sub?: string;
  answers: readonly string[];
  selected?: string | null;
  onAnswer?: (answer: string) => void;
  eyebrow?: string;
}

/** The single adaptive question with equal-weight answer chips; sticky in the right column on desktop. */
export function QuestionCard({ question, sub, answers, selected, onAnswer, eyebrow = "One question that would help most" }: QuestionCardProps) {
  return (
    <section className="tl-qcard" aria-labelledby="tl-q">
      <div className="tl-qcard__eyebrow">{eyebrow}</div>
      <h2 className="tl-qcard__q" id="tl-q">
        {question}
      </h2>
      {sub && <p className="tl-qcard__sub">{sub}</p>}
      <div className="tl-qcard__answers" role="group" aria-label="Answers">
        {answers.map((a) => (
          <AnswerChip key={a} pressed={selected === a} onClick={() => onAnswer?.(a)}>
            {a}
          </AnswerChip>
        ))}
      </div>
    </section>
  );
}
