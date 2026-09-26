#!/usr/bin/env bash
# Build the client, ship it and the server to the EC2 host, and restart.
# Usage: deploy/deploy.sh [ssh-host]   (defaults to the "1x1" ssh alias)
set -euo pipefail

HOST="${1:-1x1}"
cd "$(dirname "$0")/.."

npm run build

tar czf - dist server/server.js server/db server/package.json server/package-lock.json \
  | ssh "$HOST" 'mkdir -p ~/jobgrindr ~/jobgrindr-data && rm -rf ~/jobgrindr/dist && tar xzf - -C ~/jobgrindr'

ssh "$HOST" 'cd ~/jobgrindr/server && npm ci --omit=dev --no-audit --no-fund && sudo systemctl restart jobgrindr && sleep 1 && curl -fsS http://127.0.0.1:3001/jobgrindr/api/health'
echo
echo "deployed to $HOST"
