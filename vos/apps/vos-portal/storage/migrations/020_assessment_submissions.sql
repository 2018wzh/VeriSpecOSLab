create table assessment_submissions (
  id text primary key,
  project_id text not null references projects(id),
  run_id text not null unique references pipeline_runs(id),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  stage_key text not null,
  spec_hash text not null check (spec_hash ~ '^[0-9a-f]{64}$'),
  config_hash text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  policy_snapshot_ref text not null,
  status text not null check (status in ('queued','evaluating','candidate','complete','failed')),
  submitted_by text not null references users(id),
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (project_id, commit_sha, stage_key, manifest_hash)
);
create index assessment_submissions_project_created_idx
  on assessment_submissions(project_id, submitted_at desc);
