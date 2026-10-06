-- Least privilege: the browser roles get nothing on these tables (new projects grant TRUNCATE/TRIGGER/REFERENCES by default).
revoke all on table public.trial_criteria_cache from anon, authenticated;
revoke all on table public.replay_cases        from anon, authenticated;
revoke all on table public.eval_runs           from anon, authenticated;
