import type { ReactNode } from "react";

export interface AnswerChipProps {
  children?: ReactNode;
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

/** Large tappable answer option; "I don't know" gets equal visual weight. */
export function AnswerChip({ children, pressed = false, onClick, disabled }: AnswerChipProps) {
  return (
    <button type="button" className="tl-achip" aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
