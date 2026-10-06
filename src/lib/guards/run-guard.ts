// Abuse and cost protection (SPEC §6): per-IP rate limit + global daily run budget. No CAPTCHA (judges need unrestricted
// access); the fallback for every refusal is the replay, never a blank error.
// Redis stores only hashed IP buckets and a per-day counter: no patient text, no raw IPs.
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getGuardEnv, getUpstashEnv } from "@/lib/env";

export type GuardDecision = { ok: true } | { ok: false; reason: "rate_limited" | "budget_exhausted" | "guard_unavailable" };

export interface RunGuard {
  check(ip: string): Promise<GuardDecision>;
}

export interface LimiterPort {
  limit(id: string): Promise<{ success: boolean }>;
}
export interface CounterPort {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** Hashed bucket id: Redis never sees a raw IP. */
export const ipBucket = (ip: string): string => createHash("sha256").update(ip).digest("hex").slice(0, 24);
export const dayKey = (now: Date): string => `tl:runs:${now.toISOString().slice(0, 10)}`; // UTC day

export function createRunGuard(o: { limiter: LimiterPort; counter: CounterPort; dailyBudget: number; now?: () => Date }): RunGuard {
  const now = o.now ?? (() => new Date());
  return {
    async check(ip) {
      try {
        // Per-IP first: a throttled visitor must not consume the global daily budget.
        const { success } = await o.limiter.limit(ipBucket(ip));
        if (!success) return { ok: false, reason: "rate_limited" };
        const key = dayKey(now());
        const used = await o.counter.incr(key);
        if (used === 1) await o.counter.expire(key, 172_800);
        if (used > o.dailyBudget) return { ok: false, reason: "budget_exhausted" };
        return { ok: true };
      } catch {
        return { ok: false, reason: "guard_unavailable" };
      }
    },
  };
}

/** Production guard: Upstash sliding window per IP + INCR daily counter. Throws EnvError if Upstash env is missing. */
export function createUpstashRunGuard(): RunGuard {
  const up = getUpstashEnv();
  const g = getGuardEnv();
  const redis = new Redis({ url: up.UPSTASH_REDIS_REST_URL, token: up.UPSTASH_REDIS_REST_TOKEN });
  const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(g.RATE_LIMIT_RUNS_PER_IP_PER_HOUR, "1 h"), prefix: "tl:rl", analytics: false });
  return createRunGuard({ limiter, counter: { incr: (k) => redis.incr(k), expire: (k, s) => redis.expire(k, s) }, dailyBudget: g.DAILY_RUN_BUDGET });
}

/** First hop of x-forwarded-for (Vercel), else x-real-ip, else a constant bucket. Not trusted for anything but throttling. */
export function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}
