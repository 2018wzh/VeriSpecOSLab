alter table courses add column if not exists published_manifest_version bigint;

create table if not exists course_manifest_versions (
  course_id text not null references courses(id),
  version bigint not null check (version > 0),
  state text not null check (state in ('draft','published','superseded')),
  manifest jsonb not null,
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  rollback_of bigint,
  created_by text not null references users(id),
  reason text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (course_id, version),
  foreign key (course_id, rollback_of) references course_manifest_versions(course_id, version)
);
create unique index if not exists course_manifest_one_draft_idx on course_manifest_versions(course_id) where state='draft';
create unique index if not exists course_manifest_one_published_idx on course_manifest_versions(course_id) where state='published';

create table if not exists course_memberships (
  course_id text not null references courses(id),
  user_id text not null references users(id),
  role text not null check (role in ('teacher','ta','student')),
  status text not null default 'active' check (status in ('active','inactive')),
  source text not null check (source in ('csv','invite','oidc','manual')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (course_id,user_id)
);
create index if not exists course_memberships_user_idx on course_memberships(user_id,course_id) where status='active';

create table if not exists course_groups (
  id text primary key,
  course_id text not null references courses(id),
  name text not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id,name),
  unique(id,course_id)
);
create table if not exists course_group_members (
  group_id text not null,
  course_id text not null references courses(id),
  user_id text not null references users(id),
  created_at timestamptz not null default now(),
  primary key(group_id,user_id),
  foreign key(group_id,course_id) references course_groups(id,course_id) on delete cascade,
  unique(course_id,user_id)
);
create index if not exists course_group_members_course_idx on course_group_members(course_id,group_id);

create table if not exists course_rubric_items (
  course_id text not null,
  manifest_version bigint not null,
  item_id text not null,
  name text not null,
  weight numeric(12,4) not null check(weight>=0),
  primary key(course_id,manifest_version,item_id),
  foreign key(course_id,manifest_version) references course_manifest_versions(course_id,version)
);
create table if not exists course_ai_policies (
  course_id text not null,
  manifest_version bigint not null,
  policy jsonb not null,
  primary key(course_id,manifest_version),
  foreign key(course_id,manifest_version) references course_manifest_versions(course_id,version)
);

update courses set published_manifest_version=manifest_version where published_manifest_version is null and status<>'draft';
