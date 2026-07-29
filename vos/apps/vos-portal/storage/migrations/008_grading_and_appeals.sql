alter table score_snapshots add column if not exists snapshot_version bigint;
with ranked as (
  select id, row_number() over (partition by project_id order by created_at, id) as version
  from score_snapshots
)
update score_snapshots set snapshot_version = ranked.version
from ranked where score_snapshots.id = ranked.id and score_snapshots.snapshot_version is null;
alter table score_snapshots alter column snapshot_version set not null;
alter table score_snapshots add column if not exists previous_snapshot_id text references score_snapshots(id);
alter table score_snapshots add column if not exists transition_reason text;
create unique index if not exists score_project_version_idx on score_snapshots(project_id, snapshot_version);

alter table appeals add column if not exists score_snapshot_id text references score_snapshots(id);
alter table appeals add column if not exists resolved_score_snapshot_id text references score_snapshots(id);
alter table score_snapshots add column if not exists source_appeal_id text references appeals(id);
create unique index if not exists appeals_active_member_idx
  on appeals(project_id, member_id)
  where status in ('submitted', 'fact_check', 'decision');

create table if not exists appeal_events (
  id text primary key,
  appeal_id text not null references appeals(id),
  from_status text,
  to_status text not null check (to_status in ('submitted','fact_check','decision','closed')),
  actor_id text not null references users(id),
  reason text not null check (length(reason) >= 10),
  decision text,
  score_delta numeric(8,2),
  score_snapshot_id text references score_snapshots(id),
  created_at timestamptz not null default now()
);
create index if not exists appeal_events_appeal_created_idx on appeal_events(appeal_id, created_at, id);
