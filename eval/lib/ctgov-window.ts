// Read-only CT.gov window fetch shared by the selection snapshot and the warm-up dry run (public GETs; no database, no model).
import { mapStudy, type Trial } from "../../src/lib/ctgov/client";
import { classifyScope, type ScopeClass } from "./selection-compare";

export interface WindowStudy { trial: Trial; scope: ScopeClass; studyType: string }
type Raw = { protocolSection: Parameters<typeof mapStudy>[0]["protocolSection"] & { conditionsModule?: { conditions?: string[] }; designModule?: { studyType?: string } }; derivedSection?: { conditionBrowseModule?: { meshes?: Array<{ term: string }>; ancestors?: Array<{ term: string }> } } };
const FIELDS = "NCTId|BriefTitle|OverallStatus|EligibilityCriteria|MinimumAge|MaximumAge|Sex|LastUpdatePostDate|LocationFacility|LocationCity|LocationStatus|LocationGeoPoint|Condition|ConditionMeshTerm|ConditionAncestorTerm|StudyType";

/** The production query (2 pages x 60, RECRUITING, `query.cond=breast cancer`), optionally with an explicit `sort`. */
export async function fetchWindow(base: string, sort: string | null): Promise<WindowStudy[]> {
  const out: WindowStudy[] = [];
  let tok: string | undefined;
  for (let page = 0; page < 2; page++) {
    const q = new URLSearchParams({ "query.cond": "breast cancer", "filter.overallStatus": "RECRUITING", pageSize: "60", fields: FIELDS, format: "json", ...(sort ? { sort } : {}) });
    if (tok) q.set("pageToken", tok);
    const j = (await (await fetch(`${base}/studies?${q}`)).json()) as { studies: Raw[]; nextPageToken?: string };
    for (const s of j.studies) {
      const t = mapStudy(s);
      if (!t) continue;
      const d = s.derivedSection?.conditionBrowseModule;
      out.push({ trial: t, studyType: s.protocolSection.designModule?.studyType ?? "UNKNOWN", scope: classifyScope({ mesh: d?.meshes?.map((m) => m.term) ?? [], ancestors: d?.ancestors?.map((m) => m.term) ?? [], conditions: s.protocolSection.conditionsModule?.conditions ?? [], studyType: s.protocolSection.designModule?.studyType }) });
    }
    tok = j.nextPageToken;
    if (!tok) break;
  }
  return out;
}
