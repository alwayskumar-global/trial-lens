// Signed extraction (Policy R). /api/extract returns the profile it extracted plus this token; /api/run recomputes the extracted
// facts FROM THE TOKEN and compares them with the profile the client sends. Whatever differs (edited, added, answered, or a missing,
// forged or expired token) is "self-edited" and can never carry a STRONG or a LIKELY_MISMATCH (src/lib/engine/tier.ts).
// The server derives this basis itself; the client never labels it. Stateless: the token carries the facts, nothing is stored.
// The token holds only structured facts (key, state, value), never the visitor's text.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PatientProfile } from "@/schema/profile";
import { FACT_KEYS, FactKeySchema, type FactKey } from "@/schema/vocabulary";

export const EXTRACT_TOKEN_TTL_SECONDS = 2 * 60 * 60;

const Payload = z.object({
  v: z.literal(1),
  iat: z.number().int().nonnegative(),
  f: z.array(z.tuple([FactKeySchema, z.enum(["known", "uncertain"]), z.union([z.string(), z.number(), z.boolean()])])),
});

export type ExtractedFacts = ReadonlyMap<FactKey, { state: "known" | "uncertain"; value: string | number | boolean }>;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", secret).update("tl-extract-v1." + body).digest();

export function signExtraction(profile: PatientProfile, secret: string, now: Date = new Date()): string {
  const f = FACT_KEYS.flatMap((k) => {
    const fact = profile.facts[k];
    return fact && (fact.state === "known" || fact.state === "uncertain") && fact.value !== undefined ? [[k, fact.state, fact.value] as const] : [];
  });
  const body = b64(JSON.stringify({ v: 1, iat: Math.floor(now.getTime() / 1000), f }));
  return `${body}.${b64(mac(secret, body))}`;
}

/** The facts the server extracted, or null for a missing, malformed, forged or expired token. Never throws. */
export function verifyExtraction(token: string | undefined, secret: string | undefined, now: Date = new Date(), ttlSeconds = EXTRACT_TOKEN_TTL_SECONDS): ExtractedFacts | null {
  if (!token || !secret) return null;
  try {
    const [body, sig, ...rest] = token.split(".");
    if (!body || !sig || rest.length > 0) return null;
    const given = Buffer.from(sig, "base64url"), expected = mac(secret, body);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const p = Payload.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!p.success) return null;
    const age = now.getTime() / 1000 - p.data.iat;
    if (age < -60 || age > ttlSeconds) return null; // small clock skew allowed; no future-dated tokens
    return new Map(p.data.f.map(([k, state, value]) => [k, { state, value }]));
  } catch {
    return null;
  }
}

/**
 * Facts whose state/value differ from the signed extraction. With no valid token (`extracted === null`) every non-unknown fact
 * counts as edited (fail closed). Unknown facts carry no evidence, so they never matter.
 */
export function selfEditedKeys(profile: PatientProfile, extracted: ExtractedFacts | null): Set<FactKey> {
  const out = new Set<FactKey>();
  for (const k of FACT_KEYS) {
    const fact = profile.facts[k];
    if (!fact || fact.state === "unknown") {
      if (extracted?.has(k)) out.add(k); // the visitor cleared an extracted fact
      continue;
    }
    const e = extracted?.get(k);
    if (!e || e.state !== fact.state || e.value !== fact.value) out.add(k);
  }
  return out;
}
