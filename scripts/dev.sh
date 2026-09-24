#!/usr/bin/env bash
# Developer one-shot: docker infra + backend api + worker + frontend (bash/zsh)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/5] docker compose up -d"
docker compose -f "$ROOT/docker-compose.yml" up -d

echo "[2/5] backend deps + build"
cd "$ROOT/backend"
[ -d node_modules ] || npm install
npm run build

echo "[3/5] frontend deps"
cd "$ROOT/frontend"
[ -d node_modules ] || npm install

echo "[4/5] starting API + worker in background"
cd "$ROOT/backend"
nohup npx tsx src/index.ts  >/tmp/reachinbox-api.log  2>&1 &
nohup npx tsx src/worker.ts >/tmp/reachinbox-worker.log 2>&1 &

echo "[5/5] starting frontend"
cd "$ROOT/frontend"
nohup npx vite --port 5173 >/tmp/reachinbox-web.log 2>&1 &

cat <<'EOF'
All services starting...
  Frontend   : http://localhost:5173
  API        : http://localhost:4000
  Bull Board : http://localhost:4000/admin/queues
  Logs       : /tmp/reachinbox-*.log
EOF