#!/usr/bin/env bash
# Daily logical backup of the cofind2 Postgres DB.
# - Custom format (-Fc): compressed + restorable selectively via pg_restore.
# - Keeps the last KEEP_COUNT dumps (also prunes anything older than KEEP_DAYS).
# - Verifies the dump is non-trivial before pruning, logs every run.
#
# On-server backups protect against DB corruption / accidental DROP, NOT against
# full server loss. For that, copy $BACKUP_DIR off-site (see OFF-SITE note below).
set -euo pipefail

BACKUP_DIR="$HOME/backups/db"
KEEP_COUNT=14            # keep this many most-recent dumps
KEEP_DAYS=30            # hard ceiling: delete anything older than this
CONTAINER="deploy-postgres-1"
DB="cofind"
DBUSER="cofind"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/cofind-$TS.dump"
LOG="$BACKUP_DIR/backup.log"

echo "[$(date -Is)] start -> $OUT" >> "$LOG"
if docker exec "$CONTAINER" pg_dump -U "$DBUSER" -d "$DB" -Fc --no-owner > "$OUT" 2>>"$LOG"; then
  SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
  if [ "$SIZE" -lt 1000 ]; then
    echo "[$(date -Is)] ERROR: dump too small ($SIZE bytes) -- removing" >> "$LOG"
    rm -f "$OUT"; exit 1
  fi
  echo "[$(date -Is)] OK: $OUT ($SIZE bytes)" >> "$LOG"
  # Retention: by count (keep newest KEEP_COUNT) and by age (ceiling).
  ls -1t "$BACKUP_DIR"/cofind-*.dump 2>/dev/null | tail -n +$((KEEP_COUNT+1)) | xargs -r rm -f
  find "$BACKUP_DIR" -name 'cofind-*.dump' -type f -mtime +$KEEP_DAYS -delete
  # --- OFF-SITE (optional): uncomment + configure to copy off the server ---
  # aws s3 cp "$OUT" s3://YOUR-BUCKET/cofind-db/ --only-show-errors
  # rsync -az "$OUT" user@backup-host:/path/cofind-db/
else
  echo "[$(date -Is)] ERROR: pg_dump failed" >> "$LOG"
  rm -f "$OUT"; exit 1
fi
