// Abuse and cost protection (SPEC §6): per-IP rate limit + global daily run budget. No CAPTCHA (judges need unrestricted
// access); the fallback for every refusal is the replay, never a blank error.
// Redis stores only hashed IP buckets and a per-day counter: no patient text, no raw IPs.
import { createHash, createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getGuardEnv, getUpstashEnv, getVisitorEnv } from "@/lib/env";
import { visitorConfig } from "@/lib/visitor-config";

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

/**
 * Hashed bucket id: Redis never sees a raw IP. With a secret salt (RATE_LIMIT_IP_SALT) the hash cannot be brute-forced back to an
 * IPv4 address; without one it is a plain truncated SHA-256 (fine for the fictional-only phase, required before visitor input opens).
 */
export const ipBucket = (ip: string, salt?: string): string =>
  (salt ? createHmac("sha256", salt).update(ip) : createHash("sha256").update(ip)).digest("hex").slice(0, 24);
export const dayKey = (now: Date, prefix = "tl:runs"): string => `${prefix}:${now.toISOString().slice(0, 10)}`; // UTC day

export function createRunGuard(o: { limiter: LimiterPort; counter: CounterPort; dailyBudget: number; now?: () => Date; ipSalt?: string; dayPrefix?: string }): RunGuard {
  const now = o.now ?? (() => new Date());
  return {
    async check(ip) {
      try {
        // Per-IP first: a throttled visitor must not consume the global daily budget.
        const { success } = await o.limiter.limit(ipBucket(ip, o.ipSalt));
        if (!success) return { ok: false, reason: "rate_limited" };
        const key = dayKey(now(), o.dayPrefix);
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

const redisFromEnv = () => {
  const up = getUpstashEnv();
  return new Redis({ url: up.UPSTASH_REDIS_REST_URL, token: up.UPSTASH_REDIS_REST_TOKEN });
};
const counterOf = (redis: Redis): CounterPort => ({ incr: (k) => redis.incr(k), expire: (k, s) => redis.expire(k, s) });

/** Production guard: Upstash sliding window per IP + INCR daily counter. Throws EnvError if Upstash env is missing. */
export function createUpstashRunGuard(): RunGuard {
  const g = getGuardEnv();
  const redis = redisFromEnv();
  const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(g.RATE_LIMIT_RUNS_PER_IP_PER_HOUR, "1 h"), prefix: "tl:rl", analytics: false });
  return createRunGuard({ limiter, counter: counterOf(redis), dailyBudget: g.DAILY_RUN_BUDGET, ipSalt: visitorConfig().ipSalt }); // never throws: a bad visitor config must not take the run guard down
}

/** Separate window and daily budget for /api/extract so extract + run is neither double-charged nor unmetered. */
export function createUpstashExtractGuard(): RunGuard {
  const v = getVisitorEnv();
  const redis = redisFromEnv();
  const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(v.RATE_LIMIT_EXTRACT_PER_IP_PER_HOUR, "1 h"), prefix: "tl:rlx", analytics: false });
  return createRunGuard({ limiter, counter: counterOf(redis), dailyBudget: v.DAILY_EXTRACT_BUDGET, ipSalt: v.RATE_LIMIT_IP_SALT, dayPrefix: "tl:extracts" });
}

// Global cap on in-flight runs: a run holds up to 40 model slots for ~90 s, so unbounded concurrency is a cost and latency risk.
export interface GateCounterPort extends CounterPort {
  decr(key: string): Promise<number>;
}
export type GateDecision = { ok: true; release: () => Promise<void> } | { ok: false; reason: "busy" | "guard_unavailable" };
export interface ConcurrencyGate {
  acquire(): Promise<GateDecision>;
}
const INFLIGHT_KEY = "tl:inflight";
const INFLIGHT_TTL_SECONDS = 600; // safety valve: a crashed run can never wedge the counter for longer than this

export function createConcurrencyGate(o: { counter: GateCounterPort; max: number }): ConcurrencyGate {
  return {
    async acquire() {
      try {
        const n = await o.counter.incr(INFLIGHT_KEY);
        if (n === 1) await o.counter.expire(INFLIGHT_KEY, INFLIGHT_TTL_SECONDS);
        if (n > o.max) {
          await o.counter.decr(INFLIGHT_KEY);
          return { ok: false, reason: "busy" };
        }
        let released = false;
        return {
          ok: true,
          release: async () => {
            if (released) return;
            released = true;
            try {
              await o.counter.decr(INFLIGHT_KEY);
            } catch {
              /* the TTL reclaims it */
            }
          },
        };
      } catch {
        return { ok: false, reason: "guard_unavailable" };
      }
    },
  };
}

export function createUpstashConcurrencyGate(): ConcurrencyGate {
  const redis = redisFromEnv();
  return createConcurrencyGate({ counter: { ...counterOf(redis), decr: (k) => redis.decr(k) }, max: getVisitorEnv().MAX_CONCURRENT_RUNS });
}

/**
 * Client IP for throttling only. Prefers the platform-set header (Vercel overwrites it, so a visitor cannot choose it), then the
 * first x-forwarded-for hop, then x-real-ip. No header at all ⇒ one shared "unknown" bucket, which is deliberately the strictest.
 */
export function clientIp(h: Headers): string {
  return h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}
