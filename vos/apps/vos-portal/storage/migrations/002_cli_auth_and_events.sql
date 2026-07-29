create table if not exists device_authorizations (
  id text primary key,
  device_code_hash text not null unique,
  user_code text not null unique,
  client_name text not null,
  status text not null check (status in ('pending','approved','denied','consumed','expired')),
  user_id text references users(id),
  interval_seconds integer not null default 5 check (interval_seconds between 2 and 30),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists device_authorizations_pending_idx
  on device_authorizations (expires_at, created_at) where status = 'pending';

create table if not exists pipeline_events (
  run_id text not null references pipeline_runs(id),
  sequence bigint not null,
  event_type text not null,
  visibility text not null check (visibility in ('public','student','staff','system')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  primary key (run_id, sequence)
);
create index if not exists pipeline_events_stream_idx on pipeline_events (run_id, sequence);

alter table sessions add column if not exists token_kind text not null default 'web'
  check (token_kind in ('web','cli','service'));
alter table sessions add column if not exists scopes jsonb not null default '[]'::jsonb;
