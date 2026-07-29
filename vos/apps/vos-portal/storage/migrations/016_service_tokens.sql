alter table sessions add column if not exists label text;
alter table sessions add column if not exists created_by text references users(id);

create index if not exists sessions_service_tokens_idx
  on sessions(user_id,created_at desc)
  where token_kind='service';
