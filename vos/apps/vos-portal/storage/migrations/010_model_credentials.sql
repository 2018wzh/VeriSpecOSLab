create table if not exists model_credentials (
  id text primary key,
  owner_id text not null references users(id),
  provider text not null,
  label text not null,
  last_four text not null check(length(last_four) = 4),
  secret_cipher bytea not null,
  secret_iv bytea not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists model_credentials_active_label_idx
  on model_credentials(owner_id, provider, label) where revoked_at is null;
create index if not exists model_credentials_owner_created_idx
  on model_credentials(owner_id, created_at desc);
