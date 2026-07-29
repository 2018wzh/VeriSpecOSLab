#!/bin/sh
set -eu

case "${1:-}" in
  backup) exec /opt/vos-portal/ops/backup.sh ;;
  restore) exec /opt/vos-portal/ops/restore.sh ;;
  *) echo "usage: backup|restore" >&2; exit 64 ;;
esac
