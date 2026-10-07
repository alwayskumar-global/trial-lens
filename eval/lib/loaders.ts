// Loaders (offline). SIGIR 2016 is the only dataset reachable from the agent environment; its files are cached in gitignored eval/data/ and never
// committed (the dataset's own license was not read: docs/eval-datasets.md). No guessed schemas: anything unverified raises a labelled error.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EvalCriterionCaseSchema, GoldSchema, type EvalCriterionCase, type SigirLabel } from "./types";

export class EvalDataUnavailable extends Error {}
export class EvalDataFormatUnverified extends Error {}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

// ---- SIGIR 2016 (TrialGPT repo, dataset/sigir) -------------------------------------------------------------------------------------
export const SigirQuerySchema = z.object({ _id: z.string().min(1), text: z.string() });
export const SigirTrialSchema = z.object({ _id: z.string().regex(/^NCT\d{8}$/), title: z.string().optional(), text: z.string() });
export interface SigirQrel { patientId: string; trialId: string; label: SigirLabel }

export const parseSigirQueries = (s: string) => lines(s).map((l) => SigirQuerySchema.parse(JSON.parse(l)));
export const parseSigirCorpus = (s: string) => lines(s).map((l) => SigirTrialSchema.parse(JSON.parse(l)));
export function parseSigirQrels(s: string): SigirQrel[] {
  const [head, ...rows] = lines(s);
  if (head?.split("\t").join(",") !== "query-id,corpus-id,score") throw new EvalDataFormatUnverified("unexpected SIGIR qrels header");
  return rows.map((r) => {
    const [patientId, trialId, score] = r.split("\t");
    const label = Number(score);
    if (!patientId || !trialId || ![0, 1, 2].includes(label)) throw new EvalDataFormatUnverified("unexpected SIGIR qrels row");
    return { patientId, trialId, label: label as SigirLabel };
  });
}

export const SIGIR_FILES = ["queries.jsonl", "corpus.jsonl", "qrels/test.tsv"] as const;
const RAW = "https://raw.githubusercontent.com/ncbi-nlp/TrialGPT/main/dataset/sigir/";
const MAX_BYTES = 40_000_000;

export interface SigirData {
  queries: ReturnType<typeof parseSigirQueries>;
  corpus: ReturnType<typeof parseSigirCorpus>;
  qrels: SigirQrel[];
}
export function loadSigir(dir: string): SigirData {
  const read = (f: string) => {
    const p = join(dir, f);
    if (!existsSync(p)) throw new EvalDataUnavailable(`SIGIR file missing: ${f} (run: pnpm exec tsx eval/index.ts --fetch-sigir)`);
    return readFileSync(p, "utf8");
  };
  return { queries: parseSigirQueries(read("queries.jsonl")), corpus: parseSigirCorpus(read("corpus.jsonl")), qrels: parseSigirQrels(read("qrels/test.tsv")) };
}

/** Explicit download of the three SIGIR files into `dir` with a size cap and a sha256 manifest. Public GitHub raw URLs only; no credentials. */
export async function ensureSigir(dir: string, fetchImpl: typeof fetch = fetch): Promise<Array<{ file: string; bytes: number; sha256: string; url: string }>> {
  const manifest: Array<{ file: string; bytes: number; sha256: string; url: string }> = [];
  for (const f of SIGIR_FILES) {
    const url = RAW + f;
    const res = await fetchImpl(url);
    if (!res.ok) throw new EvalDataUnavailable(`download failed for ${f}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new EvalDataUnavailable(`${f} exceeds the ${MAX_BYTES} byte cap`);
    const path = join(dir, f);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, buf);
    manifest.push({ file: f, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), url });
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ note: "unpinned main branch; sha256 recorded at download time", files: manifest }, null, 1) + "\n");
  return manifest;
}

// ---- hand-built abstention set (author-created, non-clinician; the authoring itself is its own TASKS item) ----------------------------
export const AbstentionCaseSchema = z.strictObject({
  id: z.string().min(1),
  patient_id: z.string().min(1),
  trial_id: z.string().min(1),
  criterion_id: z.string().min(1),
  type: z.enum(["inclusion", "exclusion"]),
  text: z.string().min(1),
  gold: GoldSchema,
});
export const AbstentionSetSchema = z.strictObject({ version: z.literal(1), authored_by: z.literal("author"), clinician_reviewed: z.literal(false), cases: z.array(AbstentionCaseSchema).min(1) });

export function parseAbstentionSet(json: unknown): EvalCriterionCase[] {
  const set = AbstentionSetSchema.parse(json);
  return set.cases.map((c) => EvalCriterionCaseSchema.parse({ caseId: c.id, patientId: c.patient_id, trialId: c.trial_id, criterionId: c.criterion_id, type: c.type, text: c.text, gold: c.gold, source: "abstention_set" }));
}
export function loadAbstentionSet(path: string): EvalCriterionCase[] {
  if (!existsSync(path)) throw new EvalDataUnavailable(`abstention set not found: ${path} (authoring it is a separate TASKS item)`);
  return parseAbstentionSet(JSON.parse(readFileSync(path, "utf8")));
}

// ---- TrialGPT criterion-level annotations (Hugging Face; unreachable from the agent environment, schema unread) ----------------------
export function loadCriterionAnnotations(path: string): EvalCriterionCase[] {
  if (!existsSync(path)) throw new EvalDataUnavailable(`criterion annotations not found: ${path}. Source: Hugging Face ncbi/TrialGPT-Criterion-Annotations (blocked in the agent environment); place the files under eval/data/ yourself.`);
  throw new EvalDataFormatUnverified("the criterion-annotation schema has not been verified (docs/eval-datasets.md); no parser is guessed. Add one once the file can be inspected.");
}
