import { describe, expect, it } from "vitest";
import { discoveryFitText } from "@/lib/live/copy";
import { appliedFilters, initialRun, reduceRun, type RunAction } from "@/lib/live/model";

const profileRun = (facts: Array<{ key: "age" | "sex" | "stage"; state: "known" | "uncertain"; value: string | number }>) =>
  ([{ type: "mode", mode: "live" }, { type: "profile", facts }] as RunAction[]).reduce(reduceRun, initialRun).profile;

describe("discovery count sentence names only the filters actually applied", () => {
  const age = { key: "age", state: "known", value: 52 } as const;
  const sex = { key: "sex", state: "known", value: "female" } as const;
  it("age and sex present", () => {
    expect(appliedFilters(profileRun([age, sex]))).toEqual({ age: true, sex: true });
    expect(discoveryFitText(appliedFilters(profileRun([age, sex])), "visitor", 112)).toBe("112 fit the age and sex you entered");
  });
  it("age only", () => {
    expect(discoveryFitText(appliedFilters(profileRun([age])), "visitor", 112)).toBe("112 fit the age you entered");
    expect(discoveryFitText(appliedFilters(profileRun([age])), "fixed", 5)).toBe("5 fit the age of the prepared fictional profile");
  });
  it("sex only", () => {
    expect(discoveryFitText(appliedFilters(profileRun([sex])), "visitor", 90)).toBe("90 fit the sex you entered");
  });
  it("neither: no filter is claimed", () => {
    const t = discoveryFitText(appliedFilters(profileRun([{ key: "stage", state: "known", value: "II" }])), "visitor", 120);
    expect(t).toBe("no age or sex filter applied");
    expect(t).not.toMatch(/fit/);
  });
  it("an uncertain age or sex never filters (the server filters on known facts only)", () => {
    expect(appliedFilters(profileRun([{ ...age, state: "uncertain" }, sex]))).toEqual({ age: false, sex: true });
    expect(discoveryFitText(appliedFilters(profileRun([{ ...age, state: "uncertain" }, { ...sex, state: "uncertain" }])), "visitor", 120)).toBe("no age or sex filter applied");
  });
  it("replays and unknown state", () => {
    expect(discoveryFitText({ age: true, sex: true }, "replay", 9)).toBe("9 fit the age and sex of this profile");
    expect(discoveryFitText(null, "replay", 9)).toBe("9 after filtering"); // old replay without a profile event: no filter is named
  });
});
