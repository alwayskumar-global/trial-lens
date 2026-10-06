import { describe, expect, it } from "vitest";
import { CtgovError, discoverRecruitingBreastTrials, nctUrl, prefilterTrials, type Trial } from "./client";

const study = (id: string, extra: object = {}) => ({
  protocolSection: {
    identificationModule: { nctId: id, briefTitle: "Fictional title " + id },
    statusModule: { lastUpdatePostDateStruct: { date: "2026-01-02" } },
    eligibilityModule: { eligibilityCriteria: "Inclusion Criteria:\n* Age 18 years or older.", minimumAge: "18 Years", sex: "ALL", ...extra },
    contactsLocationsModule: { locations: [{ status: "RECRUITING", geoPoint: { lat: 1, lon: 2 } }] },
  },
});
const respond = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("nctUrl", () => {
  it("builds official links only for well-formed NCT ids", () => {
    expect(nctUrl("NCT01234567")).toBe("https://clinicaltrials.gov/study/NCT01234567");
    expect(nctUrl("NCT0000001")).toBeNull(); // fictional demo ids are 7 digits: never linked
    expect(nctUrl("javascript:alert(1)")).toBeNull();
    expect(nctUrl("NCT01234567/../x")).toBeNull();
  });
});

describe("discoverRecruitingBreastTrials", () => {
  it("maps and validates studies; drops malformed ids and missing criteria", async () => {
    const f = respond({ studies: [study("NCT01234567"), study("BAD"), { protocolSection: { identificationModule: { nctId: "NCT09999999" } } }] });
    const t = await discoverRecruitingBreastTrials({ base: "https://x/api", fetchImpl: f as unknown as typeof fetch });
    expect(t.map((x) => x.nct_id)).toEqual(["NCT01234567"]);
    expect(t[0]!.sites).toEqual({ total: 1, recruiting: 1, with_geo: 1 });
  });
  it("fails with fixed error codes, never provider text", async () => {
    await expect(discoverRecruitingBreastTrials({ base: "https://x", fetchImpl: respond({ detail: "secret" }, 503) as unknown as typeof fetch })).rejects.toMatchObject({ code: "CTGOV_HTTP", status: 503 });
    await expect(discoverRecruitingBreastTrials({ base: "https://x", fetchImpl: respond({ nope: 1 }) as unknown as typeof fetch })).rejects.toBeInstanceOf(CtgovError);
    await expect(discoverRecruitingBreastTrials({ base: "https://x", fetchImpl: (async () => { throw new Error("boom"); }) as unknown as typeof fetch })).rejects.toMatchObject({ code: "CTGOV_NETWORK" });
  });
});

describe("prefilterTrials", () => {
  const base = { title: "", eligibility_text: "x", last_update: null, sites: { total: 0, recruiting: 0, with_geo: 0 } };
  const ts: Trial[] = [
    { ...base, nct_id: "NCT00000001", min_age: "18 Years", max_age: "65 Years", sex: "FEMALE" },
    { ...base, nct_id: "NCT00000002", min_age: "18 Years", max_age: null, sex: "MALE" },
    { ...base, nct_id: "NCT00000003", min_age: null, max_age: "40 Years", sex: "ALL" },
  ];
  it("filters by age and sex in code", () => {
    expect(prefilterTrials(ts, { age: 52, sex: "female" }).map((t) => t.nct_id)).toEqual(["NCT00000001"]);
  });
  it("unknown age/sex never excludes", () => {
    expect(prefilterTrials(ts, {})).toHaveLength(3);
  });
});
