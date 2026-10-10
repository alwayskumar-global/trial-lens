-- New projects also grant TRUNCATE/TRIGGER/REFERENCES by default. TRUNCATE would wipe a table in one statement and no
-- operation needs it, so the server role keeps only select/insert/update (eval_runs: select/insert).
revoke truncate, trigger, references on table public.trial_criteria_cache, public.replay_cases, public.eval_runs from service_role;
