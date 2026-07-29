create table if not exists retention_policies (
  scope text primary key check (scope = 'global'),
  ordinary_days integer not null check (ordinary_days between 1 and 365),
  records_days integer not null check (records_days between 30 and 3650 and records_days > ordinary_days),
  revision bigint not null check (revision > 0),
  updated_by text references users(id),
  updated_at timestamptz not null default now()
);
insert into retention_policies(scope,ordinary_days,records_days,revision)
values('global',30,365,1)
on conflict(scope) do nothing;
