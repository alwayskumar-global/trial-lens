import { Button } from "../actions/Button";
import { Header } from "../screens/Header";
import { ProfileChip } from "../forms/ProfileChip";
import * as C from "@/lib/visitor/copy";
import { enumOptions, factType, factUnit, FACT_LABEL, keysWhere, valueLabel, type Drafts } from "@/lib/visitor/facts";
import { FACT_KEYS, type FactKey } from "@/schema/vocabulary";

export interface VisitorConfirmProps {
  drafts: Drafts;
  errors: Partial<Record<FactKey, string>>;
  /** What the visitor wrote (shown for reference). */
  text: string;
  /** False in the gated state: details are shown as read-only chips, no controls. */
  editable: boolean;
  tag: string;
  announce: string;
  showErrors: boolean;
  onSure: (k: FactKey, sure: boolean) => void;
  onValue: (k: FactKey, raw: string) => void;
  onRemove: (k: FactKey) => void;
  onAdd: (k: FactKey) => void;
  onBack: () => void;
  onNext: () => void;
}

const idOf = (k: FactKey) => "tl-fact-" + k;

function ValueControl({ k, d, error, onValue }: { k: FactKey; d: Drafts; error: string | undefined; onValue: (k: FactKey, raw: string) => void }) {
  const f = d[k];
  const t = factType(k);
  const common = { id: idOf(k), "aria-invalid": error ? true : undefined, "aria-describedby": error ? idOf(k) + "-err" : undefined, className: "tl-fact__input" } as const;
  if (t === "number") {
    return (
      <span className="tl-fact__num">
        <input {...common} type="number" inputMode="decimal" step="any" value={f.value === undefined ? "" : String(f.value)} onChange={(e) => onValue(k, e.target.value)} />
        {factUnit(k) && <span className="tl-small">{factUnit(k)}</span>}
      </span>
    );
  }
  const opts = t === "bool" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : enumOptions(k);
  return (
    <select {...common} value={f.value === undefined ? "" : String(f.value)} onChange={(e) => onValue(k, e.target.value)}>
      <option value="">{C.C_CHOOSE}</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** "Here is what we understood": every extracted detail can be corrected, marked as not sure, removed, or added. */
export function VisitorConfirm(p: VisitorConfirmProps) {
  const provided = keysWhere(p.drafts, (f) => f.state !== "unknown");
  const unknown = FACT_KEYS.filter((k) => p.drafts[k].state === "unknown");
  const errCount = Object.keys(p.errors).length;
  return (
    <div className="app">
      <div className="wrap">
        <Header tag={p.tag} />
        <main className="page stack g32">
          <div className="stack g12">
            <h1 className="tl-h1">{C.C_TITLE}</h1>
            <p className="lead">{p.editable ? C.C_LEAD : C.C_LEAD_READONLY}</p>
          </div>
          <div className="cols2">
            <details className="disclose" open>
              <summary>{C.C_YOUR_TEXT}</summary>
              <div className="in">
                <p style={{ margin: 0, font: "400 17px/27px var(--font-sans)", color: "var(--muted-foreground)", textWrap: "pretty", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.text}</p>
              </div>
            </details>
            <div className="panel stack g24" style={{ borderRadius: "var(--radius-panel)" }}>
              <section className="stack g12" aria-labelledby="tl-known-h">
                <div>
                  <h2 className="tl-h3" id="tl-known-h">
                    {C.C_KNOWN}
                  </h2>
                  <p className="tl-small" style={{ color: "var(--muted-foreground)", margin: "4px 0 0" }}>
                    {C.C_KNOWN_NOTE}
                  </p>
                </div>
                {provided.length === 0 && <p style={{ margin: 0 }}>{C.C_NONE_KNOWN}</p>}
                {p.editable ? (
                  <ul className="tl-facts" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {provided.map((k) => {
                      const f = p.drafts[k];
                      const err = p.showErrors ? p.errors[k] : undefined;
                      return (
                        <li key={k} className={"tl-fact" + (err ? " tl-fact--error" : "")}>
                          <label htmlFor={idOf(k)} className="tl-fact__label">
                            {FACT_LABEL[k]}
                          </label>
                          <ValueControl k={k} d={p.drafts} error={err} onValue={p.onValue} />
                          <select aria-label={`${C.C_SURE_LABEL}: ${FACT_LABEL[k]}`} className="tl-fact__sure" value={f.state === "uncertain" ? "no" : "yes"} onChange={(e) => p.onSure(k, e.target.value === "yes")}>
                            <option value="yes">{C.C_SURE}</option>
                            <option value="no">{C.C_UNSURE}</option>
                          </select>
                          <Button size="sm" variant="quiet" aria-label={`${C.C_REMOVE} ${FACT_LABEL[k]}`} onClick={() => p.onRemove(k)}>
                            {C.C_REMOVE}
                          </Button>
                          {err && (
                            <p id={idOf(k) + "-err"} className="tl-fact__err">
                              {err}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="chips" role="list">
                    {provided.map((k) => (
                      <ProfileChip key={k} kind={p.drafts[k].state === "uncertain" ? "uncertain" : "known"} label={`${FACT_LABEL[k]}: ${valueLabel(k, p.drafts[k].value)}`} />
                    ))}
                  </div>
                )}
              </section>
              <section className="stack g12" aria-labelledby="tl-unknown-h">
                <div>
                  <h2 className="tl-h3" id="tl-unknown-h">
                    {C.C_UNKNOWN}
                  </h2>
                  <p className="tl-small" style={{ color: "var(--muted-foreground)", margin: "4px 0 0" }}>
                    {C.C_UNKNOWN_NOTE}
                  </p>
                </div>
                {p.editable ? (
                  <details className="disclose">
                    <summary>{C.C_ADD_SUMMARY(unknown.length)}</summary>
                    <ul className="in tl-facts" style={{ listStyle: "none", margin: 0 }}>
                      {unknown.map((k) => (
                        <li key={k} className="tl-fact tl-fact--add">
                          <span className="tl-fact__label">{FACT_LABEL[k]}</span>
                          <Button size="sm" variant="secondary" aria-label={`${C.C_ADD} ${FACT_LABEL[k]}`} onClick={() => p.onAdd(k)}>
                            {C.C_ADD}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <div className="chips" role="list">
                    {unknown.map((k) => (
                      <ProfileChip key={k} kind="unknown" label={FACT_LABEL[k]} />
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
          <p className="tl-small" role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, color: p.showErrors && errCount ? "var(--tier-mismatch-fg)" : "var(--muted-foreground)" }}>
            {p.showErrors && errCount ? C.C_ERR_FIX : p.announce}
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Button size="lg" onClick={p.onNext}>
              {C.C_RUN}
            </Button>
            <Button size="lg" variant="quiet" onClick={p.onBack}>
              {C.C_BACK}
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
