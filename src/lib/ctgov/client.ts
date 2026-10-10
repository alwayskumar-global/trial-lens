// ClinicalTrials.gov v2 client (public API, no key). Every response is Zod-validated; nothing here sees patient data.
// VERIFY: documented rate limit (~50 req/min/IP); discovery uses at most `maxPages` requests per run.
import { z } from "zod";

export const NCT_ID = /^NCT\d{8}$/;

/** Official study page. Returns null for anything that is not a well-formed NCT id (never builds a link from untrusted text). */
export function nctUrl(id: string): string | null {
  return NCT_ID.test(id) ? `https://clinicaltrials.gov/study/${id}` : null;
}

export const TrialSchema = z.object({
  nct_id: z.string().regex(NCT_ID),
  title: z.string(),
  eligibility_text: z.string(),
  min_age: z.string().nullable(),
  max_age: z.string().nullable(),
  sex: z.string().nullable(),
  last_update: z.string().nullable(),
  sites: z.object({ total: z.number(), recruiting: z.number(), with_geo: z.number() }),
});
export type Trial = z.infer<typeof TrialSchema>;

export const FIELDS = [
  "NCTId", "BriefTitle", "OverallStatus", "EligibilityCriteria", "MinimumAge", "MaximumAge", "Sex",
  "LastUpdatePostDate", "LocationFacility", "LocationCity", "LocationStatus", "LocationGeoPoint",
].join("|");

export const StudySchema = z.object({
  protocolSection: z.object({
    identificationModule: z.object({ nctId: z.string(), briefTitle: z.string().optional() }),
    statusModule: z.object({ overallStatus: z.string().optional(), lastUpdatePostDateStruct: z.object({ date: z.string() }).optional() }).optional(),
    eligibilityModule: z.object({ eligibilityCriteria: z.string().optional(), minimumAge: z.string().optional(), maximumAge: z.string().optional(), sex: z.string().optional() }).optional(),
    contactsLocationsModule: z.object({ locations: z.array(z.object({ status: z.string().optional(), geoPoint: z.object({ lat: z.number(), lon: z.number() }).optional() })).optional() }).optional(),
  }),
});
const PageSchema = z.object({ studies: z.array(StudySchema), nextPageToken: z.string().optional() });

export function mapStudy(s: z.infer<typeof StudySchema>): Trial | null {
  const p = s.protocolSection;
  const text = p.eligibilityModule?.eligibilityCriteria;
  if (!text || !NCT_ID.test(p.identificationModule.nctId)) return null;
  const locs = p.contactsLocationsModule?.locations ?? [];
  return {
    nct_id: p.identificationModule.nctId,
    title: p.identificationModule.briefTitle ?? "",
    eligibility_text: text,
    min_age: p.eligibilityModule?.minimumAge ?? null,
    max_age: p.eligibilityModule?.maximumAge ?? null,
    sex: p.eligibilityModule?.sex ?? null,
    last_update: p.statusModule?.lastUpdatePostDateStruct?.date ?? null,
    sites: { total: locs.length, recruiting: locs.filter((l) => l.status === "RECRUITING").length, with_geo: locs.filter((l) => l.geoPoint).length },
  };
}

export class CtgovError extends Error {
  constructor(readonly code: "CTGOV_HTTP" | "CTGOV_SHAPE" | "CTGOV_NETWORK" | "CTGOV_SCOPE", readonly status?: number) {
    super(code + (status ? `_${status}` : ""));
  }
}

export interface DiscoverOptions {
  base: string;
  maxPages?: number;
  pageSize?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Recruiting breast-cancer studies, API order, up to `maxPages` pages. Throws CtgovError (never a provider message). */
export async function discoverRecruitingBreastTrials(o: DiscoverOptions): Promise<Trial[]> {
  const f = o.fetchImpl ?? fetch;
  const out: Trial[] = [];
  let token: string | undefined;
  for (let page = 0; page < (o.maxPages ?? 2); page++) {
    const q = new URLSearchParams({ "query.cond": "breast cancer", "filter.overallStatus": "RECRUITING", pageSize: String(o.pageSize ?? 60), fields: FIELDS, format: "json" });
    if (token) q.set("pageToken", token);
    let res: Response;
    try {
      res = await f(`${o.base}/studies?${q}`, { signal: o.signal ?? AbortSignal.timeout(30_000) });
    } catch {
      throw new CtgovError("CTGOV_NETWORK");
    }
    if (!res.ok) throw new CtgovError("CTGOV_HTTP", res.status);
    const parsed = PageSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new CtgovError("CTGOV_SHAPE");
    for (const s of parsed.data.studies) {
      const t = mapStudy(s);
      if (t) out.push(t);
    }
    token = parsed.data.nextPageToken;
    if (!token) break;
  }
  return out;
}

const ageOf = (s: string | null): number => (s ? Number(s.match(/\d+/)?.[0] ?? NaN) : NaN);

/** Deterministic age/sex prefilter (code only). Unknown profile age/sex never excludes a trial. */
export function prefilterTrials(trials: readonly Trial[], profile: { age?: number; sex?: string }): Trial[] {
  const sex = profile.sex ? profile.sex.toUpperCase() : "";
  return trials.filter((t) => {
    const lo = ageOf(t.min_age), hi = ageOf(t.max_age);
    if (profile.age !== undefined && Number.isFinite(profile.age) && ((Number.isFinite(lo) && profile.age < lo) || (Number.isFinite(hi) && profile.age > hi))) return false;
    if (sex && t.sex && t.sex !== "ALL" && t.sex !== sex) return false;
    return true;
  });
}
