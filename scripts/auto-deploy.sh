#!/usr/bin/env bash
#
# AccountSync auto-deploy
# -----------------------
# Polls origin/master, and if there's a new commit, pulls + builds + restarts
# the systemd service. Designed to be run from cron every minute.
#
# Logs to /var/log/accounting-sync-deploy.log
#
# Install:
#   sudo ln -s /opt/accounting-sync/scripts/auto-deploy.sh /usr/local/bin/accounting-auto-deploy
#   sudo chmod +x /opt/accounting-sync/scripts/auto-deploy.sh
#   ( crontab -l 2>/dev/null; echo '* * * * * /usr/local/bin/accounting-auto-deploy' ) | sudo crontab -
#
set -euo pipefail

REPO_DIR="/opt/accounting-sync"
SERVICE="accounting-sync"
LOG="/var/log/accounting-sync-deploy.log"
LOCK="/tmp/accounting-sync-deploy.lock"

# Prevent overlapping runs (build can take 1-2 min; cron fires every minute)
exec 9>"$LOCK"
flock -n 9 || exit 0

log() { echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }

cd "$REPO_DIR"

# Fetch quietly; bail if no changes
git fetch origin master --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "New commit detected: $LOCAL -> $REMOTE"

# Pull
if ! git pull --ff-only origin master >> "$LOG" 2>&1; then
  log "ERROR: git pull failed"
  exit 1
fi

# Install only if package files changed in this pull
if git diff --name-only "$LOCAL" "$REMOTE" | grep -qE '^(package\.json|package-lock\.json)$'; then
  log "package.json changed, running npm install"
  if ! npm install >> "$LOG" 2>&1; then
    log "ERROR: npm install failed"
    exit 1
  fi
fi

# Build
log "Building..."
if ! npm run build >> "$LOG" 2>&1; then
  log "ERROR: npm run build failed"
  exit 1
fi

# Restart service
log "Restarting $SERVICE"
if ! systemctl restart "$SERVICE" >> "$LOG" 2>&1; then
  log "ERROR: systemctl restart failed"
  exit 1
fi

log "Deployed $REMOTE successfully"
