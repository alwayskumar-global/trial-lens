// Pure, dependency-free checks shared by the schema layer and the engine.

export interface IndexCheck {
  ok: boolean;
  missing: number[];
  duplicate: number[];
  unexpected: number[];
}

/** A parser batch must return exactly the indices 0..expected-1, each once. */
export function checkIndices(expected: number, returned: readonly number[]): IndexCheck {
  const seen = new Map<number, number>();
  for (const i of returned) seen.set(i, (seen.get(i) ?? 0) + 1);
  const missing: number[] = [];
  for (let i = 0; i < expected; i++) if (!seen.has(i)) missing.push(i);
  const duplicate = [...seen].filter(([, n]) => n > 1).map(([i]) => i).sort((a, b) => a - b);
  const unexpected = [...seen.keys()].filter((i) => !Number.isInteger(i) || i < 0 || i >= expected).sort((a, b) => a - b);
  return { ok: missing.length + duplicate.length + unexpected.length === 0, missing, duplicate, unexpected };
}

/** Whitespace/markdown-escape/quote-insensitive form used ONLY to compare source fragments. */
export function normaliseForCompare(s: string): string {
  return s
    .normalize("NFKC") // full-width punctuation etc. compare equal to ASCII
    .replace(/\\/g, "")
    .replace(/[*_`]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\s ]+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when `fragment` is a contiguous piece of `original` (after normalisation). */
export function isSourceFragment(original: string, fragment: string): boolean {
  const f = normaliseForCompare(fragment);
  return f.length > 0 && normaliseForCompare(original).includes(f);
}
