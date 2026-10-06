// The prepared FICTIONAL texts. In `VISITOR_INPUT_MODE=samples` these are the only texts the server will send to the model provider.
import { REPLAY_PROFILES } from "@/lib/sample/replay-profiles";
import { SAMPLE_TEXT } from "@/lib/sample/triallens-sample";

const norm = (t: string) => t.replace(/\s+/g, " ").trim();
const PREPARED = new Set([norm(SAMPLE_TEXT), ...REPLAY_PROFILES.map((p) => norm(p.text))]);

export const isPreparedText = (text: string): boolean => PREPARED.has(norm(text));

/** Control characters (except tab, CR, LF) are removed before any use; the visitor never sees them either way. */
export const stripControlChars = (text: string): string => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
