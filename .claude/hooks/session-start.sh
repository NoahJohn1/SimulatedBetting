#!/usr/bin/env bash
# SessionStart hook — see docs/repo-health.md section 3.6.
#
# A session that cannot run the suite is a bad position from which to trust any change. This
# gets a session as close to runnable as its environment allows, and says plainly what is
# missing when it cannot get all the way.
#
# Four rules, from the design:
#   1. Idempotent      — re-running when everything is up must be a no-op.
#   2. Never fails     — a hook that blocks a session start is worse than no hook. Exits 0 on
#                        every path, including every failure.
#   3. Tests the DAEMON, not the binary — `command -v docker` succeeds in a cloud session
#                        where `docker compose up` cannot work. `docker info` is the check.
#   4. Honest about cost — a cold `npm ci` takes ~20s. Say so rather than appearing to hang.
set -u

cd "$(dirname "$0")/../.." || exit 0

say() { echo "[session-start] $*"; }

# ---------------------------------------------------------------- dependencies
if [ -d node_modules ]; then
  say "node_modules present, skipping install"
else
  say "installing dependencies (npm ci, ~20s on a cold cache)..."
  if npm ci --no-audit --no-fund >/dev/null 2>&1; then
    say "dependencies installed"
  else
    say "npm ci FAILED — run it by hand to see why"
    exit 0
  fi
fi

# ---------------------------------------------------------------- .env.test
# src/test/setup.ts loads .env.test with override:true, so the suite reads DATABASE_URL from
# here and nowhere else. It is gitignored, so every fresh checkout is missing it.
if [ -f .env.test ]; then
  say ".env.test present"
else
  echo 'DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test' > .env.test
  say "wrote .env.test pointing at the simbet_test database"
fi

# ---------------------------------------------------------------- postgres
if ! command -v docker >/dev/null 2>&1; then
  say "no docker binary — the suite needs Postgres; typecheck, lint and build still work"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  say "docker binary found but no daemon is running (this is normal in a cloud session)."
  say "  Postgres is unavailable, so 'npm test' will fail. These still work:"
  say "    npm run typecheck · npm run lint · npm run build"
  say "  On a desktop, start Docker and re-run: .claude/hooks/session-start.sh"
  exit 0
fi

say "docker daemon is up, starting Postgres..."
if ! npm run db:up >/dev/null 2>&1; then
  say "docker compose up FAILED — run 'npm run db:up' by hand to see why"
  exit 0
fi

# Both of these are already idempotent: db:test:create swallows "already exists", and the
# migrator skips files whose hash is recorded.
npm run db:test:create >/dev/null 2>&1
if npm run db:migrate >/dev/null 2>&1 && npm run db:migrate:test >/dev/null 2>&1; then
  say "Postgres up, both databases migrated — 'npm test' should run"
else
  say "migrations FAILED — run 'npm run db:migrate' by hand to see why"
fi

exit 0
