#!/bin/sh
# Phase 13 WI-4 — container start: restore if needed, then run the server
# under Litestream so every database change is copied to Cloudflare R2.
#
# 1. A new or lost volume has no database: `litestream restore` brings back
#    the latest backup before anything opens the file. With no backup yet
#    (the very first start) it does nothing and exits 0.
# 2. `litestream replicate -exec` starts the server as its child. On SIGTERM
#    (idle stop, deploy) Litestream passes the signal to the server, waits for
#    it to drain and exit (server.ts), then uploads the last changes.
#
# Before either: a pending import (Phase 13.1 WI-1). If <db>.import exists,
# db/pending-import.ts checks it and swaps it in, keeping the previous file as
# <db>.pre-import-<timestamp>. It runs here because the database must never be
# replaced while Litestream watches it. After a swap, `litestream reset` clears
# Litestream's local tracking state for the replaced file, so the next sync
# starts a fresh snapshot of the imported one instead of continuing the old
# file's history. A refused import changes nothing and the start goes on.
#
# Fails closed, like DEVICE_TOKENS: production without backup credentials
# refuses to start. A throwaway staging app opts out with
# LITESTREAM_DISABLED=true.
set -eu

DB="${WINE_DB_PATH:-/data/wine.db}"
export WINE_DB_PATH="$DB"
SERVER="node backend/dist/backend/server.js"

# Sets imported=true when it swapped a file in. A refusal leaves the .import
# file in place (and logs why); an unexpected error stops the start.
imported=false
apply_pending_import() {
  if [ -f "$DB.import" ]; then
    node backend/dist/backend/db/pending-import.js
    [ -f "$DB.import" ] || imported=true
  fi
}

if [ "${LITESTREAM_DISABLED:-}" = "true" ]; then
  echo "Backups are OFF (LITESTREAM_DISABLED=true); staging use only."
  apply_pending_import
  exec $SERVER
fi

missing=""
for name in LITESTREAM_BUCKET LITESTREAM_ENDPOINT LITESTREAM_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || missing="$missing $name"
done
if [ -n "$missing" ]; then
  echo "Refusing to start without backups; not set:$missing (set LITESTREAM_DISABLED=true only on a staging app)." >&2
  exit 1
fi

apply_pending_import

# Any failure other than "no backup exists yet" stops the start: better a
# machine that won't boot than a server running on an empty database while a
# real backup sits unreachable.
# After an import the database exists, so this is a no-op then.
litestream restore -if-db-not-exists -if-replica-exists "$DB"

# Not fatal: the import is already in place, and a later start would not know
# to retry. The runbook's cutover check looks for this line and a new snapshot.
if [ "$imported" = "true" ]; then
  echo "Import applied; resetting Litestream's local state so the next sync snapshots the new file."
  litestream reset "$DB" || echo "WARNING: litestream reset failed after the import; check the backup as in docs/ops/runbook.md, Data cutover." >&2
fi

exec litestream replicate -exec "$SERVER"
