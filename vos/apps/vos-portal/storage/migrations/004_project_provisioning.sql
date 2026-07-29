alter table projects alter column repo_url drop not null;

create table if not exists project_repositories (
  project_id text primary key references projects(id) on delete cascade,
  provider text not null check (provider = 'gitea'),
  owner_name text not null,
  repository_name text not null,
  template_owner text not null,
  template_repository text not null,
  description text not null,
  is_private boolean not null default true,
  status text not null check (status in ('queued','provisioning','active','failed')),
  provider_repository_id bigint,
  clone_url text,
  html_url text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, owner_name, repository_name)
);
create index if not exists project_repositories_status_idx
  on project_repositories (status, updated_at, project_id);

alter table outbox_events add column if not exists lease_owner text;
alter table outbox_events add column if not exists leased_until timestamptz;
create index if not exists outbox_lease_idx
  on outbox_events (topic, next_attempt_at, created_at, id)
  where published_at is null;

create table if not exists project_commit_ledger (
  id text primary key,
  project_id text not null references projects(id),
  delivery_id text not null references gitea_webhook_deliveries(delivery_id),
  ref_name text not null,
  before_sha text,
  after_sha text not null,
  pusher_username text,
  received_at timestamptz not null default now(),
  unique (project_id, delivery_id)
);
create index if not exists project_commit_ledger_project_received_idx
  on project_commit_ledger (project_id, received_at desc);
