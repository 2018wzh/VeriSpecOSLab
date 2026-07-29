create table enrollment_invites (
  id text primary key,
  course_id text not null references courses(id),
  code_hash char(64) not null unique,
  role text not null check (role in ('student','ta')),
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 500),
  uses integer not null default 0 check (uses >= 0 and uses <= max_uses),
  created_by text not null references users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  version integer not null default 1
);

create table enrollment_invite_redemptions (
  invite_id text not null references enrollment_invites(id),
  user_id text not null references users(id),
  redeemed_at timestamptz not null default now(),
  primary key (invite_id,user_id)
);

create index enrollment_invites_course_idx on enrollment_invites(course_id,created_at desc);
