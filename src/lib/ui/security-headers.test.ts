import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../../../next.config";

describe("security headers", () => {
  it("applies the static security headers to every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    const keys = rules[0]!.headers.map((h) => h.key);
    for (const k of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy"]) expect(keys).toContain(k);
  });
  it("forbids framing and plugins but does not restrict scripts (no nonce-less script-src that would break Next)", () => {
    const csp = securityHeaders.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src|default-src/);
  });
  it("keeps the X-Powered-By header off", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
