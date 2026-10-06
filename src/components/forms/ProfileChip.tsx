"use client";
import { useState } from "react";

export interface ProfileChipProps {
  /** known = solid; unknown = dashed; uncertain = hatched */
  kind?: "known" | "unknown" | "uncertain";
  label: string;
  detail?: string;
  onChange?: (value: string) => void;
  editable?: boolean;
}

/** Inline-editable chip showing one fact TrialLens understood (or doesn't know). Click to edit; Enter saves. */
export function ProfileChip({ kind = "known", label, detail, onChange, editable = true }: ProfileChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const sub = detail ?? (kind === "unknown" ? "We don't know yet" : kind === "uncertain" ? "Please confirm" : null);
  const commit = () => {
    setEditing(false);
    if (draft && draft !== label && onChange) onChange(draft);
  };
  if (editing) {
    return (
      <span className={"tl-pchip tl-pchip--" + kind + " tl-pchip--editing"}>
        <input
          autoFocus
          value={draft}
          aria-label={"Edit " + label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(label);
              setEditing(false);
            }
          }}
        />
        <small>Press Enter to save</small>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={"tl-pchip tl-pchip--" + kind}
      onClick={() => {
        if (editable) {
          setDraft(label);
          setEditing(true);
        }
      }}
      aria-label={label + (sub ? ", " + sub : "") + (editable ? ". Edit" : "")}
    >
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </button>
  );
}
