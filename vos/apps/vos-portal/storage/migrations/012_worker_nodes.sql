create table if not exists worker_nodes (
  id text primary key,
  started_at timestamptz not null default now(),
  last_heartbeat timestamptz not null default now(),
  current_run_id text references pipeline_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists worker_nodes_heartbeat_idx on worker_nodes(last_heartbeat desc, id);
