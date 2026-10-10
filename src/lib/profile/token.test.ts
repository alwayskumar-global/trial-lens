import { describe, expect, it } from "vitest";
import { profile } from "@/lib/engine/test-helpers";
import { EXTRACT_TOKEN_TTL_SECONDS, selfEditedKeys, signExtraction, verifyExtraction } from "./token";

const SECRET = "test-secret-0123456789-0123456789-xx"; // fictional, not a real credential
const NOW = new Date("2026-10-06T12:00:00Z");
const base = () => profile({ age: 52, sex: "female", her2_status: "positive" });

describe("signed extraction", () => {
  it("round-trips the extracted facts and carries no free text", () => {
    const t = signExtraction(base(), SECRET, NOW);
    const m = verifyExtraction(t, SECRET, NOW)!;
    expect(m.sample).toBe(false);
    expect([...m.facts.keys()].sort()).toEqual(["age", "her2_status", "sex"]);
    expect(Buffer.from(t.split(".")[0]!, "base64url").toString()).not.toMatch(/SENTINEL|note/);
  });

  it("fails closed for a missing, malformed, forged, wrong-secret or expired token", () => {
    const t = signExtraction(base(), SECRET, NOW);
    expect(verifyExtraction(undefined, SECRET, NOW)).toBeNull();
    expect(verifyExtraction(t, undefined, NOW)).toBeNull();
    expect(verifyExtraction("garbage", SECRET, NOW)).toBeNull();
    expect(verifyExtraction(t + ".x", SECRET, NOW)).toBeNull();
    expect(verifyExtraction(t, "another-secret-0123456789-0123456789", NOW)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, iat: Math.floor(NOW.getTime() / 1000), s: false, f: [["age", "known", 30]] })).toString("base64url");
    expect(verifyExtraction(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyExtraction(`${body}.${sig!.slice(0, -2)}AA`, SECRET, NOW)).toBeNull();
    expect(verifyExtraction(t, SECRET, new Date(NOW.getTime() + (EXTRACT_TOKEN_TTL_SECONDS + 1) * 1000))).toBeNull();
    expect(verifyExtraction(t, SECRET, new Date(NOW.getTime() - 3600_000))).toBeNull(); // future-dated
    expect(verifyExtraction(t, SECRET, new Date(NOW.getTime() + EXTRACT_TOKEN_TTL_SECONDS * 1000))).not.toBeNull();
  });
});

describe("sample flag", () => {
  it("is signed: true only when issued for a prepared sample, and flipping it invalidates the token", () => {
    expect(verifyExtraction(signExtraction(base(), SECRET, NOW, { sample: true }), SECRET, NOW)!.sample).toBe(true);
    expect(verifyExtraction(signExtraction(base(), SECRET, NOW), SECRET, NOW)!.sample).toBe(false);
    const [body, sig] = signExtraction(base(), SECRET, NOW).split(".");
    const flipped = Buffer.from(Buffer.from(body!, "base64url").toString().replace('"s":false', '"s":true')).toString("base64url");
    expect(verifyExtraction(`${flipped}.${sig}`, SECRET, NOW)).toBeNull();
  });
});

describe("selfEditedKeys (server-derived basis)", () => {
  const ex = () => verifyExtraction(signExtraction(base(), SECRET, NOW), SECRET, NOW)!.facts;
  it("an unchanged profile has no edited facts", () => expect([...selfEditedKeys(base(), ex())]).toEqual([]));
  it("an edited value, an added fact, a promoted uncertain fact and a cleared fact are all edited", () => {
    expect([...selfEditedKeys(profile({ age: 53, sex: "female", her2_status: "positive" }), ex())]).toEqual(["age"]);
    expect([...selfEditedKeys(profile({ age: 52, sex: "female", her2_status: "positive", er_status: "positive" }), ex())]).toEqual(["er_status"]);
    const unc = base();
    unc.facts.stage = { key: "stage", state: "uncertain", value: "III" };
    const withUnc = verifyExtraction(signExtraction(unc, SECRET, NOW), SECRET, NOW)!.facts;
    const promoted = base();
    promoted.facts.stage = { key: "stage", state: "known", value: "III" };
    expect([...selfEditedKeys(promoted, withUnc)]).toEqual(["stage"]);
    expect([...selfEditedKeys(profile({ age: 52, sex: "female" }), ex())]).toEqual(["her2_status"]);
  });
  it("edit then revert to the original value is text-basis again", () => {
    expect([...selfEditedKeys(profile({ age: 52, sex: "female", her2_status: "positive" }), ex())]).toEqual([]);
  });
  it("no valid token ⇒ every known fact is edited (fail closed); unknown facts are ignored", () => {
    expect([...selfEditedKeys(base(), null)].sort()).toEqual(["age", "her2_status", "sex"]);
  });
});
