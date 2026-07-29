#!/bin/sh
set -eu
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${VOS_S3_ENDPOINT:?VOS_S3_ENDPOINT is required}"
: "${VOS_S3_BUCKET:?VOS_S3_BUCKET is required}"
: "${VOS_S3_ACCESS_KEY:?VOS_S3_ACCESS_KEY is required}"
: "${VOS_S3_SECRET_KEY:?VOS_S3_SECRET_KEY is required}"
: "${BACKUP_ROOT:?BACKUP_ROOT is required}"

backup_name="${VOS_BACKUP_NAME:-$(date -u +%Y%m%dT%H%M%SZ)}"
case "$backup_name" in *[!A-Za-z0-9._-]*|'') echo "VOS_BACKUP_NAME is invalid" >&2; exit 64 ;; esac
target="$BACKUP_ROOT/$backup_name"
if [ -e "$target" ]; then echo "backup target already exists: $backup_name" >&2; exit 73; fi
mkdir -p "$target/objects"

invalid_keys="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from object_refs where deleted_at is null and (object_key !~ '^[A-Za-z0-9._/-]+$' or object_key like '/%' or object_key like '%//' or object_key ~ '(^|/)\\.{1,2}(/|$)' or sha256 !~ '^[0-9a-f]{64}$')")"
if [ "$invalid_keys" != "0" ]; then echo "object_refs contains keys that cannot be represented safely in this backup format" >&2; exit 65; fi

pg_dump --format=custom --no-owner --no-privileges --file="$target/postgres.dump" "$DATABASE_URL"
mc alias set source "$VOS_S3_ENDPOINT" "$VOS_S3_ACCESS_KEY" "$VOS_S3_SECRET_KEY" >/dev/null
mc mirror --overwrite --preserve "source/$VOS_S3_BUCKET" "$target/objects"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -AtF '|' -c "select object_key,sha256 from object_refs where upload_status='verified' and deleted_at is null order by object_key" |
while IFS='|' read -r object_key expected; do
  [ -n "$object_key" ] || continue
  object_path="$target/objects/$object_key"
  if [ ! -f "$object_path" ]; then echo "verified object is missing from backup source: $object_key" >&2; exit 65; fi
  actual="$(sha256sum "$object_path" | cut -d ' ' -f 1)"
  if [ "$actual" != "$expected" ]; then echo "backup object checksum mismatch: $object_key" >&2; exit 65; fi
done

schema_version="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select coalesce(max(version),0) from schema_migrations")"
object_count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from object_refs where upload_status='verified' and deleted_at is null")"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"version":"vos-portal-backup.v1","name":"%s","created_at":"%s","schema_version":%s,"verified_object_refs":%s,"bucket":"%s"}\n' "$backup_name" "$created_at" "$schema_version" "$object_count" "$VOS_S3_BUCKET" > "$target/manifest.json"
(cd "$target" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS)
printf '%s\n' "$backup_name"
