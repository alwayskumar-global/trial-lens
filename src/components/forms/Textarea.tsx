import type { ChangeEvent } from "react";

export interface TextareaProps {
  id?: string;
  label?: string;
  helper?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  maxLength?: number;
  /** Gentle validation message; flips to error state */
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number | string;
}

/** Large labelled textarea with helper text and character allowance. */
export function Textarea({ id = "tl-ta", label, helper, value, onChange, maxLength = 2000, error, placeholder, disabled, minHeight }: TextareaProps) {
  const len = (value ?? "").length;
  return (
    <div className={"tl-textarea" + (error ? " tl-textarea--error" : "")}>
      {label && <label htmlFor={id}>{label}</label>}
      <textarea
        id={id}
        value={value}
        onChange={onChange}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        style={minHeight ? { minHeight } : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={id + "-msg"}
      />
      <div className="tl-textarea__foot">
        <span id={id + "-msg"} className="tl-textarea__msg">
          {error || helper}
        </span>
        <span aria-live="polite">
          {len} / {maxLength}
        </span>
      </div>
    </div>
  );
}
