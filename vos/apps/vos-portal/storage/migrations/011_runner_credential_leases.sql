alter table pipeline_runs
  add column if not exists model_credential_id text references model_credentials(id),
  add column if not exists lease_owner text,
  add column if not exists leased_until timestamptz;

create index if not exists pipeline_runs_active_lease_idx
  on pipeline_runs(leased_until, id)
  where status in ('leased', 'running');

create table if not exists model_credential_leases (
  id text primary key,
  credential_id text not null references model_credentials(id),
  run_id text not null references pipeline_runs(id),
  worker_id text not null,
  provider text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(run_id, credential_id)
);

create index if not exists model_credential_leases_expiry_idx
  on model_credential_leases(expires_at)
  where revoked_at is null;
