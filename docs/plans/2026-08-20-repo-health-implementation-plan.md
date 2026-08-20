# Repo Health and Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the recommendations in [`docs/repo-health.md`](../repo-health.md) — close the CI gaps, make a fresh session able to run the test suite, lock in the ledger funnel property with a guard test, and package this project's two fiddliest conventions as skills.

**Architecture:** Seven independent tasks with **disjoint file ownership**, so tasks 1–6 can run in parallel with no merge conflicts. Task 7 is serial and runs last, because it is the only task that edits documentation every other task reports into.

**Tech Stack:** GitHub Actions, Claude Code hooks and skills, Vitest, Node 22, Docker Compose, Drizzle.

## Global Constraints

- **Node 22.** CI pins it via `setup-node`; tasks 6 pins it everywhere else.
- **No new runtime dependencies.** Every task here uses what is already installed, or Node built-ins.
- **`npm run verify` must pass** before any task commits. It is typecheck + lint + 546 tests.
- **Tests need a database.** `docker compose up -d --wait`, then a `.env.test` containing a `DATABASE_URL` that points at `simbet_test`. See Task 2 — this is currently undocumented and is why a fresh clone cannot run tests.
- **Never commit a real secret.** `.env*` is gitignored except `.env.example`; keep it that way.
- **Commit messages** follow the existing style: lowercase `type: summary`, then a body explaining *why*. No model identifiers anywhere in a commit message, file, or comment.

## Where each task can run

Measured on 2026-08-20 in a Claude Code cloud session. **There is no Docker daemon there** —
the client is installed but `/var/run/docker.sock` does not exist — so Postgres cannot start
and the 546-test suite cannot run. It fails fast with `DATABASE_URL is not set` rather than
hanging, which at least makes the blockage obvious.

What does work in a cloud session: `npm run typecheck` (exit 0), `npm run lint` (exit 0, 3
warnings), `npm run build` (10.7s — needs `DATABASE_URL` set but not reachable), and any test
that never opens a connection. Task 1's guard test is one of those: it reads source files, so
it runs in 324ms with no database.

| Task | Cloud session | Notes |
|---|---|---|
| 1 — guard test | **Partial** | The test itself runs and passes. Step 2's failure probe works. Step 4's `npm run verify` is blocked — substitute `npm run typecheck && npm run lint` and run the full suite locally before merging. |
| 2 — SessionStart hook | **Partial** | The script can be written and its graceful-degradation path is actually testable here: `docker` resolves but the daemon is absent, so `docker compose up` fails and the hook must still exit 0. Step 4 (prove the suite runs) needs a local machine. |
| 3 — decision-log skill | **Yes** | A markdown file. No database, no build. |
| 4 — money-invariants skill | **Yes** | A markdown file. |
| 5 — issue template | **Yes** | YAML files. |
| 6 — CI and Node pinning | **Partial** | All files can be written; `npm run build` verifies here. Step 5's `npm run verify` is blocked. |
| 7 — documentation | **Partial** | Edits and the link checker run fine. The closing `npm run verify` is blocked. |
| 8 — GitHub settings | **Yes** | A browser task, not a local one — doable right now from any browser, phone included. |

**The rule:** anything whose deliverable is a file can be done in a cloud session. Anything
whose *verification* is the test suite has to be confirmed on a machine with Docker. So a cloud
session can write all seven tasks; it just cannot honestly close the ones whose gate is
`npm run verify`.

If you implement in the cloud, leave the suite unrun rather than claiming it passed, and run
`npm run verify` locally before merging. A green typecheck and lint is not the gate — CI runs
the full suite and will catch what you could not.

---

## Parallel Execution Map

Tasks 1–6 touch no file in common and may be dispatched simultaneously:

| Task | Owns these paths exclusively |
|---|---|
| 1 | `src/server/money/__tests__/ledger-funnel.test.ts` |
| 2 | `.claude/settings.json`, `.claude/hooks/session-start.sh` |
| 3 | `.claude/skills/decision-log/SKILL.md` |
| 4 | `.claude/skills/money-invariants/SKILL.md` |
| 5 | `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/config.yml` |
| 6 | `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.nvmrc`, `package.json` |
| 7 | `docs/repo-health.md`, `docs/README.md`, `README.md` — **run last** |

**If dispatching parallel subagents, give each one its own git worktree.** They share one git index otherwise, and six agents committing into one index will collide even though their files do not. The `superpowers:using-git-worktrees` skill sets this up. If running tasks sequentially in one checkout, no worktree is needed.

**Task 8 is not a coding task** — it is a checklist of things only a repository admin can do through the GitHub web UI.

---

## Task 1: Guard test for the ledger funnel

Locks in a property that holds today: every ledger write goes through `postEntry`, and nothing ever updates or deletes a ledger row. Verified on 2026-08-20 — eleven production call sites, zero direct inserts outside `src/server/money/ledger.ts`, zero updates or deletes repo-wide.

This is a characterization test, so the usual red step is inverted: the test passes the moment it is written. Step 2 creates a deliberate violation to prove the test can actually fail, then removes it. **Do not skip step 2** — a guard test that cannot fail is worse than none, because it looks like coverage.

**Files:**
- Create: `src/server/money/__tests__/ledger-funnel.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on. Task 4's skill references this file by path.

- [ ] **Step 1: Write the guard test**

Create `src/server/money/__tests__/ledger-funnel.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The ledger is append-only (D5) and every write funnels through `postEntry`, which is what
 * guarantees the idempotency key and the same-transaction balance update. Both properties are
 * invisible to a normal unit test: they are facts about which call sites exist, not about what
 * any one function returns. So this test reads the source.
 *
 * The schema tests in `src/db/__tests__` insert directly on purpose — they exist to prove the
 * database constraints, so they are exempt from the funnel rule but not from the append-only one.
 */

const SRC = join(process.cwd(), 'src');
const LEDGER_MODULE = ['src', 'server', 'money', 'ledger.ts'].join(sep);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }

    if (full.endsWith('.ts') || full.endsWith('.tsx')) found.push(full);
  }

  return found;
}

function offenders(pattern: RegExp, exempt: (path: string) => boolean): string[] {
  return sourceFiles(SRC)
    .map((file) => ({ path: relative(process.cwd(), file), body: readFileSync(file, 'utf8') }))
    .filter(({ path }) => !exempt(path))
    .filter(({ body }) => pattern.test(body))
    .map(({ path }) => path);
}

describe('ledger funnel', () => {
  it('routes every ledger insert through postEntry', () => {
    const isTest = (path: string) => path.split(sep).includes('__tests__');

    expect(
      offenders(/\.insert\(\s*ledgerEntries\s*\)/, (path) => path === LEDGER_MODULE || isTest(path)),
    ).toEqual([]);
  });

  it('never updates or deletes a ledger row', () => {
    expect(offenders(/\.(update|delete)\(\s*ledgerEntries\s*\)/, () => false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Prove the test can fail**

Temporarily append a violation to a file the rule covers:

```bash
printf '\n// probe\nconst probe = () => db.update(ledgerEntries);\n' >> src/server/bets/place.ts
npx vitest run src/server/money/__tests__/ledger-funnel.test.ts
```

Expected: **FAIL** on "never updates or deletes a ledger row", listing `src/server/bets/place.ts`.

Now remove the probe and confirm the file is byte-identical to HEAD:

```bash
git checkout src/server/bets/place.ts
git diff --stat src/server/bets/place.ts
```

Expected: no output from `git diff --stat` — the file is unmodified.

- [ ] **Step 3: Run the test to verify it passes**

```bash
npx vitest run src/server/money/__tests__/ledger-funnel.test.ts
```

Expected: **PASS**, 2 tests.

- [ ] **Step 4: Run the full gate**

```bash
npm run verify
```

Expected: typecheck clean, 0 lint errors, all tests pass (547 now, up from 546).

- [ ] **Step 5: Commit**

```bash
git add src/server/money/__tests__/ledger-funnel.test.ts
git commit -m "test: guard the ledger funnel and the append-only rule

Every ledger write already goes through postEntry, and nothing anywhere
updates or deletes a ledger row. Both are facts about which call sites
exist rather than about any function's return value, so a normal unit test
cannot see them and a future change could quietly break either one.

Reads the source and asserts both. The schema tests insert directly on
purpose, to prove the database constraints, so they are exempt from the
funnel rule but not from the append-only one."
```

---

## Task 2: SessionStart hook

A Claude Code web session starts with no `node_modules` and no Postgres, so it cannot run the suite. This hook fixes that, and fixes a real gap it exposes: **`src/test/setup.ts` loads `.env.test`, which is gitignored and which the README never tells you to create.** A fresh clone therefore cannot run `npm test` even locally, because `src/db/client.ts` throws without `DATABASE_URL`.

The hook must never fail the session. Every path exits 0; problems are reported on stderr as instructions.

**Files:**
- Create: `.claude/settings.json`
- Create: `.claude/hooks/session-start.sh`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a `.env.test` at runtime (gitignored, never committed). Task 7 documents it in the README.

- [ ] **Step 1: Write the hook script**

Create `.claude/hooks/session-start.sh`:

```bash
#!/usr/bin/env bash
# Prepares a fresh session to run the test suite: dependencies, Postgres, test database.
#
# This must never fail a session. Every branch exits 0 — when something cannot be done, it
# prints what to run by hand instead. A hook that blocks session start is worse than no hook.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root" || exit 0

log() { printf '[session-start] %s\n' "$1" >&2; }

if [ ! -d node_modules ]; then
  log 'installing dependencies (npm ci) — a cold install takes a couple of minutes'
  npm ci --no-audit --no-fund >/dev/null 2>&1 || log 'npm ci failed; run it by hand'
fi

# Vitest loads .env.test (src/test/setup.ts) and src/db/client.ts throws without DATABASE_URL.
# The file is gitignored, so a fresh clone has to generate it.
if [ ! -f .env.test ]; then
  log 'writing .env.test (gitignored) so vitest can reach the test database'
  cat > .env.test <<'ENV'
DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test
TEST_DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test
ENV
fi

if ! command -v docker >/dev/null 2>&1; then
  log 'docker not found; skipping database setup. Tests that need Postgres will fail.'
  exit 0
fi

if ! docker compose up -d --wait >/dev/null 2>&1; then
  log "could not start Postgres; run 'npm run db:up' by hand"
  exit 0
fi

npm run db:test:create >/dev/null 2>&1 || true

if ! DATABASE_URL='postgres://simbet:simbet@localhost:5433/simbet_test' \
  npx tsx src/db/migrate.ts >/dev/null 2>&1; then
  log "test migrations failed; run 'npm run db:migrate:test' to see why"
  exit 0
fi

log 'ready — dependencies installed, Postgres up, test database migrated'
exit 0
```

- [ ] **Step 2: Make it executable and run it directly**

```bash
chmod +x .claude/hooks/session-start.sh
bash .claude/hooks/session-start.sh
```

Expected: a `[session-start] ready — ...` line on stderr. If Docker is unavailable in your environment, expect the skip message instead and a zero exit code — that is correct behavior, not a failure.

- [ ] **Step 3: Prove it is idempotent**

```bash
bash .claude/hooks/session-start.sh
echo "exit=$?"
```

Expected: `exit=0`, no reinstall, no error. Running it twice must be a no-op.

- [ ] **Step 4: Prove the suite now runs**

```bash
npx vitest run src/server/money/__tests__/ledger-schema.test.ts
```

Expected: PASS. This is the check that matters — it proves `.env.test` and the migrated database are wired correctly. (If Docker is unavailable here, skip this step and note it in the commit body.)

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
            "command": "bash .claude/hooks/session-start.sh",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Confirm .env.test stays out of git**

```bash
git status --short
```

Expected: `.claude/settings.json` and `.claude/hooks/session-start.sh` only. **`.env.test` must not appear.** If it does, stop — `.gitignore` is wrong and committing it would leak a connection string.

- [ ] **Step 7: Commit**

```bash
git add .claude/settings.json .claude/hooks/session-start.sh
git commit -m "chore: prepare fresh sessions to run the test suite

A session starts with no node_modules and no Postgres, so it cannot run
the suite — which is a bad position from which to trust any change.

Also generates .env.test. src/test/setup.ts loads that file and
src/db/client.ts throws without DATABASE_URL, but it is gitignored and
the README never says to create it, so a fresh clone could not run the
tests locally either.

Every branch exits 0. When something cannot be done the hook prints what
to run by hand rather than blocking the session."
```

---

## Task 3: `decision-log` skill

Fifty decisions and growing. The format is fiddly, the anchor slugs are easy to get wrong by hand, and the supersede-don't-edit rule is the kind of thing that gets forgotten exactly when it matters.

**Files:**
- Create: `.claude/skills/decision-log/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the skill**

Create `.claude/skills/decision-log/SKILL.md`:

```markdown
---
name: decision-log
description: Record a design decision in docs/decisions.md using this project's D-number convention, or supersede an earlier one. Use when a design choice has just been made and should be written down, when a previous decision turns out to be wrong, or when cross-linking a decision from another document. Covers the entry format, the next-number lookup, and GitHub's anchor slug rules.
---

# Recording a decision

`docs/decisions.md` is an append-only log. Entries are numbered `D1`, `D2`, … and referenced
by anchor from the roadmap, the specs, and the READMEs.

## Find the next number

```bash
grep -n '^### D' docs/decisions.md | tail -1
```

The next entry is that number plus one. Never reuse a number, and never renumber.

## The entry format

Append to the end of the file, after a `---` separator:

```markdown
---

### D<n> — <Title in sentence case>

*Added <YYYY-MM-DD> during the <what> session.*

<One or two paragraphs: what was decided, stated as a fact about the system rather than as a
proposal. Say what it means in practice.>

*Rejected:* <the alternative>. <Why it lost — the specific cost, not a general preference.>

*Rejected:* <another alternative, if there was one>. <Why.>
```

Every entry needs at least one `*Rejected:*` paragraph. A decision with no rejected alternative
was not a decision; it was a default, and it does not need an entry.

Optional closing paragraphs, when they apply:

- `*What this accepts:*` — the known downside you are choosing to live with.
- `*Consequence to watch:*` — something that will need attention later.

## Superseding

**Never edit an existing entry.** When a decision turns out to be wrong, write a new one that
says what it supersedes and why the old reasoning failed. D49 supersedes D2 this way: it
names the part of D2 that still stands, and the part it replaces.

## Cross-linking

GitHub derives the anchor from the heading: lowercase it, delete punctuation — apostrophes and
colons included — and replace spaces with hyphens. The em dash becomes a double hyphen because
the spaces on either side each become one.

`### D49 — ESPN's public JSON is the odds and score source, superseding D2`
→ `#d49--espns-public-json-is-the-odds-and-score-source-superseding-d2`

Link from other docs as `[D49](decisions.md#d49--espns-...)`, adjusting the relative path.

## Verify before finishing

```bash
grep -c '^### D' docs/decisions.md
```

The count should have gone up by exactly the number of entries you added. Then check that every
anchor you wrote resolves — a broken decision link is invisible until someone follows it.
```

- [ ] **Step 2: Verify the frontmatter parses**

```bash
head -5 .claude/skills/decision-log/SKILL.md
```

Expected: a `---` line, `name: decision-log`, a `description:` on one line, then `---`. The
description must be a single line; a wrapped one breaks the frontmatter.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/decision-log/SKILL.md
git commit -m "chore: add a decision-log skill

Fifty entries in, the D-number format is the convention most likely to be
got wrong: the next number, the *Rejected:* paragraphs, the supersede rule,
and GitHub's anchor slugs, which drop apostrophes and colons and turn a
spaced em dash into a double hyphen.

Encodes the format so it survives being written by someone who has not read
all fifty."
```

---

## Task 4: `money-invariants` skill

Layer 3 of the money defense. Deliberately a skill rather than a subagent — `/code-review` and
`/security-review` already supply the reviewing machinery, and what they lack is this project's
specific knowledge.

**Files:**
- Create: `.claude/skills/money-invariants/SKILL.md`

**Interfaces:**
- Consumes: references `src/server/money/__tests__/ledger-funnel.test.ts` from Task 1 by path. Write the reference even if Task 1 has not landed yet — they are being done together.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the skill**

Create `.claude/skills/money-invariants/SKILL.md`:

```markdown
---
name: money-invariants
description: Review a change against this project's four money invariants — append-only ledger, deterministic idempotency keys, same-transaction balance cache, and separate escrow reconciliation. Use before committing anything under src/server/money, src/server/bets, src/server/p2p, src/server/events/resolve.ts, or src/db/schema/money.ts, and whenever reviewing a diff that touches balances, escrow, settlement, or ledger entry types.
---

# Money invariants

The ledger is the highest-stakes code here and the easiest to break subtly. Four invariants
hold today. A change that breaks one will usually still pass the test suite.

## What is already enforced mechanically — do not re-check by hand

`src/server/money/__tests__/ledger-funnel.test.ts` proves, by reading the source, that no code
outside `src/server/money/ledger.ts` inserts into `ledgerEntries`, and that nothing anywhere
updates or deletes one. If that test passes, invariant 1 and the funnel are intact. Spend your
attention on what follows instead.

## The four invariants

**1. The ledger is append-only.** Corrections write reversing entries; history is never edited
([D5](../../../docs/decisions.md)). The guard test covers the mechanical half. The judgment half:
does a correction path actually reverse, or does it recompute a number and write it as if it
were original?

**2. Every write carries a deterministic idempotency key.** The unique index on
`ledger_entries.idempotency_key` turns a repeated write into a rejection rather than a double
payment — but only if the key is genuinely deterministic. Ask:

- Does the key close over anything that varies between runs? `Date.now()`, a random id, an
  array index, or iteration order all silently defeat it.
- Is it derived from the identity of the event (bet id, wager id, week number) rather than from
  when the code happened to run?
- Can two *different* events collide on it? A correction must not reuse the original's key —
  see the comments in `src/db/schema/betting.ts` and `src/db/schema/p2p.ts`.

**3. The balance cache is written in the same transaction as its entry.** `balance_cents` is a
cache over the ledger ([D5](../../../docs/decisions.md)). If a new path writes an entry in one
transaction and updates the balance in another, a crash between them leaves them disagreeing,
and the daily `reconcileBalances` will find it a day later. Check that the `tx` handle passed to
`postEntry` is the same one the balance update runs on.

**4. Escrow needs its own reconciliation.** `reconcileBalances` cannot see credits sitting in a
pot — escrowed credits have left a balance and arrived nowhere
([D43](../../../docs/decisions.md)). Any new path that escrows must be visible to
`reconcileEscrow` in `src/server/money/reconcile.ts`. A wager that escrows and never pays out is
exactly the bug balance reconciliation is blind to.

## Currency correctness

Cash and credits are one ledger with a currency dimension
([D34](../../../docs/decisions.md)), not two ledgers. Credits are non-convertible
([D31](../../../docs/decisions.md)) — no path may turn credits into cash or the reverse. Custom
events and every peer-to-peer wager move credits only. Check that a new path does not mix them
in one bet, one wager, or one balance comparison.

## How to review

1. Get the diff: `git diff main...HEAD -- src/server/money src/server/bets src/server/p2p src/server/events src/db/schema`
2. For each new or changed `postEntry` call, answer invariant 2 and 3 explicitly.
3. For each new escrow or payout path, answer invariant 4.
4. Run `npx vitest run src/server/money src/db/__tests__` and confirm the guard and schema tests pass.
5. Report what you checked, not just what you found. "Idempotency key derives from wager id and
   status, deterministic" is a useful finding; silence is not.
```

- [ ] **Step 2: Verify the frontmatter parses**

```bash
head -5 .claude/skills/money-invariants/SKILL.md
```

Expected: valid frontmatter, `description:` on a single line.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/money-invariants/SKILL.md
git commit -m "chore: add a money-invariants review skill

The generic review skills supply the machinery; what they lack is this
project's specific knowledge — that idempotency keys must not close over
the clock, that a balance write shares its entry's transaction, and that
reconcileBalances is structurally blind to escrow.

Points at the guard test for the mechanically checkable half so a review
spends its attention on the judgment half instead."
```

---

## Task 5: Bug issue template

The human test pass will produce more findings than a conversation can hold, and it starts soon. This is the one template worth having.

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: the `bug` and `from-test-pass` labels, which Task 8 creates in the GitHub UI. The template applies them automatically once they exist.

- [ ] **Step 1: Write the template**

Create `.github/ISSUE_TEMPLATE/bug.yml`:

```yaml
name: Bug
description: Something behaved wrong in the app
labels: ['bug']
body:
  - type: textarea
    id: what-happened
    attributes:
      label: What happened
      description: What you did, and what the app did in response.
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: What should have happened
    validations:
      required: true

  - type: input
    id: screen
    attributes:
      label: Screen or URL
      placeholder: /wagers/abc123
    validations:
      required: false

  - type: dropdown
    id: money
    attributes:
      label: Does money look wrong?
      description: >-
        Balances, credits, escrow, a settlement that paid the wrong amount, or a bet that
        settled the wrong way. This is what separates annoying from drop-everything.
      options:
        - 'No — display or flow only'
        - 'Yes — a balance, payout, or escrow amount looks wrong'
        - 'Not sure'
    validations:
      required: true

  - type: dropdown
    id: reconciles
    attributes:
      label: Does reconciliation still pass?
      description: >-
        Run the reconcile cron or check the admin health page if it exists yet. Leave as
        "not checked" if you have not looked — a wrong answer here is worse than no answer.
      options:
        - 'Not checked'
        - 'Yes — reconciliation is clean'
        - 'No — reconciliation reports a discrepancy'
    validations:
      required: true
```

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: true
```

Blank issues stay enabled on purpose. With two developers, forcing every thought through a form
is friction; the template is there for the test-pass burst, not as a gate.

- [ ] **Step 2: Validate the YAML parses**

```bash
node -e "const fs=require('fs');for(const f of ['.github/ISSUE_TEMPLATE/bug.yml','.github/ISSUE_TEMPLATE/config.yml'])console.log(f, fs.readFileSync(f,'utf8').length, 'bytes')"
```

Expected: both files listed with a non-zero byte count. GitHub validates the schema itself on
push; a malformed form shows as an error on the repository's issue page.

- [ ] **Step 3: Commit**

```bash
git add .github/ISSUE_TEMPLATE
git commit -m "chore: add a bug issue template for the human test pass

The test pass will produce more findings than a conversation can hold.
Asks the two questions that triage a money app: does money look wrong,
and does reconciliation still pass.

Blank issues stay enabled — with two developers a mandatory form is
friction, and this exists for the test-pass burst rather than as a gate."
```

---

## Task 6: CI gaps and Node pinning

Six small changes to the gate. None is individually dramatic; together they close what is closable.

Note on `npm run build`: measured on 2026-08-20, its marginal catch over `npm run verify` is
narrower than it looks, because all 26 application routes are dynamic and the build therefore
never executes page code. It is included because it costs 10.7 seconds and catches
bundler-level resolution failures that TypeScript's module resolution can miss. Do not expect
it to catch much.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `.nvmrc`
- Modify: `package.json` (add an `engines` field only)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Pin Node**

Create `.nvmrc`:

```
22
```

Add an `engines` field to `package.json`, immediately after the `"private": true` line:

```json
  "engines": {
    "node": ">=22"
  },
```

- [ ] **Step 2: Verify package.json is still valid JSON**

```bash
node -e "console.log(require('./package.json').engines)"
```

Expected: `{ node: '>=22' }`

- [ ] **Step 3: Update the workflow**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

# A push supersedes the run before it. Work here lands in bursts, and a superseded
# run otherwise finishes for nothing.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: simbet
          POSTGRES_PASSWORD: simbet
          POSTGRES_DB: simbet_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U simbet"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgres://simbet:simbet@localhost:5433/simbet_test
      TEST_DATABASE_URL: postgres://simbet:simbet@localhost:5433/simbet_test

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - run: npm ci

      - run: npx tsx src/db/migrate.ts

      - run: npm run verify

      # Compiles every route. Needs DATABASE_URL set but not reachable, and no auth
      # credentials at all — nothing prerenders, so nothing evaluates auth at build time.
      - run: npm run build
```

- [ ] **Step 4: Add Dependabot**

Create `.github/dependabot.yml`:

```yaml
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
```

Monthly and grouped on purpose: weekly ungrouped updates on a two-person project are noise you
train yourself to ignore, which is worse than not having them.

- [ ] **Step 5: Prove the build step works locally**

```bash
npm run verify && npm run build
```

Expected: verify passes, then `Compiled successfully`. If Postgres is not running locally, the
tests inside `verify` will fail — start it first with `npm run db:up`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .github/dependabot.yml .nvmrc package.json
git commit -m "ci: build in the gate, cancel superseded runs, pin node

The gate never compiled the routes. Its marginal catch is narrow — every
application route is dynamic, so the build executes no page code — but it
costs ten seconds and catches resolution failures typecheck can miss.

Adds a concurrency group so a push supersedes the run before it, a
fifteen-minute timeout in place of the six-hour default, .nvmrc and an
engines field so a machine on the wrong Node fails loudly, and monthly
grouped Dependabot updates."
```

---

## Task 7: Documentation — run last, alone

The only task that touches documentation. Runs after 1–6 so it can describe what actually landed.

**Files:**
- Modify: `docs/repo-health.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the outcome of every earlier task.
- Produces: nothing.

- [ ] **Step 1: Document `.env.test` in the README**

In `README.md`, in the **Testing** section, immediately before the `npm run verify` code block,
insert:

```markdown
Tests load `.env.test` (see `src/test/setup.ts`), which is gitignored and separate from
`.env.local`. Create it once:

```bash
cat > .env.test <<'ENV'
DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test
TEST_DATABASE_URL=postgres://simbet:simbet@localhost:5433/simbet_test
ENV
```

A Claude Code session writes this for you — see `.claude/hooks/session-start.sh`.
```

- [ ] **Step 2: Mark landed items in the repo health doc**

In `docs/repo-health.md`, replace the line `Nothing here is implemented. This is the writeup;
each section is small enough to land on its own.` with a short status list naming which
recommendations landed and which remain (branch protection, milestones and labels, and the
`db-migration` skill, at minimum). Write what is actually true after tasks 1–6.

- [ ] **Step 3: Verify every link and anchor still resolves**

```bash
python3 - <<'PY'
import re, os
def slug(t):
    t=re.sub(r'[`*_\[\]()]','',t.strip().lower())
    return re.sub(r'[^\w\s-]','',t,flags=re.UNICODE).replace(' ','-')
def anchors(p):
    return {slug(m.group(2)) for m in (re.match(r'^(#{1,6})\s+(.*)$',l) for l in open(p)) if m}
bad=[]
for f,base in [('docs/repo-health.md','docs'),('docs/README.md','docs'),('README.md','.'),('docs/roadmap.md','docs')]:
    for m in re.finditer(r'\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)', open(f).read()):
        link=m.group(1).strip('<>')
        if link.startswith('http'): continue
        tgt,_,anc=link.partition('#')
        p=os.path.normpath(os.path.join(base,tgt)) if tgt else f
        if tgt and not os.path.exists(p.split(':')[0]): bad.append(f'{f}: missing {link}'); continue
        if anc and p.endswith('.md') and anc not in anchors(p): bad.append(f'{f}: bad anchor {link}')
print('\n'.join(bad) if bad else 'LINKS OK')
PY
```

Expected: `LINKS OK`

- [ ] **Step 4: Run the full gate one final time**

```bash
npm run verify && npm run build
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/repo-health.md
git commit -m "docs: document .env.test and record what landed

Tests load .env.test, which is gitignored and which the setup instructions
never mentioned — so following the README left you unable to run the suite.
Documents it, and notes that the session hook now writes it.

Marks which repo-health recommendations are done and which are still open."
```

---

## Task 8: What only a repository admin can do

Not a coding task. These are GitHub settings, and no amount of committed YAML substitutes for
them. **Branch protection is the highest-value item in this entire plan** — until it exists, CI
is advisory and a red pull request can be merged.

- [ ] **Branch protection on `main`**

Settings → Branches → Add branch ruleset (or "Add rule" on the classic screen) targeting `main`:

- Require a pull request before merging
- Require status checks to pass → select **`verify`**
- Require branches to be up to date before merging

Leave "Require approvals" **off**. With two developers, requiring an approval means you cannot
merge your own work when the other person is asleep, and the realistic outcome is that you
disable the rule entirely.

- [ ] **Create the labels**

Issues → Labels → New label. Six of them:

| Label | Suggested color | Meaning |
|---|---|---|
| `bug` | `#d73a4a` (exists by default) | Something behaved wrong |
| `money` | `#b60205` | Balances, payouts, escrow — drop-everything tier |
| `ui` | `#a2eeef` | Layout, polish, copy |
| `from-test-pass` | `#fbca04` | Found during the human test pass |
| `phase-5` … `phase-9` | `#0e8a16` | One per roadmap phase |

- [ ] **Create the milestones**

Issues → Milestones → New milestone, one per phase, named to match
[part two of the roadmap](../roadmap.md#part-two--production-readiness):

1. `Phase 5 — ESPN adapter`
2. `Phase 6 — Production deployment`
3. `Phase 7 — UI ladder`
4. `Phase 8 — Email notifications`
5. `Phase 9 — Hardening`

Leave due dates empty. A date you invent now is a date you will move.

- [ ] **Do not create issues from the roadmap yet**

Create a phase's issues when that phase starts. Thirty issues created now rot into a second,
contradictory roadmap that has to be reconciled with the first.

---

## Deliberately not in this plan

- **Prettier** — adopting it means one reformat commit touching nearly every file, immediately
  before the phase 7 UI rewrite. Revisit after phase 7, if at all.
- **The `db-migration` skill** — the README already documents the sequence; the only gain is
  that it gets followed without being asked. Add it if a migration goes wrong, not before.
- **A `PostToolUse` hook for money paths** — wants the guard test (Task 1) to prove its value
  first. If the guard test never fires in anger over a few phases, the hook is unnecessary
  machinery.
