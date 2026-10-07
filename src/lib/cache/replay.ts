// Replay mode (SPEC §6): precomputed full outputs for FICTIONAL profiles, stored in Supabase `replay_cases`.
// A replay is always labelled as such to the client ("mode" event); it never poses as a live run.
import { z } from "zod";
import { applyCeilingToAssessment } from "@/lib/engine/ceiling";
import { getSupabase } from "@/lib/supabase";
import { SseEventSchema, type SseEvent } from "@/schema/sse";

/** Events that make up a stored run. `mode` and `done` are added at replay time, never stored. */
export type StoredEvent = Exclude<SseEvent, { type: "mode" | "done" | "error" }>;
export const StoredEventsSchema = z.array(SseEventSchema).transform((es) => es.filter((e): e is StoredEvent => e.type !== "mode" && e.type !== "done" && e.type !== "error"));

export interface ReplayCase {
  id: string;
  label: string;
  profile_text: string; // FICTIONAL profile text the case was generated from
  events: StoredEvent[];
}

export interface ReplayStore {
  /** Case by id, or the default (first by id) when id is undefined. Null when none/unavailable. */
  get(id?: string): Promise<ReplayCase | null>;
  put(c: ReplayCase): Promise<void>;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isReplayId = (s: string): boolean => ID.test(s);

export class MemoryReplayStore implements ReplayStore {
  private m = new Map<string, ReplayCase>();
  async get(id?: string) {
    if (id) return this.m.get(id) ?? null;
    return [...this.m.values()].sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
  }
  async put(c: ReplayCase) {
    this.m.set(c.id, c);
  }
}

export class SupabaseReplayStore implements ReplayStore {
  async get(id?: string): Promise<ReplayCase | null> {
    try {
      const q = getSupabase().from("replay_cases").select("id,label,profile,result");
      const { data, error } = await (id ? q.eq("id", id).maybeSingle() : q.order("id", { ascending: true }).limit(1).maybeSingle());
      if (error || !data) return null;
      const profile = z.object({ text: z.string() }).safeParse(data.profile);
      const events = z.object({ events: StoredEventsSchema }).safeParse(data.result);
      if (!profile.success || !events.success) return null;
      return { id: String(data.id), label: String(data.label), profile_text: profile.data.text, events: events.data.events };
    } catch {
      return null;
    }
  }
  async put(c: ReplayCase): Promise<void> {
    const { error } = await getSupabase().from("replay_cases").upsert({ id: c.id, label: c.label, profile: { text: c.profile_text }, result: { events: c.events } }, { onConflict: "id" });
    if (error) throw new Error("REPLAY_WRITE_FAILED");
  }
}

/**
 * The event sequence for streaming a stored case: labelled `mode`, the stored events, then `done`.
 * `stage` events are NOT replayed: a saved run must never look like live progress to any consumer of the stream.
 * Policy R2 is applied at read time: results stored before it (which may hold STRONG or LIKELY_MISMATCH) are streamed under the ceiling.
 */
export function replayEvents(c: ReplayCase, reason: Extract<SseEvent, { type: "mode" }>["reason"]): SseEvent[] {
  return [{ type: "mode", mode: "replay", ...(reason ? { reason } : {}), replay_id: c.id, label: c.label }, ...c.events.filter((e) => e.type !== "stage").map((e): SseEvent => (e.type === "trial_result" ? { ...e, assessment: applyCeilingToAssessment(e.assessment) } : e)), { type: "done", replay: true }];
}
