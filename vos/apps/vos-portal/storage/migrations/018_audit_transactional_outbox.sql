create or replace function enqueue_audit_outbox()
returns trigger
language plpgsql
as $$
begin
  insert into outbox_events(id, topic, aggregate_id, payload)
  values (
    'outbox-audit-' || new.id,
    'audit.recorded',
    new.id,
    jsonb_build_object(
      'audit_id', new.id,
      'actor_id', new.actor_id,
      'action', new.action,
      'resource_type', new.resource_type,
      'resource_id', new.resource_id,
      'trace_id', new.trace_id,
      'created_at', new.created_at
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists audit_events_transactional_outbox on audit_events;
create trigger audit_events_transactional_outbox
after insert on audit_events
for each row execute function enqueue_audit_outbox();
