// ONE selection code path, used by the live route (via createPipelineDeps), by the pipeline's discovery stage and by the offline warm-up planner,
// so what the demo shows and what a warm-up would parse can never drift apart.
//
//   discoverBySelectionMode(mode, opts)  ->  Trial[] in selection order: exactly the studies the CT.gov query returned (no post-fetch drop)
//   selectFromDiscovered(all, profile, max) -> { discovered, filtered, candidates } (age/sex prefilter, then the first `max`); also the `counts` contract
//
// FAIL CLOSED: in "relevance-v1-interventional" any HTTP error, network error, timeout, malformed page, or a study that is not INTERVENTIONAL throws
// CtgovError. There is no catch that substitutes another ordering; the pipeline maps the error to `ctgov_unavailable` (labelled replay or error).
import { z } from "zod";
import { CtgovError, discoverRecruitingBreastTrials, FIELDS, mapStudy, prefilterTrials, StudySchema, type DiscoverOptions, type Trial } from "./client";
import type { SelectionMode } from "./modes";
import { classifyScope, type ScopeClass } from "./scope";

/** Official API filter for interventional studies (Essie expression on StudyType); `aggFilters=studyType:int` returns the identical list (checked 2026-10-08). */
export const INTERVENTIONAL_FILTER = "AREA[StudyType]INTERVENTIONAL";
export const RELEVANCE_SORT = "@relevance";

const WINDOW_FIELDS = `${FIELDS}|Condition|ConditionMeshTerm|ConditionAncestorTerm|StudyType`;
const ExtraSchema = z.object({
  protocolSection: z.object({ conditionsModule: z.object({ conditions: z.array(z.string()).optional() }).optional(), designModule: z.object({ studyType: z.string().optional() }).optional() }),
  derivedSection: z.object({ conditionBrowseModule: z.object({ meshes: z.array(z.object({ term: z.string() })).optional(), ancestors: z.array(z.object({ term: z.string() })).optional() }).optional() }).optional(),
});
const PageSchema = z.object({ studies: z.array(z.unknown()), nextPageToken: z.string().optional() });

export interface WindowStudy { trial: Trial; scope: ScopeClass; studyType: string }
export interface WindowOptions { base: string; sort: string | null; interventionalOnly: boolean; maxPages?: number; pageSize?: number; signal?: AbortSignal; fetchImpl?: typeof fetch }

/** The production query (two pages of 60, RECRUITING, `query.cond=breast cancer`) with optional explicit sort and interventional scope. Throws CtgovError. */
export async function fetchSelectionWindow(o: WindowOptions): Promise<WindowStudy[]> {
  const f = o.fetchImpl ?? fetch;
  const out: WindowStudy[] = [];
  let token: string | undefined;
  for (let page = 0; page < (o.maxPages ?? 2); page++) {
    const q = new URLSearchParams({ "query.cond": "breast cancer", "filter.overallStatus": "RECRUITING", pageSize: String(o.pageSize ?? 60), fields: WINDOW_FIELDS, format: "json", ...(o.sort ? { sort: o.sort } : {}), ...(o.interventionalOnly ? { "filter.advanced": INTERVENTIONAL_FILTER } : {}) });
    if (token) q.set("pageToken", token);
    let res: Response;
    try {
      res = await f(`${o.base}/studies?${q}`, { signal: o.signal ?? AbortSignal.timeout(30_000) });
    } catch {
      throw new CtgovError("CTGOV_NETWORK");
    }
    if (!res.ok) throw new CtgovError("CTGOV_HTTP", res.status);
    const page_ = PageSchema.safeParse(await res.json().catch(() => null));
    if (!page_.success) throw new CtgovError("CTGOV_SHAPE");
    for (const raw of page_.data.studies) {
      const study = StudySchema.safeParse(raw), extra = ExtraSchema.safeParse(raw);
      if (!study.success || !extra.success) throw new CtgovError("CTGOV_SHAPE");
      const studyType = extra.data.protocolSection.designModule?.studyType ?? "UNKNOWN";
      if (o.interventionalOnly && studyType !== "INTERVENTIONAL") throw new CtgovError("CTGOV_SCOPE");
      const trial = mapStudy(study.data);
      if (!trial) continue;
      const d = extra.data.derivedSection?.conditionBrowseModule;
      out.push({ trial, studyType, scope: classifyScope({ mesh: d?.meshes?.map((m) => m.term) ?? [], ancestors: d?.ancestors?.map((m) => m.term) ?? [], conditions: extra.data.protocolSection.conditionsModule?.conditions ?? [], studyType }) });
    }
    token = page_.data.nextPageToken;
    if (!token) break;
  }
  return out;
}

/** The candidate window for a mode, in selection order. `api-default` is byte-for-byte today's request; the other mode is fail-closed. */
export async function discoverBySelectionMode(mode: SelectionMode, o: DiscoverOptions): Promise<Trial[]> {
  if (mode === "api-default") return discoverRecruitingBreastTrials(o);
  const win = await fetchSelectionWindow({ base: o.base, sort: RELEVANCE_SORT, interventionalOnly: true, ...(o.maxPages !== undefined ? { maxPages: o.maxPages } : {}), ...(o.pageSize !== undefined ? { pageSize: o.pageSize } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) });
  // No post-fetch drop: `scope` (breast signal) stays a DIAGNOSTIC on WindowStudy, so `discovered` below is exactly the number of studies the query returned.
  return win.map((w) => w.trial);
}

/**
 * Counts contract (the SSE `counts` event of the discovery stage):
 *   discovered = studies the CT.gov query returned (after the API-side interventional filter in relevance mode; nothing is dropped after the fetch)
 *   filtered   = of those, studies passing the age/sex prefilter
 *   selected   = the first `max` of the filtered studies, in window order (these are the candidates analysed)
 * Later `selected = assessed + pending + failed` (the parse-status counts event).
 */
export function selectFromDiscovered(all: readonly Trial[], profile: { age?: number; sex?: string }, max: number): { discovered: number; filtered: number; candidates: Trial[] } {
  const prefiltered = prefilterTrials(all, profile);
  return { discovered: all.length, filtered: prefiltered.length, candidates: prefiltered.slice(0, max) };
}
