// Tells the UI what the server will accept, so the page never offers a text box that the server would refuse (403).
// Non-secret: reports only the effective mode, whether extraction can run (a signing secret exists), and the input limit.
import { getPipelineEnv } from "@/lib/env";
import { visitorConfig } from "@/lib/visitor-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const v = visitorConfig();
  let max = 2000;
  try {
    max = getPipelineEnv().MAX_INPUT_CHARS;
  } catch {
    /* default */
  }
  return Response.json({ visitor_input: v.mode, extract_ready: !!v.signingSecret, max_input_chars: max }, { headers: { "cache-control": "no-store" } });
}
