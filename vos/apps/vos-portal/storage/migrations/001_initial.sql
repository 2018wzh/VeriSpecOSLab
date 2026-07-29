create table if not exists schema_migrations (
  version bigint primary key,
  applied_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  username text not null,
  password_hash text,
  display_name text not null,
  role text not null check (role in ('admin','teacher','ta','student')),
  oidc_issuer text,
  oidc_subject text,
  status text not null default 'active',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (oidc_issuer, oidc_subject)
);
create unique index if not exists users_active_username_idx on users (lower(username)) where deleted_at is null;

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  token_hash text not null unique,
  csrf_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_id_idx on sessions (user_id);
create index if not exists sessions_active_token_idx on sessions (token_hash, expires_at) where revoked_at is null;

create table if not exists courses (
  id text primary key,
  code text not null,
  name text not null,
  term text not null,
  status text not null check (status in ('draft','published','active','grading','appeal','closed','archived')),
  manifest_version bigint not null default 1,
  manifest jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists courses_active_code_term_idx on courses (code, term) where deleted_at is null;

create table if not exists experiments (
  id text primary key,
  course_id text not null references courses(id),
  title text not null,
  spec_version text not null,
  publish_state text not null,
  base_repo_url text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists experiments_course_id_idx on experiments (course_id) where deleted_at is null;

create table if not exists stage_gates (
  id text primary key,
  experiment_id text not null references experiments(id),
  key text not null,
  name text not null,
  sequence integer not null check (sequence >= 0),
  status text not null,
  config jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (experiment_id, key),
  unique (experiment_id, sequence)
);
create index if not exists stage_gates_experiment_idx on stage_gates (experiment_id, sequence) where deleted_at is null;

create table if not exists projects (
  id text primary key,
  experiment_id text not null references experiments(id),
  current_stage_id text not null references stage_gates(id),
  repo_url text not null,
  status text not null check (status in ('provisioning','active','frozen','graded','archived')),
  policy_snapshot_ref text not null,
  frozen_commit_sha text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists projects_experiment_status_idx on projects (experiment_id, status) where deleted_at is null;

create table if not exists project_members (
  project_id text not null references projects(id),
  user_id text not null references users(id),
  member_role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_id_idx on project_members (user_id, project_id);

create table if not exists pipeline_runs (
  id text primary key,
  project_id text not null references projects(id),
  commit_sha text not null,
  stage_key text not null,
  scope text not null check (scope in ('public','staff','final')),
  status text not null check (status in ('queued','leased','running','passed','failed','cancelled','timed_out')),
  passed integer not null default 0,
  total integer not null default 0,
  failure_class text,
  public_message text not null default '',
  retry_of text references pipeline_runs(id),
  policy_snapshot_ref text not null,
  requested_by text not null references users(id),
  reason text not null,
  created_at timestamptz not null default now(),
  leased_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists pipeline_runs_project_created_idx on pipeline_runs (project_id, created_at desc);
create index if not exists pipeline_runs_queue_idx on pipeline_runs (created_at, id) where status = 'queued';

create table if not exists evidence_records (
  id text primary key,
  run_id text not null references pipeline_runs(id),
  suite text not null,
  case_name text not null,
  result text not null check (result in ('pass','fail','error','skipped')),
  visibility text not null check (visibility in ('public','student','staff','system')),
  metrics jsonb not null default '{}'::jsonb,
  public_message text,
  created_at timestamptz not null default now(),
  unique (run_id, suite, case_name, visibility)
);
create index if not exists evidence_run_visibility_idx on evidence_records (run_id, visibility);

create table if not exists object_refs (
  id text primary key,
  project_id text not null references projects(id),
  run_id text references pipeline_runs(id),
  uri text not null,
  sha256 text not null check (length(sha256) = 64),
  size_bytes bigint not null check (size_bytes >= 0),
  content_type text not null,
  visibility text not null check (visibility in ('public','student','staff','system')),
  label text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists object_refs_project_run_idx on object_refs (project_id, run_id) where deleted_at is null;

create table if not exists score_snapshots (
  id text primary key,
  project_id text not null references projects(id),
  baseline numeric(8,2) not null,
  final_score numeric(8,2) not null,
  state text not null check (state in ('draft','frozen','published')),
  evidence_refs jsonb not null default '[]'::jsonb,
  created_by text not null references users(id),
  created_at timestamptz not null default now()
);
create index if not exists score_project_created_idx on score_snapshots (project_id, created_at desc);

create table if not exists member_adjustments (
  id text primary key,
  score_snapshot_id text not null references score_snapshots(id),
  member_id text not null references users(id),
  delta numeric(8,2) not null,
  reason text not null check (length(reason) >= 10),
  evidence_refs jsonb not null,
  actor_id text not null references users(id),
  created_at timestamptz not null default now()
);
create index if not exists adjustments_snapshot_idx on member_adjustments (score_snapshot_id);

create table if not exists appeals (
  id text primary key,
  project_id text not null references projects(id),
  member_id text not null references users(id),
  status text not null check (status in ('submitted','fact_check','decision','closed')),
  statement text not null check (length(statement) >= 20),
  evidence_refs jsonb not null,
  decision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appeals_project_status_idx on appeals (project_id, status, created_at desc);

create table if not exists qa_threads (
  id text primary key,
  project_id text not null references projects(id),
  stage_key text not null,
  created_at timestamptz not null default now(),
  unique (project_id, stage_key)
);
create table if not exists qa_messages (
  id text primary key,
  thread_id text not null references qa_threads(id),
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  object_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists qa_messages_thread_created_idx on qa_messages (thread_id, created_at, id);

create table if not exists notifications (
  id text primary key,
  user_id text not null references users(id),
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_unread_idx on notifications (user_id, created_at desc) where read_at is null;

create table if not exists audit_events (
  id text primary key,
  actor_id text references users(id),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  reason text,
  trace_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_resource_created_idx on audit_events (resource_type, resource_id, created_at desc);

create table if not exists outbox_events (
  id text primary key,
  topic text not null,
  aggregate_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_pending_idx on outbox_events (created_at, id) where published_at is null;

create table if not exists idempotency_keys (
  actor_id text not null,
  key text not null,
  request_hash text not null,
  status_code integer not null,
  response jsonb not null,
  expires_at timestamptz not null,
  primary key (actor_id, key)
);
