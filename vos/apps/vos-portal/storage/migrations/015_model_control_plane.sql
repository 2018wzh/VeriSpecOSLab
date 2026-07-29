create table if not exists model_providers (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('openai','openai-compatible','anthropic','deepseek','ollama')),
  base_url text not null,
  models text[] not null check (cardinality(models) between 1 and 100),
  default_model text not null,
  secret_cipher bytea,
  secret_iv bytea,
  input_cost_per_million_usd numeric(14,6) not null check (input_cost_per_million_usd >= 0),
  output_cost_per_million_usd numeric(14,6) not null check (output_cost_per_million_usd >= 0),
  max_output_tokens integer not null check (max_output_tokens between 256 and 131072),
  enabled boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  updated_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_model = any(models)),
  check ((secret_cipher is null) = (secret_iv is null)),
  check (kind = 'ollama' or secret_cipher is not null)
);
create index if not exists model_providers_enabled_models_idx on model_providers using gin(models) where enabled;

create table if not exists model_quota_policies (
  id text primary key,
  course_id text not null references courses(id),
  user_id text references users(id),
  monthly_request_limit integer not null check (monthly_request_limit between 1 and 1000000),
  monthly_token_limit bigint not null check (monthly_token_limit between 1000 and 10000000000),
  monthly_cost_limit_usd numeric(14,6) not null check (monthly_cost_limit_usd > 0),
  enabled boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  updated_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (course_id,user_id)
);
create index if not exists model_quota_course_user_idx on model_quota_policies(course_id,user_id) where enabled;

create table if not exists model_usage_ledger (
  id text primary key,
  request_message_id text not null unique references qa_messages(id),
  course_id text not null references courses(id),
  user_id text not null references users(id),
  provider_id text not null references model_providers(id),
  model text not null,
  period date not null,
  status text not null check (status in ('reserved','settled','released')),
  reserved_tokens bigint not null check (reserved_tokens >= 0),
  reserved_cost_usd numeric(14,6) not null check (reserved_cost_usd >= 0),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  actual_cost_usd numeric(14,6) check (actual_cost_usd is null or actual_cost_usd >= 0),
  provider_session_id text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists model_usage_quota_idx on model_usage_ledger(course_id,user_id,period,status);

alter table agent_audits add column if not exists input_tokens bigint check (input_tokens is null or input_tokens >= 0);
alter table agent_audits add column if not exists output_tokens bigint check (output_tokens is null or output_tokens >= 0);
alter table agent_audits add column if not exists total_tokens bigint check (total_tokens is null or total_tokens >= 0);
alter table agent_audits add column if not exists actual_cost_usd numeric(14,6) check (actual_cost_usd is null or actual_cost_usd >= 0);
