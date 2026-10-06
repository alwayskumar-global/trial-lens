// Privacy guard: nothing the visitor types (description, ZIP, edited facts, answers) may be written to browser storage.
// Application code holds that state in React memory only. This test fails if any storage API appears in src.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = /\b(localStorage|sessionStorage|indexedDB|document\.cookie|cookieStore|caches\.open|navigator\.storage)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("no browser storage in application code", () => {
  it("src contains no localStorage, sessionStorage, IndexedDB, cookie or Cache API use", () => {
    const hits = sources(join(process.cwd(), "src")).flatMap((f) => (FORBIDDEN.test(readFileSync(f, "utf8")) ? [f] : []));
    expect(hits).toEqual([]);
  });
});
