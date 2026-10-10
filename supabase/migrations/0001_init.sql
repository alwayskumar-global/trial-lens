-- TrialLens initial schema. Source: SCHEMA.md §4.
-- No patient data. RLS on, no policies (service role bypasses RLS; anon/authenticated get nothing).
-- NOTE: gen_random_uuid() is built into Postgres 13+ (Supabase default).

create table if not exists trial_criteria_cache (
  nct_id          text        not null,
  source_version  text        not null,   -- CT.gov last-update date string (VERIFY field)
  parser_version  text        not null,
  parsed          jsonb       not null,   -- ParsedCriterion[]
  created_at      timestamptz not null default now(),
  primary key (nct_id, parser_version, source_version)
);

create table if not exists replay_cases (
  id          text primary key,           -- e.g. 'her2pos-stage3'
  label       text        not null,
  profile     jsonb       not null,       -- FICTIONAL profile only
  result      jsonb       not null,       -- full precomputed run output
  created_at  timestamptz not null default now()
);

create table if not exists eval_runs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  config      jsonb       not null,       -- models, parser_version, thresholds
  metrics     jsonb       not null
);

alter table trial_criteria_cache enable row level security;
alter table replay_cases        enable row level security;
alter table eval_runs           enable row level security;
-- intentionally no policies
