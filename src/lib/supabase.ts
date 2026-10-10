// Server-only Supabase client (service role). Used ONLY for: trial criteria cache, replay cases, eval results.
// No patient data tables, ever. RLS is on with no policies; this key bypasses it, so it must never reach the browser.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = getSupabaseEnv();
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}
