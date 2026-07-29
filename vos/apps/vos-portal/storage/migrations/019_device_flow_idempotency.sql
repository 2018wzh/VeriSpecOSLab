alter table device_authorizations
  add column if not exists request_key_hash text;

alter table device_authorizations
  add column if not exists request_hash text;

create unique index if not exists device_authorizations_request_key_idx
  on device_authorizations(request_key_hash)
  where request_key_hash is not null;
