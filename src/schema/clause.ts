// Clause representation for compound criteria.
//
// A criterion's CONDITION is a small tree of leaves joined by all/any, with optional exceptions
// ("unless ...") and timing windows. Leaves are either typed atoms (executable in code) or text
// leaves (unsupported logic, kept verbatim for the free-text/LLM path). Every leaf carries the
// exact source fragment; ParsedCriterion.original_text is never altered.
//
// Semantics: every leaf states a condition AS WRITTEN in the criterion (not what the patient must
// satisfy). Truth is three-valued (true | false | unknown). Status mapping lives in the engine:
//   inclusion: true→PASS, false→FAIL      exclusion: true→FAIL, false→PASS      unknown→UNKNOWN
//
// Two shapes:
//  - ClauseNode: recursive tree used by the engine and storage.
//  - LlmClauseCriterionSchema: FLAT (one level of items + one list of exceptions) so a mid-size
//    model can fill it reliably and it works with strict JSON-schema output. Anything nested deeper
//    than one level must be emitted as a single text leaf (stays on the free-text path).
import { z } from "zod";
import { checkIndices, isSourceFragment } from "@/lib/engine/checks";
import { CategorySchema, OperatorSchema, type Operator } from "./criteria";
import { FactKeySchema, type FactKey } from "./vocabulary";

export const TimeUnitSchema = z.enum(["days", "weeks", "months"]);
export type TimeUnit = z.infer<typeof TimeUnitSchema>;
export const RelationSchema = z.enum(["within_last", "not_within_last"]);
export type Relation = z.infer<typeof RelationSchema>;

const ValueSchema = z.union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))]);
export type ClauseValue = z.infer<typeof ValueSchema>;

// ---- Engine tree -------------------------------------------------------------------------
export interface AtomNode {
  kind: "atom";
  source: string;
  fact_key: FactKey;
  operator: Operator;
  value: ClauseValue;
  unit: string | null;
}
/** Unsupported logic: kept verbatim, evaluated by the free-text path (never by code). */
export interface TextNode {
  kind: "text";
  source: string;
  depends_on: FactKey[];
}
/** Time window around an event that is not a vocabulary fact. Never executable in code. */
export interface TimingNode {
  kind: "timing";
  source: string;
  relation: Relation;
  amount: number;
  time_unit: TimeUnit;
  depends_on: FactKey[];
}
export interface AllNode {
  kind: "all";
  children: ClauseNode[];
}
export interface AnyNode {
  kind: "any";
  children: ClauseNode[];
}
/** base AND NOT(any exception) */
export interface ExceptNode {
  kind: "except";
  base: ClauseNode;
  exceptions: ClauseNode[];
}
export type LeafNode = AtomNode | TextNode | TimingNode;
export type ClauseNode = LeafNode | AllNode | AnyNode | ExceptNode;

export const ClauseNodeSchema: z.ZodType<ClauseNode> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal("atom"),
      source: z.string().min(1),
      fact_key: FactKeySchema,
      operator: OperatorSchema,
      value: ValueSchema,
      unit: z.string().nullable(),
    }),
    z.object({ kind: z.literal("text"), source: z.string().min(1), depends_on: z.array(FactKeySchema) }),
    z.object({
      kind: z.literal("timing"),
      source: z.string().min(1),
      relation: RelationSchema,
      amount: z.number().nonnegative(),
      time_unit: TimeUnitSchema,
      depends_on: z.array(FactKeySchema),
    }),
    z.object({ kind: z.literal("all"), children: z.array(ClauseNodeSchema).min(1) }),
    z.object({ kind: z.literal("any"), children: z.array(ClauseNodeSchema).min(1) }),
    z.object({ kind: z.literal("except"), base: ClauseNodeSchema, exceptions: z.array(ClauseNodeSchema).min(1) }),
  ]),
);

export const ParseCompletenessSchema = z.enum(["full", "partial", "unresolved"]);
/** full: every leaf is an executable atom · partial: some text/timing/unconvertible leaf · unresolved: no parse. */
export type ParseCompleteness = z.infer<typeof ParseCompletenessSchema>;

// ---- LLM-facing flat schema --------------------------------------------------------------
// All fields are required (nullable) so the shape works with strict JSON-schema output.
export const LlmLeafSchema = z
  .object({
    kind: z.enum(["atom", "text", "timing"]),
    source: z.string().min(1), // EXACT contiguous fragment of the criterion text this leaf represents
    fact_key: FactKeySchema.nullable(),
    operator: OperatorSchema.nullable(),
    value: ValueSchema.nullable(),
    unit: z.string().nullable(),
    depends_on: z.array(FactKeySchema),
    relation: RelationSchema.nullable(),
    amount: z.number().nullable(),
    time_unit: TimeUnitSchema.nullable(),
  })
  .superRefine((l, ctx) => {
    const need = (ok: boolean, what: string) => {
      if (!ok) ctx.addIssue({ code: "custom", message: `${l.kind} leaf requires ${what}` });
    };
    if (l.kind === "atom") need(l.fact_key !== null && l.operator !== null && l.value !== null, "fact_key, operator and value");
    if (l.kind === "timing") need(l.relation !== null && l.amount !== null && l.time_unit !== null, "relation, amount and time_unit");
  });
export type LlmLeaf = z.infer<typeof LlmLeafSchema>;

export const LlmClauseCriterionSchema = z.object({
  category: CategorySchema,
  scoring: z.boolean(), // false only for consent/logistics
  combine: z.enum(["all", "any"]),
  items: z.array(LlmLeafSchema).min(1).max(8),
  except: z.array(LlmLeafSchema).max(4), // conditions under which the stated condition does NOT apply
});
export type LlmClauseCriterion = z.infer<typeof LlmClauseCriterionSchema>;

const LlmClauseItemSchema = LlmClauseCriterionSchema.extend({ index: z.number().int() });

/**
 * Batch schema bound to the ORIGINAL criterion texts of one parser call.
 * Rejects (so the caller retries once with the message) when indices are missing, duplicated or
 * unexpected, or when any leaf `source` is not an exact fragment of its criterion's original text.
 * Messages contain indices and counts only, never criterion text.
 */
export function makeClauseBatchSchema(originals: readonly string[]) {
  return z
    .object({ criteria: z.array(LlmClauseItemSchema) })
    .superRefine((batch, ctx) => {
      const chk = checkIndices(originals.length, batch.criteria.map((c) => c.index));
      if (!chk.ok) {
        const parts = [
          chk.missing.length ? `missing indices [${chk.missing.join(",")}]` : "",
          chk.duplicate.length ? `duplicate indices [${chk.duplicate.join(",")}]` : "",
          chk.unexpected.length ? `unexpected indices [${chk.unexpected.join(",")}]` : "",
        ].filter(Boolean);
        ctx.addIssue({ code: "custom", path: ["criteria"], message: `${parts.join("; ")}; expected exactly 0..${originals.length - 1} once each` });
        return; // source checks are meaningless when indices are wrong
      }
      batch.criteria.forEach((c) => {
        const original = originals[c.index]!;
        [...c.items, ...c.except].forEach((leaf, j) => {
          if (!isSourceFragment(original, leaf.source)) {
            ctx.addIssue({
              code: "custom",
              path: ["criteria", c.index, "items", j, "source"],
              message: `criterion ${c.index}: leaf source must be an exact fragment of the criterion text (no paraphrase)`,
            });
          }
        });
      });
    });
}
export type LlmClauseBatch = z.infer<ReturnType<typeof makeClauseBatchSchema>>;
