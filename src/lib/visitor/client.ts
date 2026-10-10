// Browser-side clients for the visitor flow. The description text is sent once and never stored, logged or cached here.
import { parseExtractResponse, type Drafts } from "./facts";
import { z } from "zod";

export type ExtractResult = { ok: true; drafts: Drafts; token: string } | { ok: false; status: number; code: string };

const codeOf = (res: Response) => res.json().then((j: { code?: unknown }) => (typeof j.code === "string" ? j.code : "http_error")).catch(() => "http_error");

export async function requestExtraction(text: string, o: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<ExtractResult> {
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f("/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), ...(o.signal ? { signal: o.signal } : {}) });
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
  if (!res.ok) return { ok: false, status: res.status, code: await codeOf(res) };
  const parsed = await res.json().then(parseExtractResponse).catch(() => null);
  return parsed ? { ok: true, ...parsed } : { ok: false, status: res.status, code: "bad_response" };
}

export interface InputMode { mode: "samples" | "open"; extractReady: boolean; maxChars: number }
const ModeBody = z.object({ visitor_input: z.enum(["samples", "open"]), extract_ready: z.boolean(), max_input_chars: z.number().int().positive() });
/** What the server currently allows. Any failure means "samples" (gated): the UI never offers typing the server would refuse. */
export async function fetchInputMode(o: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<InputMode> {
  const f = o.fetchImpl ?? fetch;
  try {
    const res = await f("/api/input-mode", { cache: "no-store", ...(o.signal ? { signal: o.signal } : {}) });
    const p = ModeBody.safeParse(await res.json());
    if (res.ok && p.success) return { mode: p.data.visitor_input, extractReady: p.data.extract_ready, maxChars: p.data.max_input_chars };
  } catch {
    /* fall through */
  }
  return { mode: "samples", extractReady: false, maxChars: 2000 };
}

/** A reviewed extraction may be re-used only for the same text, and only while its token is comfortably inside the server's 2-hour window. */
export const REUSE_MS = 90 * 60 * 1000;
export function canReuse(ex: { text: string; at: number } | null, text: string, now: number): boolean {
  return !!ex && ex.text === text && now - ex.at >= 0 && now - ex.at < REUSE_MS;
}
