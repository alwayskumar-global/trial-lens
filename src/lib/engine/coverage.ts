// Coverage + scope vetting of parser output (approved design, Phase 1 repair round 3).
//
// Principle: a criterion may be executed or tiered only if the parser can PROVE that every requirement and its
// logical scope survived. There is NO tuned percentage. One omitted substantive word (negation, number, timing,
// population, exception, connective, modal) fails the criterion. A failed criterion becomes ONE text leaf holding the
// verbatim original (UNKNOWN downstream). Whitespace, list markers, markdown escapes, case and full-width
// punctuation are normalised; connectives, negation, exceptions, thresholds and timing are NEVER discarded.
//
// Three layers, all deterministic and pure:
//  1. atomScopeProblems: an executable atom is ONE proposition. Logic words in its source (negation, connectives,
//     timing, relative clauses) or numbers the atom does not carry make it non-executable (downgraded to a text leaf).
//  2. checkCoverage: the leaf sources must tile the criterion. Every uncovered word must be non-substantive filler or
//     a connective that the block structure justifies (and ⇒ all, or ⇒ any/except, unless ⇒ except, who/with/if ⇒ when).
//  3. vetCriterion: applies 1 then 2 (and "when only on inclusion"), returning the criterion the engine may use.
//
// VERIFY: the word lists are English-only, built from the Phase 1 development cohorts; extend on evidence and re-freeze
// before any untouched-cohort measurement.
import type { LlmBlock, LlmClauseCriterion, LlmLeaf } from "@/schema/clause";
import { normaliseForCompare } from "./checks";

export type VetStatus = "ok" | "atoms_downgraded" | "coverage_failed" | "when_on_exclusion";

// ---- normalisation -------------------------------------------------------------------------------------------
const stripLeadingMarker = (s: string) => s.replace(/^\s*(?:\d+[.)]|[a-z][.)]|[-•]|\(\w{1,2}\))\s+/, "");
const norm = (s: string) => normaliseForCompare(s);
const normOriginal = (s: string) => stripLeadingMarker(norm(s));

// ---- word lists --------------------------------------------------------------------------------------------------
// Words that carry no logic and may be uncovered: articles, copulas/auxiliaries, plain prepositions, requirement markers
// and generic population nouns. Anything else in a gap is substantive.
const FILLER = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "of", "to", "in", "on", "by", "as",
  "must", "shall", "required", "patient", "patients", "participant", "participants", "subject", "subjects",
]);
const WHEN_MARKERS = new Set(["if", "when", "whenever", "who", "whose", "for", "among", "with"]);
const EXCEPT_MARKERS = new Set(["unless", "except", "excluding", "save", "other", "than", "apart", "from"]);
const TOKEN = /\p{L}[\p{L}\d'’]*|\d[\d.,]*|[≥≤<>=±%+×]/gu;

// ---- 1. atom scope -----------------------------------------------------------------------------------------------
const COMPARATOR_PHRASES = [
  "no more than", "not more than", "no less than", "not less than", "no greater than", "no fewer than", "no higher than", "no lower than",
  "not exceeding", "at least", "at most", "more than", "less than", "greater than", "fewer than", "up to",
  "or older", "or younger", "or more", "or less", "or greater", "or above", "or below", "or over", "or under", "or fewer", "or higher", "or lower",
  "over", "under", "above", "below", "between",
];
const NEGATION = /\b(?:no|not|non|without|never|none|neither|nor|cannot|can't|unable|absence|absent|free of)\b|\bnon-?\p{L}/iu;
const CONNECTIVES = /\b(?:and|or|but|unless|except|excluding|if|when|whenever|who|whose|whom|which|provided|only|also|plus|either|both|other than|apart from)\b/i;
const TIMING = /\b(?:within|before|after|prior to|since|during|ago|past|last|recent|recently|until|baseline|screening|time of|following|daily|weekly|monthly|cycles?)\b/i;

function numbersIn(s: string): number[] {
  const t = s
    .replace(/[\p{L}]+\d+\s*\/\s*\d+/gu, " ") // CDK4/6, BRCA1/2
    .replace(/(?:x|×)\s*10\s*\^?\s*\d+/gi, " ")
    .replace(/10\s*\^\s*\d+/g, " ")
    .replace(/1\.73\s*m\s*\^?\s*2/gi, " ");
  const out: number[] = [];
  for (const m of t.matchAll(/(?<![\p{L}\d.])\d[\d,]*(?:\.\d+)?(?![\p{L}\d])/gu)) out.push(Number(m[0].replace(/,/g, "")));
  return out;
}

function valueNumbers(l: LlmLeaf): number[] {
  const vs = Array.isArray(l.value) ? l.value : l.value === null ? [] : [l.value];
  return vs.map((v) => Number(typeof v === "string" ? v.replace(/,/g, "") : v)).filter((n) => Number.isFinite(n));
}

/** Problems that make an atom non-executable. `siblings` = other atom leaves of the SAME block and fact (a range's other bound). */
export function atomScopeProblems(a: LlmLeaf, siblings: readonly LlmLeaf[] = []): string[] {
  let src = norm(a.source);
  const numericOp = !!a.operator && ["gte", "lte", "gt", "lt", "eq", "neq"].includes(a.operator);
  let hadComparator = false;
  const hadBetween = /\bbetween\b/.test(src);
  for (const ph of COMPARATOR_PHRASES) {
    const re = new RegExp(`\\b${ph}\\b`, "g");
    if (re.test(src)) {
      hadComparator = true;
      src = src.replace(re, " ⟂ ");
    }
  }
  const p: string[] = [];
  if (NEGATION.test(src)) p.push("negation_in_source");
  const conn = [...src.matchAll(new RegExp(CONNECTIVES.source, "gi"))].map((m) => m[0].toLowerCase());
  const setOp = a.operator === "in" || a.operator === "not_in";
  const nVals = Array.isArray(a.value) ? a.value.length : 1;
  for (const c of conn) {
    const accountedOr = c === "or" && setOp && nVals >= 2;
    const accountedAnd = c === "and" && hadBetween && numericOp;
    if (!accountedOr && !accountedAnd) p.push(`unaccounted_connective:${c}`);
  }
  if (a.fact_key !== "days_since_last_systemic_therapy" && TIMING.test(src)) p.push("timing_in_source");
  const allowed = new Set<number>([...valueNumbers(a), ...siblings.flatMap(valueNumbers)]);
  for (const n of numbersIn(src)) if (!allowed.has(n)) p.push("unaccounted_number");
  if (hadComparator && !numericOp && !setOp) p.push("comparator_on_non_numeric");
  // An asserted FALSE / neq / not_in can only be justified by negation language, which this check excludes: not provable.
  if (a.value === false || a.operator === "neq" || a.operator === "not_in") p.push("negated_assertion");
  // Receptor / BRCA polarity: the value's polarity must appear in the cited text, and the opposite polarity must not.
  if (["er_status", "pr_status", "her2_status", "brca_germline"].includes(a.fact_key ?? "") && (a.value === "positive" || a.value === "negative")) {
    const pos = /positiv|\bpos\b|\+/i.test(a.source);
    const neg = /negativ|\bneg\b|[-−]\s*(?:$|[,;/)\s])|\btnbc\b|triple/i.test(a.source);
    if ((a.value === "positive" && (!pos || neg)) || (a.value === "negative" && (!neg || pos))) p.push("polarity_mismatch");
  }
  return [...new Set(p)];
}

// ---- 2. coverage -----------------------------------------------------------------------------------------------
type ListName = "when" | "items" | "except";
interface Claim {
  start: number;
  end: number;
  bi: number;
  list: ListName;
  leaf: LlmLeaf;
}

function allLeaves(blocks: readonly LlmBlock[]): Array<{ bi: number; list: ListName; leaf: LlmLeaf }> {
  return blocks.flatMap((b, bi) => [
    ...b.when.map((leaf) => ({ bi, list: "when" as const, leaf })),
    ...b.items.map((leaf) => ({ bi, list: "items" as const, leaf })),
    ...b.except.map((leaf) => ({ bi, list: "except" as const, leaf })),
  ]);
}

function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

const LOGIC_WORDS = new Set([
  ...FILLER, ...WHEN_MARKERS, ...EXCEPT_MARKERS,
  "no", "not", "non", "without", "never", "none", "neither", "nor", "cannot", "unable", "absence", "absent", "free",
  "and", "or", "but", "only", "also", "plus", "either", "both", "which", "whom", "provided",
  "within", "before", "after", "prior", "since", "during", "ago", "past", "last", "until", "following",
  "at", "least", "most", "more", "less", "greater", "fewer", "up", "older", "younger", "over", "under", "above", "below", "between",
  "may", "might", "can", "could", "should", "would", "will", "allowed", "permitted",
]);
/** A leaf with no content word (only logic/filler/number words) cannot carry a requirement; it can only launder one. */
const isLogicOnly = (source: string) => {
  const toks = [...norm(source).matchAll(TOKEN)].map((m) => m[0].toLowerCase());
  return toks.length > 0 && toks.every((t) => LOGIC_WORDS.has(t) || /^\d/.test(t) || /^[≥≤<>=±%+×]$/.test(t));
};

export function checkCoverage(original: string, blocks: readonly LlmBlock[]): { ok: boolean; problems: string[] } {
  const N = normOriginal(original);
  const problems: string[] = [];
  const entries = allLeaves(blocks);
  if (entries.length === 0) return { ok: false, problems: ["no_leaves"] };
  for (const en of entries) if (isLogicOnly(en.leaf.source)) problems.push("logic_only_leaf");
  if (problems.length) return { ok: false, problems };

  // claim a span for every leaf: prefer an UNCLAIMED occurrence (a word cannot be claimed twice to hide a gap);
  // identical sources may share one span only for range atoms (same fact in the same block).
  const claims: Claim[] = [];
  const order = [...entries].sort((x, y) => norm(y.leaf.source).length - norm(x.leaf.source).length);
  const overlaps = (s: number, e: number) => claims.some((c) => s < c.end && e > c.start);
  for (const en of order) {
    const S = norm(en.leaf.source);
    const occ = S ? occurrences(N, S) : [];
    if (occ.length === 0) {
      problems.push("source_not_found");
      continue;
    }
    const sibling = claims.find(
      (c) => norm(c.leaf.source) === S && c.bi === en.bi && c.leaf.kind === "atom" && en.leaf.kind === "atom" && c.leaf.fact_key === en.leaf.fact_key,
    );
    if (sibling) {
      claims.push({ start: sibling.start, end: sibling.end, bi: en.bi, list: en.list, leaf: en.leaf });
      continue;
    }
    const free = occ.find((o) => !overlaps(o, o + S.length));
    const at = free ?? occ[0]!;
    claims.push({ start: at, end: at + S.length, bi: en.bi, list: en.list, leaf: en.leaf });
  }
  if (problems.length) return { ok: false, problems };

  // groups of overlapping/identical spans, in text order
  const sorted = [...claims].sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: Array<{ start: number; end: number; members: Claim[] }> = [];
  for (const c of sorted) {
    const g = groups[groups.length - 1];
    if (g && c.start < g.end) {
      g.end = Math.max(g.end, c.end);
      g.members.push(c);
    } else groups.push({ start: c.start, end: c.end, members: [c] });
  }

  const blockOf = (bi: number) => blocks[bi]!;
  const gapAt = (from: number, to: number, left: Claim[], right: Claim[]) => {
    const gap = N.slice(from, to);
    const toks = [...gap.matchAll(TOKEN)].map((m) => m[0].toLowerCase());
    for (const t of toks) {
      if (FILLER.has(t)) continue;
      if (t === "and") {
        const ok = left.some((l) => right.some((r) => l.bi !== r.bi || (l.list === r.list && (l.list === "when" || (l.list === "items" && blockOf(l.bi).combine === "all")))));
        if (!ok) problems.push("unscoped_connective:and");
      } else if (t === "or") {
        const ok = left.some((l) => right.some((r) => l.bi === r.bi && l.list === r.list && ((l.list === "items" && blockOf(l.bi).combine === "any") || l.list === "except")));
        if (!ok) problems.push("unscoped_connective:or");
      } else if (WHEN_MARKERS.has(t)) {
        const ok = right.some((r) => r.list === "when") || left.some((l) => l.list === "when" && right.some((r) => r.list === "items" && r.bi === l.bi));
        if (!ok) problems.push(`unscoped_marker:${t}`);
      } else if (EXCEPT_MARKERS.has(t)) {
        if (!right.some((r) => r.list === "except")) problems.push(`unscoped_marker:${t}`);
      } else {
        problems.push(`uncovered_word:${t}`); // negation, number, timing, population, modal, noun, adjective …
      }
    }
    return toks;
  };

  const gapTokens: string[][] = [];
  gapTokens.push(gapAt(0, groups[0]!.start, [], groups[0]!.members));
  for (let i = 0; i < groups.length - 1; i++) {
    gapTokens.push(gapAt(groups[i]!.end, groups[i + 1]!.start, groups[i]!.members, groups[i + 1]!.members));
  }
  gapAt(groups[groups.length - 1]!.end, N.length, groups[groups.length - 1]!.members, []);

  // `any` with ≥2 leaves needs an explicit "or" between neighbouring leaves (a bare comma list reads as AND)
  blocks.forEach((b, bi) => {
    if (b.combine !== "any" || b.items.length < 2) return;
    const itemClaims = claims.filter((c) => c.bi === bi && c.list === "items").sort((x, y) => x.start - y.start);
    let sawOr = false;
    for (let i = 0; i < itemClaims.length - 1; i++) {
      const between = N.slice(itemClaims[i]!.end, itemClaims[i + 1]!.start);
      if (/\bor\b/.test(between)) sawOr = true;
    }
    if (!sawOr) problems.push("any_without_or");
  });

  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

// ---- 3. vetting --------------------------------------------------------------------------------------------------
const toText = (l: LlmLeaf): LlmLeaf => ({
  kind: "text",
  source: l.source,
  fact_key: null,
  operator: null,
  value: null,
  unit: null,
  depends_on: l.fact_key ? [...new Set([...l.depends_on, l.fact_key])] : l.depends_on,
  relation: null,
  amount: null,
  time_unit: null,
});

function wholeText(original: string, category: LlmClauseCriterion["category"]): LlmClauseCriterion {
  const src = original.trim();
  return {
    category,
    blocks: [{ when: [], combine: "all", items: [{ kind: "text", source: src, fact_key: null, operator: null, value: null, unit: null, depends_on: [], relation: null, amount: null, time_unit: null }], except: [] }],
  };
}

export function vetCriterion(
  original: string,
  type: "inclusion" | "exclusion",
  c: LlmClauseCriterion,
): { criterion: LlmClauseCriterion; status: VetStatus; problems: string[] } {
  if (type === "exclusion" && c.blocks.some((b) => b.when.length > 0)) {
    return { criterion: wholeText(original, c.category), status: "when_on_exclusion", problems: ["when_on_exclusion"] };
  }
  let downgraded = false;
  const problems: string[] = [];
  const vetList = (b: LlmBlock, list: LlmLeaf[]): LlmLeaf[] =>
    list.map((l) => {
      if (l.kind !== "atom") return l;
      const sib = [...b.when, ...b.items, ...b.except].filter((o) => o !== l && o.kind === "atom" && o.fact_key === l.fact_key);
      const pr = atomScopeProblems(l, sib);
      if (pr.length === 0) return l;
      downgraded = true;
      problems.push(...pr);
      return toText(l);
    });
  // Negation sitting in a text/timing leaf of a block can invert any atom in that block: no atom there is executable.
  const negationElsewhere = (b: LlmBlock) => [...b.when, ...b.items, ...b.except].some((l) => l.kind !== "atom" && NEGATION.test(norm(l.source)));
  const blocks: LlmBlock[] = c.blocks.map((b) => {
    if (negationElsewhere(b) && [...b.when, ...b.items, ...b.except].some((l) => l.kind === "atom")) {
      downgraded = true;
      problems.push("negation_elsewhere_in_block");
      const dg = (xs: LlmLeaf[]) => xs.map((l) => (l.kind === "atom" ? toText(l) : l));
      return { ...b, when: dg(b.when), items: dg(b.items), except: dg(b.except) };
    }
    return { ...b, when: vetList(b, b.when), items: vetList(b, b.items), except: vetList(b, b.except) };
  });
  const vetted: LlmClauseCriterion = downgraded ? { ...c, blocks } : c;
  const cov = checkCoverage(original, vetted.blocks);
  if (!cov.ok) return { criterion: wholeText(original, c.category), status: "coverage_failed", problems: [...problems, ...cov.problems] };
  return { criterion: vetted, status: downgraded ? "atoms_downgraded" : "ok", problems };
}
