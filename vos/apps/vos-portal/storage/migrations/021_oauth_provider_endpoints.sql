alter table oidc_providers
  add column if not exists authorization_endpoint text,
  add column if not exists token_endpoint text,
  add column if not exists userinfo_endpoint text,
  add column if not exists subject_claim text;

alter table oidc_providers
  drop constraint if exists oidc_providers_oauth_endpoint_https;

alter table oidc_providers
  add constraint oidc_providers_oauth_endpoint_https check (
    (
      authorization_endpoint is null and token_endpoint is null and
      userinfo_endpoint is null and subject_claim is null
    ) or (
      authorization_endpoint like 'https://%' and
      token_endpoint like 'https://%' and
      userinfo_endpoint like 'https://%' and subject_claim is not null
    )
  );
