// Read-only CT.gov window fetch shared by the selection snapshot and the warm-up dry run (public GETs; no database, no model).
import { mapStudy, type Trial } from "../../src/lib/ctgov/client";
import { classifyScope, type ScopeClass } from "./selection-compare";

export interface WindowStudy { trial: Trial; scope: ScopeClass; studyType: string }
type Raw = { protocolSection: Parameters<typeof mapStudy>[0]["protocolSection"] & { conditionsModule?: { conditions?: string[] }; designModule?: { studyType?: string } }; derivedSection?: { conditionBrowseModule?: { meshes?: Array<{ term: string }>; ancestors?: Array<{ term: string }> } } };
const FIELDS = "NCTId|BriefTitle|OverallStatus|EligibilityCriteria|MinimumAge|MaximumAge|Sex|LastUpdatePostDate|LocationFacility|LocationCity|LocationStatus|LocationGeoPoint|Condition|ConditionMeshTerm|ConditionAncestorTerm|StudyType";

export class WindowError extends Error {
  constructor(readonly code: "WINDOW_HTTP" | "WINDOW_SHAPE" | "WINDOW_SCOPE" | "WINDOW_NETWORK", readonly status?: number) { super(code + (status ? `_${status}` : "")); }
}

/** Official API filter for interventional studies (Essie expression on StudyType); `aggFilters=studyType:int` returns the identical list (checked 2026-10-08). */
export const INTERVENTIONAL_FILTER = "AREA[StudyType]INTERVENTIONAL";

/**
 * The production query (2 pages x 60, RECRUITING, `query.cond=breast cancer`), optionally with an explicit `sort` and an interventional-only scope.
 * FAIL CLOSED: any HTTP error, malformed page, or (when scoped) a returned study that is not INTERVENTIONAL throws WindowError. There is no fallback
 * to another ordering here or in the callers.
 */
export async function fetchWindow(base: string, sort: string | null, opts: { interventionalOnly?: boolean } = {}): Promise<WindowStudy[]> {
  const out: WindowStudy[] = [];
  let tok: string | undefined;
  for (let page = 0; page < 2; page++) {
    const q = new URLSearchParams({ "query.cond": "breast cancer", "filter.overallStatus": "RECRUITING", pageSize: "60", fields: FIELDS, format: "json", ...(sort ? { sort } : {}), ...(opts.interventionalOnly ? { "filter.advanced": INTERVENTIONAL_FILTER } : {}) });
    if (tok) q.set("pageToken", tok);
    let res: Response;
    try { res = await fetch(`${base}/studies?${q}`); } catch { throw new WindowError("WINDOW_NETWORK"); }
    if (!res.ok) throw new WindowError("WINDOW_HTTP", res.status);
    const j = (await res.json().catch(() => null)) as { studies?: Raw[]; nextPageToken?: string } | null;
    if (!j || !Array.isArray(j.studies)) throw new WindowError("WINDOW_SHAPE");
    for (const s of j.studies) {
      const t = mapStudy(s);
      if (!t) continue;
      const d = s.derivedSection?.conditionBrowseModule;
      if (opts.interventionalOnly && s.protocolSection.designModule?.studyType !== "INTERVENTIONAL") throw new WindowError("WINDOW_SCOPE");
      out.push({ trial: t, studyType: s.protocolSection.designModule?.studyType ?? "UNKNOWN", scope: classifyScope({ mesh: d?.meshes?.map((m) => m.term) ?? [], ancestors: d?.ancestors?.map((m) => m.term) ?? [], conditions: s.protocolSection.conditionsModule?.conditions ?? [], studyType: s.protocolSection.designModule?.studyType }) });
    }
    tok = j.nextPageToken;
    if (!tok) break;
  }
  return out;
}
