create table if not exists oidc_providers (
  id text primary key,
  name text not null,
  issuer text not null unique,
  client_id text not null,
  client_secret_cipher bytea not null,
  client_secret_iv bytea not null,
  scopes text[] not null default array['openid','profile','email'],
  username_claim text not null default 'preferred_username',
  display_name_claim text not null default 'name',
  role_claim text,
  role_mappings jsonb not null default '{}'::jsonb,
  default_role text not null default 'student' check(default_role in ('teacher','ta','student')),
  enabled boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists oidc_authorizations (
  id text primary key,
  provider_id text not null references oidc_providers(id),
  state_hash text not null unique check(state_hash ~ '^[0-9a-f]{64}$'),
  flow_cipher bytea not null,
  flow_iv bytea not null,
  return_to text not null default '/workspace',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists oidc_authorizations_active_idx on oidc_authorizations(state_hash,expires_at) where consumed_at is null;
