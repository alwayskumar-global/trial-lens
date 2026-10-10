-- New Supabase projects do not auto-grant privileges on new public tables to the API roles, so the server-side
-- service role got "permission denied (42501)" on every table. Grant ONLY service_role. anon/authenticated stay denied
-- (RLS enabled, no policies, and no grants): the browser never touches these tables.
grant select, insert, update, delete on table public.trial_criteria_cache to service_role;
grant select, insert, update, delete on table public.replay_cases        to service_role;
grant select, insert, update, delete on table public.eval_runs           to service_role;
