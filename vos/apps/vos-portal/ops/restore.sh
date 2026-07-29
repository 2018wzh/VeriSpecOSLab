#!/bin/sh
set -eu
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${VOS_S3_ENDPOINT:?VOS_S3_ENDPOINT is required}"
: "${VOS_S3_BUCKET:?VOS_S3_BUCKET is required}"
: "${VOS_S3_ACCESS_KEY:?VOS_S3_ACCESS_KEY is required}"
: "${VOS_S3_SECRET_KEY:?VOS_S3_SECRET_KEY is required}"
: "${BACKUP_ROOT:?BACKUP_ROOT is required}"
: "${VOS_BACKUP_NAME:?VOS_BACKUP_NAME is required}"

case "$VOS_BACKUP_NAME" in *[!A-Za-z0-9._-]*|'') echo "VOS_BACKUP_NAME is invalid" >&2; exit 64 ;; esac
if [ "${VOS_RESTORE_CONFIRM:-}" != "restore:$VOS_BACKUP_NAME" ]; then echo "set VOS_RESTORE_CONFIRM=restore:$VOS_BACKUP_NAME" >&2; exit 64; fi
source_dir="$BACKUP_ROOT/$VOS_BACKUP_NAME"
test -f "$source_dir/postgres.dump"
test -f "$source_dir/manifest.json"
test -f "$source_dir/SHA256SUMS"
(cd "$source_dir" && sha256sum -c SHA256SUMS)

mc alias set target "$VOS_S3_ENDPOINT" "$VOS_S3_ACCESS_KEY" "$VOS_S3_SECRET_KEY" >/dev/null
mc mb --ignore-existing "target/$VOS_S3_BUCKET" >/dev/null
existing_objects="$(mc find "target/$VOS_S3_BUCKET" --print '{key}')"
if [ -n "$existing_objects" ]; then
  echo "restore target bucket must be empty" >&2
  exit 65
fi
mc mirror --overwrite --preserve "$source_dir/objects" "target/$VOS_S3_BUCKET"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$source_dir/postgres.dump"

if [ "${VOS_RESTORE_VERIFY_OBJECTS:-1}" = "1" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -AtF '|' -c "select object_key,sha256 from object_refs where upload_status='verified' and deleted_at is null order by object_key" |
  while IFS='|' read -r object_key expected; do
    [ -n "$object_key" ] || continue
    actual="$(mc cat "target/$VOS_S3_BUCKET/$object_key" | sha256sum | cut -d ' ' -f 1)"
    if [ "$actual" != "$expected" ]; then echo "restored object checksum mismatch: $object_key" >&2; exit 65; fi
  done
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select max(version) from schema_migrations" >/dev/null
printf '%s\n' "$VOS_BACKUP_NAME"
