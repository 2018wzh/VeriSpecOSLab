alter table qa_messages add column if not exists requested_by text references users(id);
alter table qa_messages add column if not exists request_message_id text references qa_messages(id);
alter table qa_messages add column if not exists status text not null default 'completed' check(status in ('queued','completed','failed'));
create unique index if not exists qa_messages_request_response_idx on qa_messages(request_message_id) where request_message_id is not null;

create table if not exists agent_audits (
  id text primary key,
  project_id text not null references projects(id),
  actor_id text not null references users(id),
  thread_id text not null references qa_threads(id),
  request_message_id text not null unique references qa_messages(id),
  provider text not null,
  model text not null,
  task_kind text not null,
  risk_level text not null check(risk_level in ('low','medium','high','critical')),
  risk_flags jsonb not null default '[]'::jsonb,
  prompt_summary text not null,
  response_summary text,
  provider_session_id text,
  created_at timestamptz not null default now()
);
create index if not exists agent_audits_project_created_idx on agent_audits(project_id,created_at desc);
