alter table object_refs add column if not exists object_key text;
alter table object_refs add column if not exists upload_status text not null default 'verified'
  check (upload_status in ('pending','verified','rejected'));
alter table object_refs add column if not exists lineage jsonb not null default '{}'::jsonb;
create unique index if not exists object_refs_object_key_idx on object_refs (object_key) where object_key is not null;
create index if not exists object_refs_verified_project_idx on object_refs (project_id, created_at)
  where deleted_at is null and upload_status = 'verified';

alter table outbox_events add column if not exists attempts integer not null default 0;
alter table outbox_events add column if not exists next_attempt_at timestamptz not null default now();
alter table outbox_events add column if not exists last_error text;
create index if not exists outbox_dispatch_idx on outbox_events (next_attempt_at, created_at, id)
  where published_at is null;

create table if not exists gitea_webhook_deliveries (
  delivery_id text primary key,
  event_type text not null,
  repository_full_name text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
