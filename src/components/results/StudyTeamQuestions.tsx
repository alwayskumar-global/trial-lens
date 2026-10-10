"use client";
import { useState } from "react";

export interface StudyTeamQuestionsProps {
  questions: readonly string[];
  onCopy?: (text: string) => void;
}

/** Numbered coordinator questions with Copy / Print. */
export function StudyTeamQuestions({ questions, onCopy }: StudyTeamQuestionsProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const txt = questions.map((q, i) => i + 1 + ". " + q).join("\n");
    try {
      void navigator.clipboard?.writeText(txt);
    } catch {
      /* clipboard unavailable: the label still confirms the action was attempted */
    }
    setCopied(true);
    onCopy?.(txt);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ol className="tl-qlist">
        {questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
      <div className="tl-actions">
        <button type="button" className="tl-btn tl-btn--secondary" onClick={copy}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="7" y="7" width="9" height="9" rx="2" />
            <path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" />
          </svg>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="tl-btn tl-btn--quiet" onClick={() => window.print()}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 7V3h8v4M6 14H4a1 1 0 01-1-1V8a1 1 0 011-1h12a1 1 0 011 1v5a1 1 0 01-1 1h-2" />
            <rect x="6" y="11" width="8" height="6" rx="1" />
          </svg>
          Print
        </button>
      </div>
    </div>
  );
}
