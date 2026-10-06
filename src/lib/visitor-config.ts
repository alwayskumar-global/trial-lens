// Server-only visitor-input configuration for the routes. A misconfigured `open` mode (missing secret or salt) degrades to the safe
// `samples` mode instead of throwing, so the fictional flow keeps working and no arbitrary text is ever accepted by mistake.
import { getVisitorEnv } from "@/lib/env";

export interface VisitorConfig {
  mode: "samples" | "open";
  signingSecret: string | undefined;
  ipSalt: string | undefined;
}

export function visitorConfig(): VisitorConfig {
  try {
    const v = getVisitorEnv();
    return { mode: v.VISITOR_INPUT_MODE, signingSecret: v.PROFILE_SIGNING_SECRET, ipSalt: v.RATE_LIMIT_IP_SALT };
  } catch {
    return { mode: "samples", signingSecret: undefined, ipSalt: undefined };
  }
}
