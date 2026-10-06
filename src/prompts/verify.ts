// Independent STRONG/POSSIBLE verifier (MID). Spike-grade prompt moved verbatim from eval/spike/07-e2e.ts.
// Changing any text here MUST bump VERIFY_PROMPT_VERSION.
import { z } from "zod";

export const VERIFY_PROMPT_VERSION = "spike-0";

export const VerifySchema = z.object({ blocking: z.array(z.object({ index: z.number().int(), evidence: z.array(z.string()) })) });
export const VERIFY_SYSTEM = `You are an independent reviewer. Given a patient's confirmed facts and a trial's criteria, find any criterion the patient CLEARLY does not satisfy (inclusion not met, or exclusion applies) using ONLY the facts. Do not assume unknown facts. If none, return an empty list. Output ONLY JSON {"blocking":[{"index","evidence":[fact keys]}]}.`;
