// Deterministic splitter: CT.gov free-text eligibility → bullet-level criteria typed inclusion/exclusion.
// Pure; no I/O. A section HEADER must be its own line (markdown/numbering/short qualifier allowed).
// An inline cross-reference such as "see Section 5.2 (Exclusion Criteria)." is NOT a header: treating it
// as one flipped the type of every later inclusion item (Phase 1 audit, NCT07694986-shaped text).
// Headers are applied in order, so repeated per-cohort headers work.
export interface SplitItem {
  type: "inclusion" | "exclusion";
  text: string;
}

const QUALIFIER = "(?:key|main|general|additional|other|study|patient|participant|subject|cohort\\s+\\w+|part\\s+\\w+|arm\\s+\\w+|stage\\s+\\w+)";
// prefix (markdown/bullet/number) + optional qualifiers + (inclusion|exclusion) criteria + optional "for/in ..." + optional colon + optional same-line text
const HEADER = new RegExp(
  `^\\s*(?:[#>*_\\-•]+\\s*)*(?:\\d+(?:\\.\\d+)*[.)]?\\s+)?(?:${QUALIFIER}\\s+)*(inclusion|exclusion)\\s+criteria\\b(?:\\s+(?:for|in|of)\\s+[^\\n:]{0,40})?\\s*[*_#]*\\s*(?::\\s*[*_#]*\\s*(.*))?$`,
  "i",
);
const BULLET = /\n\s*(?:[*\-•]|\d+[.)])\s+/;

export function splitEligibility(raw: string): SplitItem[] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const blocks: Array<{ type: SplitItem["type"]; lines: string[] }> = [{ type: "inclusion", lines: [] }];
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m) {
      const type = m[1]!.toLowerCase() as SplitItem["type"];
      blocks.push({ type, lines: m[2] && m[2].trim() ? [m[2]] : [] });
    } else {
      blocks[blocks.length - 1]!.lines.push(line);
    }
  }
  const out: SplitItem[] = [];
  for (const b of blocks) {
    // Leading "\n" so the first bullet is recognised by the same separator regex.
    const items = ("\n" + b.lines.join("\n"))
      .split(BULLET)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 15);
    for (const text of items) out.push({ type: b.type, text });
  }
  return out;
}

export interface SplitCriterionRecord extends SplitItem {
  id: string; // `${nct_id}:${inclusion|exclusion}:${index}` (index per type, across sections)
  nct_id: string;
}

export function splitTrialCriteria(nct_id: string, eligibilityText: string): SplitCriterionRecord[] {
  const counters = { inclusion: 0, exclusion: 0 };
  return splitEligibility(eligibilityText).map((it) => ({ ...it, nct_id, id: `${nct_id}:${it.type}:${counters[it.type]++}` }));
}
