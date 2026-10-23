#!/usr/bin/env bash
# Build and upload the site to the VPS. Needs the SSH host "duoforge-vps" (or DEPLOY_HOST).
set -euo pipefail
HOST="${DEPLOY_HOST:-duoforge-vps}"
# Empty DEPLOY_DIR is allowed: with an rrsync-limited key the remote root already is the web folder.
DIR="${DEPLOY_DIR-/var/www/teamforge}"

cd "$(dirname "$0")/.."
npm run build
# Assets first, then the page: nobody gets an index.html that points at files not uploaded yet.
rsync -az --chmod=D755,F644 --exclude index.html dist/ "$HOST:$DIR/"
rsync -az --chmod=F644 dist/index.html "$HOST:$DIR/index.html"
# Drop files from older builds.
rsync -az --delete --chmod=D755,F644 dist/ "$HOST:$DIR/"
echo "Deployed to $HOST:$DIR"
