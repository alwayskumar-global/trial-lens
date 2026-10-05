// Server-only environment access. Grouped, lazy, Zod-validated.
// Each group validates only its own variables, and only on first call, so
// `pnpm build`, CI and Phase 0 scripts do not need Supabase/Upstash values.
// Error messages name variables, never their values.
//
// VERIFY: add `import "server-only"` once the build guard is wired; it is not
// resolvable from tsx scripts in /eval, which also import this module.
import { z } from "zod";

type Source = Record<string, string | undefined>;

// Blank (or whitespace-only) is treated as unset.
const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const requiredString = z.preprocess(blankToUndefined, z.string().trim().min(1));
const optionalString = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());
const httpsUrl = z.preprocess(blankToUndefined, z.url({ protocol: /^https$/ }));

const positiveInt = (fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(fallback));

const boolFlag = (fallback: boolean) =>
  z.preprocess(
    blankToUndefined,
    z
      .enum(["true", "false"])
      .default(fallback ? "true" : "false")
      .transform((v) => v === "true"),
  );

const nebiusSchema = z.object({
  NEBIUS_API_KEY: requiredString,
  NEBIUS_BASE_URL: httpsUrl,
  NEMOTRON_MODEL_FAST: optionalString,
  NEMOTRON_MODEL_MID: optionalString,
  NEMOTRON_MODEL_DEEP: optionalString,
});

const supabaseSchema = z.object({
  SUPABASE_URL: httpsUrl,
  SUPABASE_SERVICE_ROLE_KEY: requiredString,
});

const upstashSchema = z.object({
  UPSTASH_REDIS_REST_URL: httpsUrl,
  UPSTASH_REDIS_REST_TOKEN: requiredString,
});

// Defaults mirror .env.example.
const pipelineSchema = z.object({
  CTGOV_API_BASE: z.preprocess(
    blankToUndefined,
    z.url({ protocol: /^https$/ }).default("https://clinicaltrials.gov/api/v2"),
  ),
  PARSER_VERSION: z.preprocess(blankToUndefined, z.string().trim().min(1).default("v0")),
  MAX_CANDIDATE_TRIALS: positiveInt(30),
  MAX_LLM_CALLS_PER_RUN: positiveInt(80),
  LLM_CONCURRENCY: positiveInt(6),
  TIER_UNKNOWN_THRESHOLD: positiveInt(3),
  MAX_INPUT_CHARS: positiveInt(4000),
  LOG_LEVEL: z.preprocess(
    blankToUndefined,
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),
});

const guardSchema = z.object({
  RATE_LIMIT_RUNS_PER_IP_PER_HOUR: positiveInt(8),
  DAILY_RUN_BUDGET: positiveInt(150),
  REPLAY_FALLBACK_ENABLED: boolFlag(true),
});

export class EnvError extends Error {
  readonly group: string;
  readonly variables: readonly string[];

  constructor(group: string, problems: ReadonlyArray<{ variable: string; problem: string }>) {
    super(
      `Invalid server environment (${group}): ` +
        problems.map((p) => `${p.variable} ${p.problem}`).join("; "),
    );
    this.name = "EnvError";
    this.group = group;
    this.variables = problems.map((p) => p.variable);
  }
}

// Fixed phrases only: never derive text from issue.message or the input.
function describeIssue(issue: z.core.$ZodIssue, source: Source): string {
  const variable = String(issue.path[0] ?? "");
  if (source[variable] === undefined || source[variable]?.trim() === "") {
    return "is missing or blank";
  }
  switch (issue.code) {
    case "invalid_format":
      return "has an invalid format (expected an https URL)";
    case "invalid_value":
      return "has a value outside the allowed set";
    case "too_small":
    case "too_big":
    case "invalid_type":
      return "has an invalid value (expected a positive integer)";
    default:
      return "is invalid";
  }
}

function parseGroup<S extends z.ZodType>(group: string, schema: S, source: Source): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => ({
    variable: String(issue.path[0] ?? "<unknown>"),
    problem: describeIssue(issue, source),
  }));
  throw new EnvError(group, problems);
}

function lazyGroup<S extends z.ZodType>(group: string, schema: S) {
  let cached: z.output<S> | undefined;
  const get = (): z.output<S> => {
    if (cached === undefined) cached = Object.freeze(parseGroup(group, schema, process.env));
    return cached;
  };
  const reset = () => {
    cached = undefined;
  };
  return { get, reset };
}

const nebius = lazyGroup("nebius", nebiusSchema);
const supabase = lazyGroup("supabase", supabaseSchema);
const upstash = lazyGroup("upstash", upstashSchema);
const pipeline = lazyGroup("pipeline", pipelineSchema);
const guard = lazyGroup("guard", guardSchema);

export type NebiusEnv = z.output<typeof nebiusSchema>;
export type SupabaseEnv = z.output<typeof supabaseSchema>;
export type UpstashEnv = z.output<typeof upstashSchema>;
export type PipelineEnv = z.output<typeof pipelineSchema>;
export type GuardEnv = z.output<typeof guardSchema>;

export const getNebiusEnv = (): NebiusEnv => nebius.get();
export const getSupabaseEnv = (): SupabaseEnv => supabase.get();
export const getUpstashEnv = (): UpstashEnv => upstash.get();
export const getPipelineEnv = (): PipelineEnv => pipeline.get();
export const getGuardEnv = (): GuardEnv => guard.get();

/** Test-only: clear cached groups so the next call re-reads process.env. */
export function resetEnvCacheForTests(): void {
  for (const g of [nebius, supabase, upstash, pipeline, guard]) g.reset();
}
