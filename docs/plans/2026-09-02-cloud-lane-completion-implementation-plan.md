# Cloud Lane Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every `[CLOUD]` item in [`docs/repo-health.md`](../repo-health.md) so its Outstanding table holds nothing a cloud session can finish unblocked, and every remaining row names its lane and its blocker.

**Architecture:** Nine sequential tasks on one branch, ordered by blast radius. Tasks 1–6 are small and independent; Task 7 is the Prettier reformat, isolated as its own commit so it can be dropped whole without unpicking anything else; Task 8 reconciles the documentation once there is a complete set of facts to record, and Task 9 pushes and hands off. No application behaviour changes anywhere — the only `src/` addition is one test that reads files.

**Tech Stack:** GitHub Actions YAML, Vitest, Bash hooks with Node for JSON parsing, Prettier 3, Markdown.

## Global Constraints

Copied from [the design](../specs/2026-09-02-cloud-lane-completion-design.md):

- **The cron `schedule:` block stays commented.** Only the guards land. Uncommenting before Noah's secrets exist recreates the failure the document was written about. The design is explicit: *"Do not skip step 4 by uncommenting the schedule first."*
- **`format:check` does not go into `verify` or CI** in this batch. Noah's ESPN adapter is unpushed; a formatting gate would convert his merge conflict into a red build.
- **Every hook exits 0 on every path**, including every failure. A `SessionStart` hook that blocks a session start is worse than no hook, and a hook people find obstructive gets disabled.
- **Hook `matcher` fields match tool names, not paths.** `Edit`, `Write` — never `src/server/money/**`, which silently matches nothing. Path filtering happens inside the script.
- **Four owner tags:** `[CLOUD]` = a web session finishes it, no database and no secrets. `[LOCAL]` = needs Docker/Postgres on a desktop. `[MANUAL]` = human hands, either person. `[NOAH]` = an account only Noah holds.
- **Nothing under `src/app/` changes, and nothing in `src/server/` changes except one new test file.** Task 7 reformats source but alters no behaviour.
- **Every document must be listed in `docs/README.md`.** A spec, plan, or audit that exists but is not listed is invisible.
- **Statuses that cannot be verified from the repository say so and are dated.**

## Environment facts

Measured 2026-09-02 in the session that wrote this plan. Do not re-derive these; do re-run anything you are about to depend on.

| Fact | Value |
|---|---|
| Node / npm | v22.22.2 / 10.9.7 |
| `node_modules` at session start | Absent — run `npm ci` first (~21s) |
| Docker | Binary at `/usr/bin/docker`; `docker info` **fails**; no `/var/run/docker.sock` |
| `npm test` (whole suite) | **Cannot run here** — needs Postgres. CI proves it on the PR. |
| `npm run typecheck`, `npm run lint`, `npx next build` | All run clean |
| `next build` output | 32 routes — 28 ƒ dynamic, 4 prerendered |
| `jq` | Present here, but **not assumed** — hooks use `node` for JSON |

## The link checker

Task 8 ends by running this. Save it once to `/tmp/linkcheck.py`.

**It checks the five live documents only — not `docs/specs/` or `docs/plans/`.** That is a
deliberate narrowing from the version in the docs-status plan, which checked plans too and
produced dozens of false positives: a plan that *quotes* markdown destined for another document
carries that document's relative links, and the checker resolves them against the plan's own
directory. This plan quotes repo-health tables extensively, so the wider check is pure noise
here. Verified 2026-09-02: the five live documents pass clean.

```python
import re, os
def slug(t):
    t=re.sub(r'[`*_\[\]()]','',t.strip().lower())
    return re.sub(r'[^\w\s-]','',t,flags=re.UNICODE).replace(' ','-')
def anchors(p):
    return {slug(m.group(2)) for m in (re.match(r'^(#{1,6})\s+(.*)$',l) for l in open(p)) if m}
bad=[]
targets=[('docs/repo-health.md','docs'),('docs/README.md','docs'),('README.md','.'),
         ('docs/roadmap.md','docs'),('docs/decisions.md','docs')]
for f,base in targets:
    if not os.path.exists(f): continue
    for m in re.finditer(r'\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)', open(f).read()):
        link=m.group(1).strip('<>')
        if link.startswith('http'): continue
        tgt,_,anc=link.partition('#')
        p=os.path.normpath(os.path.join(base,tgt)) if tgt else f
        if tgt and not os.path.exists(p.split(':')[0]): bad.append(f'{f}: missing {link}'); continue
        if anc and p.endswith('.md') and anc not in anchors(p): bad.append(f'{f}: bad anchor {link}')
print('\n'.join(bad) if bad else 'LINKS OK')
```

**Expected: `LINKS OK`.** Task 8 adds and renames headings in `repo-health.md`, so any failure
will be an anchor pointing at a heading you just changed. Fix the link, not the heading — unless
the heading itself is what is wrong.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `.github/workflows/cron.yml` | Guards that name the missing secret | 1 |
| `src/server/money/__tests__/ledger-funnel.test.ts` | Layer 1 — the funnel property, enforced | 2 |
| `.nvmrc` | The half of Node pinning that switches a version manager | 3 |
| `.github/workflows/ci.yml` | Build step, concurrency, timeout | 3 |
| `.github/dependabot.yml` | Monthly grouped updates | 3 |
| `.claude/hooks/session-start.sh` | Get a session runnable, or say what is missing | 4 |
| `.claude/settings.json` | Hook registration — **created in Task 4, extended in Task 5** | 4, 5 |
| `.claude/hooks/money-touch.sh` | Layer 2 — flag a money-path edit | 5 |
| `README.md` | `.env.test`, the undocumented prerequisite | 6 |
| `.prettierrc`, `.prettierignore`, `package.json`, `eslint.config.mjs` | Formatter | 7 |
| `docs/*` | The record | 8 |

---

## Task 1: Cron empty-secret guards

Today a manual dispatch with missing secrets fails with `curl` exit 3 and no explanation — that is what 130 scheduled runs did. After this it fails with a line naming the secret, which is what makes Noah's step 4 diagnostic.

**Files:**
- Modify: `.github/workflows/cron.yml` — the `run:` block of both jobs

**Interfaces:**
- Produces: nothing later tasks consume. Fully independent.

- [ ] **Step 1: Add the guard to the `sync-odds` job**

Replace the `run:` block of the `sync-odds` step with:

```yaml
        run: |
          [ -n "$APP_URL" ] || { echo "APP_URL secret is not set — see docs/repo-health.md section 1.5"; exit 1; }
          [ -n "$CRON_SECRET" ] || { echo "CRON_SECRET secret is not set — see docs/repo-health.md section 1.5"; exit 1; }
          curl -sf -X GET "$APP_URL/api/cron/sync-odds" \
            -H "Authorization: Bearer $CRON_SECRET"
```

- [ ] **Step 2: Add the guard to the `settle` job**

Replace the `run:` block of the `settle` step with:

```yaml
        run: |
          [ -n "$APP_URL" ] || { echo "APP_URL secret is not set — see docs/repo-health.md section 1.5"; exit 1; }
          [ -n "$CRON_SECRET" ] || { echo "CRON_SECRET secret is not set — see docs/repo-health.md section 1.5"; exit 1; }
          curl -sf -X GET "$APP_URL/api/cron/settle" \
            -H "Authorization: Bearer $CRON_SECRET"
```

- [ ] **Step 3: Confirm the `schedule:` block is still commented**

Run:

```bash
grep -n "schedule" .github/workflows/cron.yml
```

Expected — all three cron lines still commented, `workflow_dispatch` still live:

```
11:  # schedule:
12:  #   - cron: '*/15 * * * *'
13:  #   - cron: '*/10 * * * *'
```

**If any `schedule:` line is uncommented, re-comment it.** This is a global constraint, not a preference.

- [ ] **Step 4: Verify the file still parses as YAML**

```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/cron.yml')); print('PARSES OK'); print('jobs:', list(d['jobs'])); print('on:', d[True] if True in d else d.get('on'))"
```

Expected: `PARSES OK` and `jobs: ['sync-odds', 'settle']`.

(YAML parses the bare key `on` as the boolean `True`, which is why the print handles both.)

- [ ] **Step 5: Verify the guard logic itself**

The workflow cannot run here, so test the shell directly:

```bash
bash -c 'APP_URL=""; CRON_SECRET="x"; [ -n "$APP_URL" ] || { echo "APP_URL secret is not set"; exit 1; }; echo UNREACHABLE'; echo "exit=$?"
```

Expected:

```
APP_URL secret is not set
exit=1
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/cron.yml
git commit -m "ci: name the missing secret instead of failing with curl exit 3

Both cron jobs check APP_URL and CRON_SECRET before calling curl. With
the secrets absent curl was handed a bare path and exited 3 before any
request left the runner, which is what every scheduled run did between
2026-08-22 and 2026-08-24.

The schedule stays commented. This makes the manual dispatch in step 4
of the cron fix diagnostic; it does not perform the fix.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The ledger-funnel guard test

Layer 1 of the three-layer money defence. The property holds today, so this locks in a property rather than fixing anything.

**Files:**
- Create: `src/server/money/__tests__/ledger-funnel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the test file path, which Task 8 cites in repo-health §3.3.

**This test needs no database.** It reads files. `src/test/setup.ts` only loads `.env.test` and opens no connection. Verified: it runs standalone in a cloud session with no Postgres anywhere.

- [ ] **Step 1: Write the test**

Create `src/server/money/__tests__/ledger-funnel.test.ts`:

```typescript
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A source-scanning guard, not a behavioural test. It asserts the structural property the
 * money design rests on: every ledger write funnels through `postEntry`.
 *
 * D5 makes the ledger append-only and the balance a cache reconciled against it. That holds
 * only while `postEntry` is the single writer — it is what stamps the idempotency key and
 * updates `balance_cents` in the same transaction. A direct `.insert(ledgerEntries)` from
 * anywhere else silently opts out of both, and no behavioural test would notice, because the
 * entry it wrote looks fine on its own.
 *
 * The property held on 2026-08-25 and again on 2026-09-02 because nobody happened to write a
 * direct insert, not because anything stopped them. This is the thing that stops them.
 *
 * Reads files only — no database. See docs/repo-health.md section 3.3.
 */

const SRC = 'src';

/** The one file allowed to insert directly. It is the funnel. */
const LEDGER = join('src', 'server', 'money', 'ledger.ts');

/**
 * Test directories may insert directly: `src/db/__tests__/ledger-schema.test.ts` and
 * `currency-schema.test.ts` exist to test the database constraints themselves, and routing
 * them through `postEntry` would test the funnel instead of the constraint.
 */
function isTestFile(path: string): boolean {
  return path.split(sep).includes('__tests__');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Matches `.insert(ledgerEntries)` across a line break, which is how Drizzle chains read. */
const INSERT = /\.insert\(\s*ledgerEntries\s*\)/;
const UPDATE = /\.update\(\s*ledgerEntries\s*\)/;
const DELETE = /\.delete\(\s*ledgerEntries\s*\)/;

function filesMatching(pattern: RegExp, includeTests: boolean): string[] {
  return sourceFiles(SRC)
    .filter((f) => includeTests || !isTestFile(f))
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => relative('.', f));
}

describe('the ledger funnel', () => {
  it('has exactly one production file that inserts ledger entries: the funnel itself', () => {
    expect(filesMatching(INSERT, false)).toEqual([LEDGER]);
  });

  it('never updates a ledger entry, anywhere, including tests', () => {
    expect(filesMatching(UPDATE, true)).toEqual([]);
  });

  it('never deletes a ledger entry, anywhere, including tests', () => {
    expect(filesMatching(DELETE, true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it passes with no database**

```bash
npx vitest run src/server/money/__tests__/ledger-funnel.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  3 passed (3)`, in well under a second. (A Vite `configLoader` warning and a `vite-tsconfig-paths` notice print first; both are pre-existing and unrelated.)

- [ ] **Step 3: Prove it can fail**

A guard test that cannot fail is decoration. Introduce a violation:

```bash
cp src/server/money/reconcile.ts /tmp/reconcile.bak
cat >> src/server/money/reconcile.ts <<'EOF'

// TEMPORARY violation to prove the guard test fails. Reverted immediately.
async function __violation(tx: Tx) {
  await tx.insert(ledgerEntries).values({});
}
EOF
npx vitest run src/server/money/__tests__/ledger-funnel.test.ts
```

Expected — a failure that **names the offending file**:

```
AssertionError: expected [ 'src/server/money/ledger.ts', …(1) ] to deeply equal [ 'src/server/money/ledger.ts' ]
+   "src/server/money/reconcile.ts",
 Tests  1 failed | 2 passed (3)
```

- [ ] **Step 4: Revert the violation and confirm green again**

```bash
cp /tmp/reconcile.bak src/server/money/reconcile.ts
git diff --stat src/server/money/reconcile.ts
npx vitest run src/server/money/__tests__/ledger-funnel.test.ts
```

Expected: `git diff --stat` prints **nothing** (clean revert), and the test is back to `3 passed`.

**Do not commit until `git diff --stat src/server/money/reconcile.ts` is empty.**

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/money/__tests__/ledger-funnel.test.ts
git commit -m "test: enforce the ledger funnel instead of re-verifying it by hand

Every ledger write goes through postEntry, which is what stamps the
idempotency key and updates balance_cents in the same transaction. That
property was checked by hand on 2026-08-25 and again on 2026-09-02; it
held both times because nobody happened to write a direct insert.

Scans source, so it needs no database and runs in a cloud session.
Proven able to fail: a direct insert added to reconcile.ts turns it red
and the failure names the file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The CI chore — `.nvmrc`, build, concurrency, timeout, Dependabot

Repo-health groups these as one commit and it is right to: individually trivial, collectively the difference between a gate and a suggestion.

**Files:**
- Create: `.nvmrc`
- Create: `.github/dependabot.yml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a CI `build` step whose behaviour Task 8 describes in repo-health §1.1.

- [ ] **Step 1: Pin Node for version managers**

```bash
echo "22" > .nvmrc
cat .nvmrc
```

Expected: `22`.

This is the half that actually switches a version manager. `engines.node: ">=22"` in `package.json` already covers the other half and stays as it is.

- [ ] **Step 2: Add concurrency and a timeout to CI**

In `.github/workflows/ci.yml`, insert a `concurrency` block between the `on:` block and `jobs:`:

```yaml
# Work lands in bursts of pushes; without this, superseded runs finish for nothing.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

Then add `timeout-minutes: 15` to the `verify` job, immediately after `runs-on: ubuntu-latest`:

```yaml
  verify:
    runs-on: ubuntu-latest
    # The default is six hours. A Postgres service container that never reports healthy
    # otherwise hangs that long.
    timeout-minutes: 15
```

- [ ] **Step 3: Add the build step**

Append to the end of the `steps:` list in `.github/workflows/ci.yml`, after `- run: npm run verify`:

```yaml
      # Deliberately here rather than in the `verify` script: verify is what a developer runs
      # in a loop, and a 10-second build on every local run is a tax for no local benefit.
      # DATABASE_URL is already exported above; src/db/client.ts throws at import without it,
      # but nothing connects during a build.
      - run: npm run build
```

- [ ] **Step 4: Add Dependabot**

Create `.github/dependabot.yml`:

```yaml
# Monthly and grouped on purpose. Weekly, ungrouped, on a two-person project is noise you
# train yourself to ignore, which is worse than not having it. This is roughly one PR a
# month that CI can prove safe. Merging them is a [MANUAL] job — see docs/repo-health.md.
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: monthly
    open-pull-requests-limit: 3
    groups:
      minor-and-patch:
        update-types:
          - minor
          - patch

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    groups:
      actions:
        patterns:
          - '*'
```

- [ ] **Step 5: Verify all three YAML files parse**

```bash
python3 -c "
import yaml
for f in ['.github/workflows/ci.yml','.github/workflows/cron.yml','.github/dependabot.yml']:
    d = yaml.safe_load(open(f))
    print(f, '-> PARSES OK')
ci = yaml.safe_load(open('.github/workflows/ci.yml'))
print('concurrency:', ci['concurrency'])
print('timeout:', ci['jobs']['verify']['timeout-minutes'])
print('last step:', ci['jobs']['verify']['steps'][-1])
"
```

Expected: three `PARSES OK` lines, `cancel-in-progress: True`, `timeout: 15`, and a last step of `{'run': 'npm run build'}`.

- [ ] **Step 6: Prove the build step actually works before CI depends on it**

```bash
DATABASE_URL=postgres://x npm run build
```

Expected: exit 0, `Compiled successfully`, **32 routes** (28 `ƒ`, 4 prerendered). `postgres://x` is unreachable on purpose — it proves the build needs the variable set but never connects.

- [ ] **Step 7: Commit**

```bash
git add .nvmrc .github/dependabot.yml .github/workflows/ci.yml
git commit -m "ci: build in the gate, cancel superseded runs, cap the timeout, add Dependabot

.nvmrc pins 22 for version managers, which engines.node could not do —
a laptop on Node 20 got no warning until something behaved oddly.

The build stays in the workflow rather than in the verify script: verify
is what a developer runs in a loop and a 10s build is a local tax for no
local benefit. It catches bundler-level module resolution that tsc does
not, and now that / prerenders it also executes page code for one route.

Dependabot is monthly and grouped because weekly and ungrouped on a
two-person project is noise you learn to ignore.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The `session-start` hook

Repo-health tags this `[LOCAL]`. That tag is right about one branch and wrong about the other four — and a cloud session is the *better* place to prove those four, because it is the degraded environment.

**Files:**
- Create: `.claude/hooks/session-start.sh`
- Create: `.claude/settings.json` — **this file does not exist yet**

**Interfaces:**
- Produces: `.claude/settings.json` with a `hooks` object. Task 5 adds a second key to it and must not overwrite this one.

- [ ] **Step 1: Write the hook script**

Create `.claude/hooks/session-start.sh`:

```bash
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
```

- [ ] **Step 2: Make it executable and run it**

```bash
chmod +x .claude/hooks/session-start.sh
.claude/hooks/session-start.sh; echo "exit=$?"
```

Expected in a cloud session — note it distinguishes the binary from the daemon, and **exits 0**:

```
[session-start] node_modules present, skipping install
[session-start] wrote .env.test pointing at the simbet_test database
[session-start] docker binary found but no daemon is running (this is normal in a cloud session).
[session-start]   Postgres is unavailable, so 'npm test' will fail. These still work:
[session-start]     npm run typecheck · npm run lint · npm run build
[session-start]   On a desktop, start Docker and re-run: .claude/hooks/session-start.sh
exit=0
```

- [ ] **Step 3: Prove it is idempotent**

```bash
.claude/hooks/session-start.sh; echo "exit=$?"
```

Expected: identical except the `.env.test` line, which now reads `[session-start] .env.test present`. Exit 0 again.

- [ ] **Step 4: Confirm `.env.test` stays out of git**

```bash
git check-ignore -v .env.test
git status --short | grep -c "\.env\.test" || echo "not staged — correct"
```

Expected: `.gitignore:34:.env*	.env.test`, and `.env.test` absent from `git status`.

- [ ] **Step 5: Register the hook**

Create `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Verify the JSON parses**

```bash
python3 -c "import json; d=json.load(open('.claude/settings.json')); print('PARSES OK'); print(list(d['hooks']))"
```

Expected: `PARSES OK` and `['SessionStart']`.

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/session-start.sh .claude/settings.json
git commit -m "chore: SessionStart hook, with the cloud branches proven

A web session starts with no node_modules and no Postgres, which is a
bad position from which to trust any change. The hook installs
dependencies, writes the gitignored .env.test the suite reads
DATABASE_URL from, and brings Postgres up where a daemon exists.

Proven in a cloud session: idempotent, exits 0 with the daemon down, and
distinguishes a docker binary on PATH from a working daemon — the
distinction the original writeup got wrong. The docker compose path
still needs a desktop to verify and is tracked as [LOCAL].

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: The `money-touch` hook — layer 2

[Repo-health §3.3](../repo-health.md#33-money-invariants--all-three-layers) designs three layers. Layers 1 and 3 exist after Task 2. Layer 2 was never built and, unlike the deliberately-skipped items, was never decided against.

**Files:**
- Create: `.claude/hooks/money-touch.sh`
- Modify: `.claude/settings.json` — **add a key, do not replace the file**

**Interfaces:**
- Consumes: `.claude/settings.json` created by Task 4. The `SessionStart` key must survive.

- [ ] **Step 1: Write the hook script**

Create `.claude/hooks/money-touch.sh`:

```bash
#!/usr/bin/env bash
# PostToolUse hook — layer 2 of the three-layer money defence in docs/repo-health.md 3.3.
#
# Prints one line when an edit lands on a money path. Deliberately a flag and not a review:
# a hook that spawns an agent review on every save is slow enough that someone disables it,
# and a disabled hook enforces nothing.
#
# The harness matches hooks on TOOL NAMES, not paths, so this fires on every Edit and Write
# and does its own path filtering. Never blocks, never fails a tool call: always exits 0.
set -u

payload=$(cat)

# node rather than jq: jq is not installed everywhere this repo is developed, and Node 22+
# is already a hard requirement (package.json engines).
path=$(printf '%s' "$payload" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => {
    try {
      const i = JSON.parse(s).tool_input ?? {};
      process.stdout.write(i.file_path ?? i.notebook_path ?? "");
    } catch {
      process.stdout.write("");
    }
  });
' 2>/dev/null) || exit 0

[ -n "$path" ] || exit 0

# Paths where the four money invariants apply. Kept in sync with the money-invariants skill.
case "$path" in
  *src/server/money/*|\
  *src/server/bets/*|\
  *src/server/p2p/*|\
  *src/server/events/resolve.ts|\
  *src/db/schema/money.ts)
    echo "money path touched (${path##*/}) — run /money-invariants before committing"
    ;;
esac

exit 0
```

- [ ] **Step 2: Make it executable and test all five cases**

```bash
chmod +x .claude/hooks/money-touch.sh
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/server/money/ledger.ts"}}' | .claude/hooks/money-touch.sh; echo "exit=$?"
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/app/games/page.tsx"}}' | .claude/hooks/money-touch.sh; echo "exit=$?"
echo '{"tool_name":"Write","tool_input":{"file_path":"src/server/events/resolve.ts"}}' | .claude/hooks/money-touch.sh; echo "exit=$?"
echo 'not json' | .claude/hooks/money-touch.sh; echo "exit=$?"
printf '' | .claude/hooks/money-touch.sh; echo "exit=$?"
```

Expected — fires on 1 and 3, silent on 2, 4, 5, **exit 0 every time**:

```
money path touched (ledger.ts) — run /money-invariants before committing
exit=0
exit=0
money path touched (resolve.ts) — run /money-invariants before committing
exit=0
exit=0
exit=0
```

The garbage-input and empty-input cases matter: a hook that errors on unexpected stdin would fail a tool call for a reason nobody could diagnose.

- [ ] **Step 3: Add the registration without dropping `SessionStart`**

`.claude/settings.json` becomes:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/money-touch.sh"
          }
        ]
      }
    ]
  }
}
```

The matcher is `Edit|Write` — **tool names**. A matcher of `src/server/money/**` would silently match nothing.

- [ ] **Step 4: Verify both hooks are registered**

```bash
python3 -c "
import json
d = json.load(open('.claude/settings.json'))
print('keys:', sorted(d['hooks']))
print('matcher:', d['hooks']['PostToolUse'][0]['matcher'])
assert 'SessionStart' in d['hooks'], 'Task 4 registration was dropped'
print('OK')
"
```

Expected: `keys: ['PostToolUse', 'SessionStart']`, `matcher: Edit|Write`, `OK`.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/money-touch.sh .claude/settings.json
git commit -m "chore: flag money-path edits — layer 2 of the three-layer defence

repo-health 3.3 designs a test, a hook, and a skill. The test landed
earlier in this branch and the skill has existed since #7; the hook was
never built and, unlike the deliberately-skipped items, was never
decided against.

One line pointing at /money-invariants, not an agent review: the design
is explicit that a hook slow enough to interrupt an edit gets disabled.
Matches on tool names because a path matcher silently matches nothing,
and parses stdin with node because jq is not everywhere. Exits 0 on
every path including malformed input.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Document `.env.test`

The suite reads `DATABASE_URL` from `.env.test` and nowhere else, the file is gitignored, and **nothing in the repository tells anyone to create it**. A fresh checkout that follows the README exactly cannot run the tests.

**Files:**
- Modify: `README.md` — the `### Testing` section
- Modify: `.env.example` — one comment line

**Interfaces:**
- Consumes: the `.env.test` contents written by the Task 4 hook. The two must agree.

- [ ] **Step 1: Add the `.env.test` paragraph to the README**

In `README.md`, immediately before the `### Testing` heading's code block, insert:

````markdown
### Testing

The suite reads its connection string from `.env.test`, which is gitignored and therefore
missing from a fresh checkout. `src/test/setup.ts` loads it with `override: true`, so it wins
over `.env.local` and the tests cannot accidentally run against your development database.
Create it once:

```bash
echo 'DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test' > .env.test
```

The `SessionStart` hook in `.claude/hooks/session-start.sh` writes this file for you if it is
missing, so a Claude Code session handles it automatically.

````

- [ ] **Step 2: Mark the dead variable in `.env.example`**

`TEST_DATABASE_URL` is listed in `.env.example` and set by CI, but **no code reads it** — verified 2026-09-02 by grepping the whole repository. Change its line in `.env.example` to:

```
# Unused by application code — the suite reads DATABASE_URL from .env.test instead. Kept
# because CI sets it and removing it is a separate change.
TEST_DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test
```

- [ ] **Step 3: Verify the claim before publishing it**

```bash
grep -rn "TEST_DATABASE_URL" --include="*.ts" --include="*.mjs" --include="*.json" . | grep -v node_modules
```

Expected: matches only in `.env.example` and `.github/workflows/ci.yml` — **no `.ts` file**. If a `.ts` match appears, the comment is wrong; fix the comment rather than the code.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs: .env.test is required and was documented nowhere

src/test/setup.ts loads .env.test with override:true, so the suite reads
DATABASE_URL from it and nowhere else. It is gitignored, so a fresh
checkout following the README exactly cannot run the tests.

Also marks TEST_DATABASE_URL as unread by any code — it is set in
.env.example and CI, and grepping the repository finds no consumer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Prettier

**This task produces two commits: configuration, then the reformat.** Keep them separate. The reformat commit must contain nothing but formatting, so that dropping it is one operation.

**Files:**
- Create: `.prettierrc`, `.prettierignore`
- Modify: `package.json` (devDependencies + two scripts), `eslint.config.mjs`
- Modify: ~86 source files (the reformat commit, generated by a command)

**Interfaces:**
- Produces: `npm run format` and `npm run format:check`. Task 8 records that `format:check` is deliberately **not** wired into `verify` or CI.

- [ ] **Step 1: Install Prettier and the ESLint bridge**

```bash
npm install --save-dev --save-exact prettier@3 eslint-config-prettier
```

- [ ] **Step 2: Write the config, matched to the existing code**

Create `.prettierrc`:

```json
{
  "singleQuote": true,
  "printWidth": 100,
  "semi": true,
  "trailingComma": "all"
}
```

**These values are measured, not preferences.** The codebase is already single-quote, semicolon-terminated, 2-space, trailing-comma, and runs to roughly 85–97 columns. Against 231 TypeScript files this config reformats **86**; Prettier's defaults (double quotes, 80 columns) reformat **230**. The point of a formatter is to stop diff noise, and defaults here would generate one enormous burst of it — paid for by Noah, in rebase conflicts against his unpushed adapter work.

Create `.prettierignore`:

```
.next/
out/
build/
node_modules/
drizzle/
package-lock.json
next-env.d.ts
.claude/
.superpowers/
```

`drizzle/` holds generated SQL and its journal; `.claude/` is already outside this project's lint scope per `eslint.config.mjs`.

- [ ] **Step 3: Add the scripts**

In `package.json`, add to `scripts`, after `"lint"`:

```json
    "format": "prettier --write .",
    "format:check": "prettier --check .",
```

**Do not add `format:check` to `verify`.** A formatting gate while Noah's adapter branch is unpushed converts his merge conflict into a red build. That is a follow-up, recorded in Task 8.

- [ ] **Step 4: Turn off the ESLint rules that fight Prettier**

In `eslint.config.mjs`, import the config and append it **last** in the array — order matters, it only disables:

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not part of this project's source:
    ".claude/**",
    ".superpowers/**",
  ]),
  // Last on purpose: this only turns rules off, and it must win over everything above.
  prettier,
]);

export default eslintConfig;
```

- [ ] **Step 5: Verify the toolchain before reformatting anything**

```bash
npm run typecheck && npm run lint && npx prettier --check . 2>&1 | tail -3
```

Expected: typecheck and lint clean; `prettier --check` reports roughly **86 files** with style issues. That number is the confirmation the config is the matched one — if it reports ~230, `.prettierrc` is not being read.

- [ ] **Step 6: Commit the configuration alone**

```bash
git add .prettierrc .prettierignore package.json package-lock.json eslint.config.mjs
git commit -m "chore: adopt Prettier, configured to match the existing code

Two developers and no formatter is a diff-noise generator. The stated
reason for deferring this was a conflict with the long-lived 7b branch,
which merged.

The config is measured, not preferred: single quotes at 100 columns
reformats 86 of 231 files, where Prettier's defaults reformat 230. The
reformat itself is the next commit, kept separate so it can be dropped
whole.

format:check is deliberately not in verify or CI while the ESPN adapter
work is unpushed — a formatting gate would turn a merge conflict into a
red build.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Run the reformat**

```bash
npm run format
```

- [ ] **Step 8: Verify the reformat changed formatting and nothing else**

```bash
npm run format:check
npm run typecheck && npm run lint
npx vitest run src/server/money/__tests__/ledger-funnel.test.ts
git diff --stat | tail -1
```

Expected: `format:check` clean (`All matched files use Prettier code style!`), typecheck and lint clean, the guard test still `3 passed`, and roughly 86 files changed.

**The full suite cannot run here** — it needs Postgres. CI proves it on the pull request. That is the documented split, and it is the single most important thing CI checks on this branch.

- [ ] **Step 9: Commit the reformat, alone**

```bash
git add -A
git commit -m "style: apply Prettier

Formatting only — no behaviour change, no logic touched. Isolated as a
single commit so it can be dropped with one operation if the ESPN
adapter work needs to land first.

[NOAH] commit or stash local adapter work before this merges: a
repo-wide reformat conflicts in every file it touches.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Confirm the reformat commit is formatting-only**

```bash
git show --stat HEAD | head -5
git log --oneline -2
```

The two commits must be distinct, with the reformat second. If anything non-formatting slipped into it, split it now — its whole value is that it can be dropped cleanly.

---

## Task 8: Reconcile the documentation

Run last, alone, when the facts are complete. Repo-health records what happens otherwise: *"An earlier revision left those counts to update themselves when it merges; they did not, and three different test totals had accumulated in three places by the time anyone looked."*

**Files:**
- Modify: `docs/repo-health.md` — Done table, Outstanding table, §1.1, §1.4, §2, §3.3, §3.6, the closing Prettier paragraph
- Modify: `docs/README.md` — the three "What is left" tables, plus rows for the new spec and plan
- Modify: `docs/roadmap.md` — the repo-health cross-references
- Modify: `docs/decisions.md` — two new entries

- [ ] **Step 1: Save the link checker**

Write the Python block from "The link checker" above to `/tmp/linkcheck.py`.

- [ ] **Step 2: Rewrite the Outstanding table in `docs/repo-health.md`**

Every row that landed moves to **Done** with `This branch` as its reference. The Outstanding table becomes — and this is the deliverable, so match it exactly:

```markdown
### Outstanding

Nothing here is `[CLOUD]` work that is not blocked on somebody else. Every row names its lane
and what it is waiting on.

| # | Item | Owner | Blocked on |
|---|---|---|---|
| 1 | **Add `APP_URL` and `CRON_SECRET` as Actions secrets** | **[NOAH]** | Nothing — this is the only thing stopping the deployed app from settling bets. [Step by step](#what-you-must-do--the-cron-fix-step-by-step) |
| 2 | **Dispatch both cron jobs by hand and confirm 200** | **[NOAH]** | Row 1. The jobs now name the missing secret instead of exiting 3, so a red run says which side is wrong |
| 3 | Uncomment the three `schedule:` lines in `cron.yml` | [CLOUD] | Rows 1 and 2. One line of work; the guard it needs already landed |
| 4 | Verify the `session-start` hook's Docker path | **[LOCAL]** | A desktop. The other four branches are proven — see [3.6](#36-session-start--a-hook) |
| 5 | Tell Noah before the Prettier reformat merges | **[NOAH]** | Nothing. His unpushed adapter work conflicts in every file the reformat touches |
| 6 | Add `format:check` to `verify` and CI | [CLOUD] | Row 5, and the adapter landing. A formatting gate now turns a merge conflict into a red build |
| 7 | Merge Dependabot's monthly PR | **[MANUAL]** | Its first fire |
| 8 | `db-migration` skill ([3.5](#35-db-migration--a-skill)) | [CLOUD] | Deliberately deferred. The trigger is a migration going wrong; it has not fired |
| 9 | The human test pass, and the issues it produces ([4](#4-issues-and-milestones)) | **[MANUAL]** | Nothing. The gate on phase 5, and nothing here substitutes for it |
```

- [ ] **Step 3: Move the landed rows into the Done table**

Append to the Done table in `docs/repo-health.md`:

```markdown
| 8 | Cron empty-secret guards on both jobs ([1.5](#15-the-cron-workflow--the-only-thing-actually-broken)) | [CLOUD] | This branch |
| 9 | Ledger-funnel guard test ([3.3](#33-money-invariants--all-three-layers)) | [CLOUD] | This branch — proven able to fail |
| 10 | `.nvmrc`, CI `build` / `concurrency` / `timeout-minutes`, Dependabot ([1.1](#11-it-never-builds--worth-adding-but-narrower-than-it-looks), [1.4](#14-cheap-improvements)) | [CLOUD] | This branch |
| 11 | `session-start` hook — written, cloud branches proven ([3.6](#36-session-start--a-hook)) | [CLOUD] | This branch; Docker path outstanding |
| 12 | `money-touch` PostToolUse hook — layer 2 ([3.3](#33-money-invariants--all-three-layers)) | [CLOUD] | This branch |
| 13 | `.env.test` documented in the README ([3.6](#36-session-start--a-hook)) | [CLOUD] | This branch |
| 14 | Prettier plus `eslint-config-prettier` ([2](#2-hygiene)) | [CLOUD] | This branch |
```

- [ ] **Step 4: Correct the stale counts and claims in the body**

Four edits, each replacing a claim that is now wrong:

**1. §1.1, the measured build block.** Replace the fenced measurement and the paragraph after it with:

````markdown
```
DATABASE_URL=postgres://x npx next build
→ EXIT=0 · 32 routes · 28 ƒ (dynamic) · 4 prerendered
```

Re-measured 2026-09-02: 32 routes, not 30, and four now settle at build time rather than two —
the icon routes became SSG. That widens the case above a little further: `next build` executes
page code for four routes, so a prerender-time throw in any of them is a failure CI catches and
`verify` does not. Still narrow, still cheap, and it landed on this branch.
````

**2. §1.1, the placement argument.** Replace "So the change is one line in the workflow, or adding `build` to the `verify` script" with a note that it landed as a workflow step — **keeping** the reasoning for why it stays out of `verify` (that `verify` is what a developer runs in a loop, and a 10-second build is a local tax for no local benefit). The reasoning is the part that goes stale slowly; do not delete it.

**3. §1.4.** Strike through the `.nvmrc` and Dependabot bullets in the house style already used for branch protection: `~~**Dependabot, monthly, grouped.**~~ **Done.** ...`.

**4. §3.3.** Record that all three layers now exist — layer 1 landed in Task 2, layer 2 in Task 5, layer 3 since [#7](https://github.com/NoahJohn1/SimulatedBetting/pull/7) — and that the funnel property was re-verified 2026-09-02: exactly one `.insert(ledgerEntries)` outside tests at `ledger.ts:69`, zero updates or deletes anywhere, 28 files referencing `postEntry`. Replace the closing sentence *"Two rounds of verification five days apart is not the same as a test"* with the observation that it is a test now.

- [ ] **Step 5: Rewrite §3.6's lane header**

Replace the `**Lane: [LOCAL].**` header with the split, and record what each lane proved:

```markdown
**Lane: [CLOUD] to write and mostly prove, [LOCAL] to finish.** The original `[LOCAL]` tag was
broader than the work. A cloud session is the *better* place to prove four of the hook's five
branches, because a cloud session is the degraded environment the hook exists to handle.

| Branch | Proven where | Status |
|---|---|---|
| `npm ci` when `node_modules` is absent | [CLOUD] | ✅ |
| Re-running is a no-op | [CLOUD] | ✅ |
| No daemon → prints instructions, exits 0 | [CLOUD] | ✅ |
| A `docker` binary on `PATH` is not mistaken for a daemon | [CLOUD] | ✅ |
| `docker compose up -d --wait` and both migrations | **[LOCAL]** | 🔲 Outstanding — row 4 |
```

- [ ] **Step 6: Replace the closing Prettier paragraph with the decision**

The final paragraph currently says the conclusion "is now an open question again, not a settled one." Replace it with the decision taken: adopted on this branch, config matched to the existing code (86 files rather than 230), the reformat isolated as one droppable commit, `format:check` out of CI until the adapter lands, and a `[NOAH]` coordination row.

- [ ] **Step 7: Add two entries to `docs/decisions.md`**

Use the `decision-log` skill — it handles the next-number lookup, the house format (`### D<n> — <title>`, an `*Added <date> during the <x> session.*` line, body, then `*Rejected:*` paragraphs), and GitHub's anchor slugs.

- **Prettier adopted with a config matched to the existing code.** *Rejected:* Prettier's defaults (230 files rather than 86, for no property anyone chose); adding `format:check` to `verify` now (turns Noah's merge conflict into a red build).
- **The money-path hook is a flag, not a review.** One line pointing at `/money-invariants`. *Rejected:* spawning an agent review on every save — slow enough to interrupt an edit, and the reliable outcome of that is that someone disables it, which enforces nothing.

- [ ] **Step 8: Update the three "What is left" tables in `docs/README.md`**

The cloud table loses every row this branch landed and keeps only blocked or out-of-scope work (rows 3 and 6 above, plus the 7c/7d/9 roadmap items). The Noah table gains the Prettier coordination row. The desktop table's `session-start` row narrows to "verify the Docker path" rather than "write the hook."

- [ ] **Step 9: Confirm the spec and plan are listed in `docs/README.md`**

Both rows were added under **Active** when the spec and plan were committed, so that neither document was invisible for even one commit. Verify rather than re-add:

```bash
grep -c "2026-09-02-cloud-lane-completion" docs/README.md
```

Expected: `2`. If it prints `0`, add both rows under **Active**:

```markdown
| [Cloud lane spec](specs/2026-09-02-cloud-lane-completion-design.md) | Closing every [CLOUD] item in repo health — the cron guard, the funnel guard test, the CI chore, both hooks, and Prettier |
| [Cloud lane plan](plans/2026-09-02-cloud-lane-completion-implementation-plan.md) | The task-by-task plan for that work |
```

- [ ] **Step 10: Update `docs/roadmap.md`**

The roadmap references repo-health's lanes. Update anything that describes the `session-start` hook as `[LOCAL]` to the split tag, and refresh the cross-reference to the Outstanding table if its row numbers are cited.

- [ ] **Step 11: Run the link checker**

```bash
python3 /tmp/linkcheck.py
```

Expected: `LINKS OK`. Anchors added or renamed in this task are the likely failures — fix the link, not the heading, unless the heading itself is wrong.

- [ ] **Step 12: Final gate**

```bash
npm run typecheck && npm run lint && npm run format:check
npx vitest run src/server/money/__tests__/ledger-funnel.test.ts
```

Expected: all clean, `3 passed`. **`npm test` in full still cannot run here** — CI proves it on the pull request.

- [ ] **Step 13: Commit**

```bash
git add docs/
git commit -m "docs: record the cloud lane as closed, and what is left after it

The Outstanding table now holds nothing a cloud session can finish
unblocked: two [NOAH] rows, one [LOCAL], two [MANUAL], and three [CLOUD]
rows that each name what they wait on.

Corrects two stale claims rather than leaving them to update themselves:
the build is 32 routes with 4 prerendered, not 30 with 2, and the
session-start hook's [LOCAL] tag was broader than the work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Push and open the pull request

- [ ] **Step 1: Push**

```bash
git push -u origin claude/repo-health-cloud-tasks-cgxe9i
```

Retry up to four times with exponential backoff (2s, 4s, 8s, 16s) on network failure only.

- [ ] **Step 2: Watch CI**

The `verify` job runs the **full suite against a real Postgres** — the thing no cloud session can do. It is the real gate on this branch, and the Prettier reformat is the change most worth proving. If it is red, fix it here; do not merge around it.

- [ ] **Step 3: Say plainly what is left for a human**

The PR body must carry the handoff, because it is the one thing nobody can do from a cloud session:

- **[NOAH]** `APP_URL` and `CRON_SECRET` as Actions secrets, then a manual dispatch of both jobs. The app is not settling bets until this lands.
- **[NOAH]** Commit or stash the ESPN adapter work before merging — the reformat commit conflicts in every file it touches. It is the last commit but one and can be dropped.
- **[LOCAL]** Verify the `session-start` hook's `docker compose` path on a desktop.

---

## Deliberately not in this plan

- **Uncommenting the cron `schedule:`.** Blocked on Noah. Task 1 lands the guard only.
- **`format:check` in `verify` or CI.** Blocked on the adapter landing.
- **The `db-migration` skill.** Its trigger — a migration going wrong — has not fired. Task 8 records the trigger so the next reader does not re-derive why a `[CLOUD]` item is undone.
- **Removing `TEST_DATABASE_URL`.** Task 6 marks it unread; deleting it touches CI and is a separate change.
- **Any application behaviour.** The only `src/` addition is a test that reads files. Task 7 reformats source and changes no logic.
- **The human test pass, the cron secrets, hosted Postgres, Sentry, email.** Not cloud work, and not this plan's.
