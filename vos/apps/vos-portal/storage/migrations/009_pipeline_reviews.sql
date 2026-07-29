create table if not exists pipeline_reviews (
  run_id text primary key references pipeline_runs(id),
  status text not null check(status in ('pending','assigned','approved','escalated','rerun_approved')),
  assigned_to text references users(id),
  reason text not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pipeline_reviews_status_updated_idx on pipeline_reviews(status, updated_at desc);

create table if not exists pipeline_review_events (
  id text primary key,
  run_id text not null references pipeline_runs(id),
  action text not null check(action in ('assign','approve','escalate','rerun')),
  actor_id text not null references users(id),
  reason text not null check(length(reason) >= 10),
  retry_run_id text references pipeline_runs(id),
  created_at timestamptz not null default now()
);
create index if not exists pipeline_review_events_run_created_idx on pipeline_review_events(run_id, created_at, id);
