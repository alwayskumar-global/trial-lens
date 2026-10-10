-- Least privilege for the server-side role. Current operations: cache + replay are upserts (select/insert/update);
-- eval results are append-only (select/insert). Nothing deletes: stale parses are superseded by a new
-- (source_version, parser_version) key, not removed. Grant DELETE again in a new migration if an operation needs it.
revoke delete on table public.trial_criteria_cache from service_role;
revoke delete on table public.replay_cases from service_role;
revoke delete, update on table public.eval_runs from service_role;
