import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { GET } from "./route";

afterEach(() => { vi.unstubAllEnvs(); resetEnvCacheForTests(); });
describe("GET /api/input-mode", () => {
  it("reports samples by default, no-store, with no secret material", async () => {
    vi.stubEnv("VISITOR_INPUT_MODE", "");
    vi.stubEnv("PROFILE_SIGNING_SECRET", "");
    resetEnvCacheForTests();
    const res = GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ visitor_input: "samples", extract_ready: false, max_input_chars: 2000 });
  });
  it("reports open only when the secret and salt make it valid; a misconfigured open degrades to samples", async () => {
    vi.stubEnv("VISITOR_INPUT_MODE", "open");
    vi.stubEnv("PROFILE_SIGNING_SECRET", "s".repeat(40));
    vi.stubEnv("RATE_LIMIT_IP_SALT", "");
    resetEnvCacheForTests();
    expect(((await GET().json()) as { visitor_input: string }).visitor_input).toBe("samples");
    vi.stubEnv("RATE_LIMIT_IP_SALT", "x".repeat(20));
    resetEnvCacheForTests();
    const ok = (await GET().json()) as Record<string, unknown>;
    expect(ok).toEqual({ visitor_input: "open", extract_ready: true, max_input_chars: 2000 });
    expect(JSON.stringify(ok)).not.toContain("ssssssss");
  });
});
