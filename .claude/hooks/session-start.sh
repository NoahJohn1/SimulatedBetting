#!/usr/bin/env bash
# SessionStart hook — see docs/repo-health.md section 3.6.
#
# A session that cannot run the suite is a bad position from which to trust any change. This
# gets a session as close to runnable as its environment allows, and says plainly what is
# missing when it cannot get all the way.
#
# Five rules, from the design:
#   1. Idempotent      — re-running when everything is up must be a no-op.
#   2. Never fails     — a hook that blocks a session start is worse than no hook. Exits 0 on
#                        every path, including every failure.
#   3. Tests the DAEMON, not the binary — `command -v docker` succeeds in a cloud session
#                        where `docker compose up` cannot work. `docker info` is the check.
#   4. Honest about cost — a cold `npm ci` takes ~20s. Say so rather than appearing to hang.
#   5. Docker first, native Postgres second — a cloud session with no Docker daemon may still
#                        have a real `postgresql` server pre-installed (no container runtime
#                        needed to start or use it). This never installs packages itself —
#                        that needs network and is worth a session seeing, not doing silently
#                        on every start — it only starts and configures what is already there.
#                        See repo-health.md 3.7 for the manual install step and why this exists.
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

# ---------------------------------------------------------------- postgres: pick a path
# PG_TARGET is "docker" (port 5433, matches docker-compose.yml), "native" (port 5432, a
# Postgres server running directly in this container), or "" if neither is reachable.
PG_TARGET=""

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  say "docker daemon is up, starting Postgres..."
  if npm run db:up >/dev/null 2>&1; then
    PG_TARGET="docker"
  else
    say "docker compose up FAILED — run 'npm run db:up' by hand to see why"
  fi
elif command -v pg_lsclusters >/dev/null 2>&1; then
  say "no docker daemon — trying the native Postgres in this container instead"
  PG_VERSION="$(pg_lsclusters 2>/dev/null | awk '$1 ~ /^[0-9]/{print $1; exit}')"
  if [ -z "${PG_VERSION:-}" ]; then
    say "postgresql-common is present but no cluster exists — see repo-health.md 3.7"
  else
    pg_ctlcluster "$PG_VERSION" main start >/dev/null 2>&1
    # pg_ctlcluster returns as soon as it has forked the server, not once it is accepting
    # connections — a handful of short retries covers that startup gap without adding much
    # wall-clock time to the common case (already-running) below.
    for _ in 1 2 3 4 5; do
      pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break
      sleep 1
    done
    if PGPASSWORD=simbet psql -h 127.0.0.1 -p 5432 -U simbet -d simbet_test -c 'select 1' >/dev/null 2>&1; then
      PG_TARGET="native"
    else
      # First run on this container: role and databases don't exist yet. Every check below
      # is existence-gated, so re-running this block is a no-op.
      sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='simbet'" 2>/dev/null | grep -q 1 \
        || sudo -u postgres psql -c "CREATE ROLE simbet LOGIN PASSWORD 'simbet'" >/dev/null 2>&1
      sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='simbet'" 2>/dev/null | grep -q 1 \
        || sudo -u postgres createdb -O simbet simbet >/dev/null 2>&1
      sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='simbet_test'" 2>/dev/null | grep -q 1 \
        || sudo -u postgres createdb -O simbet simbet_test >/dev/null 2>&1
      if PGPASSWORD=simbet psql -h 127.0.0.1 -p 5432 -U simbet -d simbet_test -c 'select 1' >/dev/null 2>&1; then
        PG_TARGET="native"
      else
        say "native Postgres role/database setup failed — see repo-health.md 3.7 to finish by hand"
      fi
    fi
  fi
else
  say "no docker daemon and no native Postgres found — typecheck, lint and build still work"
  say "  see repo-health.md 3.7 to install one by hand: sudo apt-get install -y postgresql"
fi

# ---------------------------------------------------------------- .env.test
# src/test/setup.ts loads .env.test with override:true, so the suite reads DATABASE_URL from
# here and nowhere else. It is gitignored, so every fresh checkout is missing it.
if [ -f .env.test ]; then
  say ".env.test present"
elif [ "$PG_TARGET" = "native" ]; then
  echo 'DATABASE_URL=postgres://simbet:simbet@127.0.0.1:5432/simbet_test' > .env.test
  say "wrote .env.test pointing at the native simbet_test database (port 5432)"
else
  echo 'DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test' > .env.test
  say "wrote .env.test pointing at the simbet_test database (port 5433, docker-compose default)"
fi

# ---------------------------------------------------------------- migrations
if [ -z "$PG_TARGET" ]; then
  exit 0
fi

# db:migrate reads DATABASE_URL from .env.local by default, which does not exist in a cloud
# session — so for the native path it is passed explicitly rather than left unset. This also
# sidesteps any DATABASE_URL this container's own environment may already carry (e.g. a hosted
# database's credentials): explicit beats ambient, same reasoning as migrate.ts's own
# override:true fix for the files it does load.
if [ "$PG_TARGET" = "native" ]; then
  if DATABASE_URL="postgres://simbet:simbet@127.0.0.1:5432/simbet" npx tsx src/db/migrate.ts >/dev/null 2>&1 \
    && npm run db:migrate:test >/dev/null 2>&1; then
    say "Postgres up (native, no Docker), both databases migrated — 'npm test' should run"
  else
    say "migrations FAILED — see repo-health.md 3.7 to run them by hand"
  fi
else
  # Both of these are already idempotent: db:test:create swallows "already exists", and the
  # migrator skips files whose hash is recorded.
  npm run db:test:create >/dev/null 2>&1
  if npm run db:migrate >/dev/null 2>&1 && npm run db:migrate:test >/dev/null 2>&1; then
    say "Postgres up, both databases migrated — 'npm test' should run"
  else
    say "migrations FAILED — run 'npm run db:migrate' by hand to see why"
  fi
fi

exit 0
