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
# Fails closed, like DEVICE_TOKENS: production without backup credentials
# refuses to start. A throwaway staging app opts out with
# LITESTREAM_DISABLED=true.
set -eu

DB="${WINE_DB_PATH:-/data/wine.db}"
export WINE_DB_PATH="$DB"
SERVER="node backend/dist/backend/server.js"

if [ "${LITESTREAM_DISABLED:-}" = "true" ]; then
  echo "Backups are OFF (LITESTREAM_DISABLED=true); staging use only."
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

# Any failure other than "no backup exists yet" stops the start: better a
# machine that won't boot than a server running on an empty database while a
# real backup sits unreachable.
litestream restore -if-db-not-exists -if-replica-exists "$DB"

exec litestream replicate -exec "$SERVER"
