// Phase 1 spike 03: ClinicalTrials.gov v2 probe. Run: pnpm spike:ctgov
// Public API, no key. Writes a gitignored fixture; logs only counts and field presence.
import { z } from "zod";
import { getPipelineEnv } from "../../src/lib/env";
import { appendResults, FIXTURE_PATH, saveJson, splitCriteria, TrialSchema, type Trial } from "./lib";

const FIELDS = [
  "NCTId", "BriefTitle", "OverallStatus", "EligibilityCriteria", "MinimumAge", "MaximumAge", "Sex",
  "LastUpdatePostDate", "LocationFacility", "LocationCity", "LocationStatus", "LocationGeoPoint",
].join("|");

const GeoSchema = z.object({ lat: z.number(), lon: z.number() });
const StudySchema = z.object({
  protocolSection: z.object({
    identificationModule: z.object({ nctId: z.string(), briefTitle: z.string().optional() }),
    statusModule: z
      .object({
        overallStatus: z.string().optional(),
        lastUpdatePostDateStruct: z.object({ date: z.string() }).optional(),
      })
      .optional(),
    eligibilityModule: z
      .object({
        eligibilityCriteria: z.string().optional(),
        minimumAge: z.string().optional(),
        maximumAge: z.string().optional(),
        sex: z.string().optional(),
      })
      .optional(),
    contactsLocationsModule: z
      .object({
        locations: z
          .array(z.object({ status: z.string().optional(), geoPoint: GeoSchema.optional() }))
          .optional(),
      })
      .optional(),
  }),
});
const PageSchema = z.object({ studies: z.array(StudySchema), nextPageToken: z.string().optional() });

async function main(): Promise<void> {
  const base = getPipelineEnv().CTGOV_API_BASE;
  const want = 30;
  const params = new URLSearchParams({
    "query.cond": "breast cancer",
    "filter.overallStatus": "RECRUITING",
    pageSize: "60",
    fields: FIELDS,
    format: "json",
  });
  const res = await fetch(`${base}/studies?${params}`, { signal: AbortSignal.timeout(30_000) });
  const rl = [...res.headers.entries()].filter(([k]) => /rate|limit|retry|remaining/i.test(k)).map(([k]) => k);
  console.log(`HTTP ${res.status}; rate-limit-ish headers: ${rl.length ? rl.join(",") : "none"}`);
  if (!res.ok) throw new Error(`CT.gov HTTP ${res.status}`);
  const page = PageSchema.parse(await res.json());

  const all: Trial[] = page.studies.flatMap((s) => {
    const p = s.protocolSection;
    const text = p.eligibilityModule?.eligibilityCriteria;
    if (!text) return [];
    const locs = p.contactsLocationsModule?.locations ?? [];
    return [
      {
        nct_id: p.identificationModule.nctId,
        title: p.identificationModule.briefTitle ?? "",
        eligibility_text: text,
        min_age: p.eligibilityModule?.minimumAge ?? null,
        max_age: p.eligibilityModule?.maximumAge ?? null,
        sex: p.eligibilityModule?.sex ?? null,
        last_update: p.statusModule?.lastUpdatePostDateStruct?.date ?? null,
        sites: {
          total: locs.length,
          recruiting: locs.filter((l) => l.status === "RECRUITING").length,
          with_geo: locs.filter((l) => l.geoPoint).length,
        },
      },
    ];
  });
  // Spread across the page so the sample is not just the newest study cluster.
  const step = Math.max(1, Math.floor(all.length / want));
  const trials = all.filter((_, i) => i % step === 0).slice(0, want).map((t) => TrialSchema.parse(t));
  saveJson(FIXTURE_PATH, trials);

  const n = trials.length;
  const crit = trials.flatMap(splitCriteria);
  const has = (f: (t: Trial) => unknown) => trials.filter((t) => f(t) != null).length;
  const sitesTotal = trials.reduce((a, t) => a + t.sites.total, 0);
  const sitesGeo = trials.reduce((a, t) => a + t.sites.with_geo, 0);
  const trialsAllGeo = trials.filter((t) => t.sites.total > 0 && t.sites.with_geo === t.sites.total).length;
  const lens = crit.map((c) => c.text.length).sort((a, b) => a - b);
  const fmt = (x: number, d: number) => `${x}/${d} (${d ? Math.round((100 * x) / d) : 0}%)`;

  const lines = [
    `\n## ${new Date().toISOString()} — 03-ctgov\n`,
    `- Endpoint: \`GET ${base}/studies\` with \`query.cond=breast cancer\`, \`filter.overallStatus=RECRUITING\`, \`pageSize=60\`, \`fields=...\`. HTTP ${res.status}, no key.`,
    `- Page returned ${page.studies.length} studies (nextPageToken ${page.nextPageToken ? "present" : "absent"}); ${all.length} had eligibility text; sample = ${n} (every ${step}th).`,
    `- Rate-limit headers observed: ${rl.length ? rl.join(", ") : "none (VERIFY documented limit: ~50 req/min/IP per CT.gov docs)"}`,
    `- Zod validation of response: passed (fields tolerated as optional).`,
    `- Field presence over sample: eligibility text ${fmt(has((t) => t.eligibility_text), n)}; minimumAge ${fmt(has((t) => t.min_age), n)}; maximumAge ${fmt(has((t) => t.max_age), n)}; sex ${fmt(has((t) => t.sex), n)}; lastUpdatePostDate ${fmt(has((t) => t.last_update), n)}`,
    `- Sites: ${sitesTotal} total across sample; with geoPoint ${fmt(sitesGeo, sitesTotal)}; trials where every site has geo ${fmt(trialsAllGeo, n)}; site-level status field present on ${fmt(trials.filter((t) => t.sites.recruiting > 0).length, n)} trials (≥1 RECRUITING site).`,
    `- Heuristic criterion split: ${crit.length} bullet-level criteria (${crit.filter((c) => c.type === "inclusion").length} inclusion / ${crit.filter((c) => c.type === "exclusion").length} exclusion); median length ${lens[Math.floor(lens.length / 2)]} chars. The splitter is a regex heuristic, not a parser; mis-splits are not measured here.`,
    `- Raw fixture is gitignored (\`eval/spike/fixtures/\`), regenerate with \`pnpm spike:ctgov\`. VERIFY: CT.gov terms of use on redistributing submitter text before ever committing it.`,
  ];
  appendResults(lines.join("\n") + "\n");
  console.log(lines.slice(1).join("\n"));
}

main().catch((e: unknown) => {
  console.error(`03-ctgov failed: ${(e as Error)?.name}: ${(e as Error)?.message?.slice(0, 200)}`);
  process.exit(1);
});
