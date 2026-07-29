create table if not exists design_submissions (
  id text primary key,
  project_id text not null references projects(id),
  stage_gate_id text not null references stage_gates(id),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40,64}$'),
  revision integer not null check (revision > 0),
  title text not null,
  summary text not null,
  invariants jsonb not null,
  interfaces jsonb not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  status text not null check (status in ('submitted','review','passed','changes_requested','frozen')),
  submitted_by text not null references users(id),
  reviewed_by text references users(id),
  review_feedback text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, stage_gate_id, revision),
  unique (project_id, stage_gate_id, commit_sha)
);
create index if not exists design_submissions_project_stage_idx
  on design_submissions (project_id, stage_gate_id, revision desc);

create table if not exists design_submission_events (
  id text primary key,
  submission_id text not null references design_submissions(id),
  actor_id text not null references users(id),
  from_status text,
  to_status text not null,
  reason text not null,
  feedback text,
  trace_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists design_submission_events_submission_idx
  on design_submission_events (submission_id, created_at, id);
