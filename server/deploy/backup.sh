#!/bin/bash
# Daily database backup, keeping 14 copies. Cron (root):  17 3 * * *  /srv/thaigit/server/deploy/backup.sh
# When copying off the VPS (rclone…), ENCRYPT first (e.g. `age -r <public key>`).
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/thaigit-api}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/thaigit-api}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
[ -f "$DATA_DIR/thaigit.db" ] || exit 0
TARGET="$BACKUP_DIR/hang-ngay-$(date +%Y%m%d).db"
sqlite3 "$DATA_DIR/thaigit.db" ".backup '$TARGET'"
chmod 600 "$TARGET"
ls -1t "$BACKUP_DIR"/hang-ngay-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
