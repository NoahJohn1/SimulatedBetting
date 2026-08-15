# Implementation plans

The [core betting engine spec](../specs/2026-08-14-core-betting-engine-design.md) is too
large for one plan. It's split into three, each producing working, testable software on its
own.

| Plan | Produces | Status |
|---|---|---|
| [1 — Foundation & money core](2026-08-15-01-foundation-and-money-core.md) | Postgres schema, append-only ledger, seasons, allowance, admin adjustments, and the pure betting math. Headless — no odds, no UI. | **Task-level detail written. Ready to build.** |
| 2 — Odds & betting engine | Provider interfaces, fixture data, odds sync, bet placement, settlement. Still headless. | Ownership assigned below; task detail written after Plan 1 ships |
| 3 — Web app & auth | Google/Apple sign-in, the four tabs, bet slip, admin screens, cron routes, deployment. | Ownership assigned below; task detail written after Plan 2 ships |

Plans 2 and 3 get their task-level detail written once the plan before them is done. Writing
all three up front would mean inventing exact function signatures for code that doesn't exist
yet — and a plan whose `Interfaces` blocks are guesses is worse than no plan, because two
workers would build against contracts that turn out to be wrong.

---

# The v1 work split

Two workers, called **A** and **B** throughout every plan. Pick who is who once and keep it —
ownership carries across all three plans, so each of you builds continuous knowledge of one
half of the system rather than a random scattering.

| | **Worker A — the plumbing** | **Worker B — the betting** |
|---|---|---|
| Owns | Database, ledger, money movement, odds ingestion, background jobs, account and admin screens | Odds math, grading, bet placement, settlement, the betting screens |
| Plan 1 | Tasks 3–9 | Tasks 10–13 |
| Plan 2 | Providers, fixtures, odds sync | Bet placement, settlement |
| Plan 3 | Standings, Me/ledger, Admin, three cron routes | Games, Game detail, Bet slip, My Bets, settle cron route |
| Suits someone who likes | Databases, transactions, correctness under concurrency, data pipelines | Pure logic, algorithms, edge cases, product surface |

**If one of you is more experienced, take A.** The row locking and idempotency in Plan 1 Task 5
are the subtlest work in the project, and Plan 2's provider abstraction is the piece most likely
to be wrong in a way that hurts later.

## The shape of every plan: pair, split, rejoin

Each of the three plans has the same three phases, and this is what keeps two workers from
colliding:

1. **Pair phase** — the shared foundation. Both workers, one sitting, one screen. Short.
2. **Split phase** — the long stretch. Strict file ownership, no overlap, work independently
   for days without a merge conflict.
3. **Rejoin** — integration, full test suite, whatever needed both halves to exist.

The pair phase is not ceremony. It's the part where you agree on the things both of you will
build against — schema, interfaces, shared components. Skip it and you get two incompatible
halves.

---

## Plan 1 — Foundation & money core

**Pair:** Tasks 1–2 (~1 hour). Project scaffold, Docker Postgres.

**Split:**

| Worker A — Tasks 3–9 | Worker B — Tasks 10–13 |
|---|---|
| `src/db/**`, `src/server/**`, `src/test/**`, `drizzle/**` | `src/domain/**` |
| Schema, ledger write path, seasons, allowance, admin adjustments, reconciliation | Cents parsing, exact odds arithmetic, leg grading, parlay grading |
| Needs Docker running | Needs nothing but Node |

**Rejoin:** Task 14 — CI, after both have merged to `main`.

Verified conflict-free: A never opens `src/domain/`, B never opens `src/db/` or `src/server/`.
B's code is forbidden from importing A's by a global constraint in the plan.

Full ownership table, per-task owner labels, and copy-pasteable AI agent instructions are in
[the plan itself](2026-08-15-01-foundation-and-money-core.md#ownership--read-this-before-starting).

---

## Plan 2 — Odds & betting engine

**Pair phase — the sports and betting schema.** Both workers, together, before anything else:
`teams`, `games`, `markets`, `selections`, `odds_snapshots`, `bets`, `bet_legs`, and adding
`bet_id` to `ledger_entries`. Both halves of the split build directly against these tables, so
they must be agreed jointly. Expect one sitting.

**Split phase:**

| Worker A — odds ingestion | Worker B — bet lifecycle |
|---|---|
| `src/server/odds/**`, `src/fixtures/**` | `src/server/bets/**` |
| `OddsProvider` and `ScoreProvider` interfaces; the fixture-backed implementations; the fixture data itself (a realistic NFL and CFB slate including a push, a postponement, and a line movement); the `syncOdds` job; market suspension when data goes stale | `placeBet` — all six validation rules, the row-locked transaction, the line-changed rejection; `settleGame` — grading every leg, grading the bet, writing the payout entry, the re-settlement path |

They meet only at the database: A's job writes games and lines, B's services read them. Neither
imports the other's modules.

**Rejoin:** an end-to-end test that runs the fixture slate through sync, placement, and
settlement, and asserts exact final balances.

**Dependency note:** B's settlement calls `postEntry` and the grading functions — both already
merged in Plan 1, so nothing is blocked.

---

## Plan 3 — Web app & auth

**Pair phase — auth and the app shell.** Auth.js with Google and Apple, the session and
authorization helpers, the pending-approval gate, the bottom tab bar, the PWA manifest, and the
shared UI primitives (button, sheet, odds button, money display). Everything else hangs off
these, and two people inventing their own button component is exactly the conflict this phase
prevents. Expect one long sitting.

**Split phase — by screen:**

| Worker A — the account path | Worker B — the betting path |
|---|---|
| `src/app/(app)/standings/**`, `src/app/(app)/me/**`, `src/app/admin/**` | `src/app/(app)/games/**`, `src/app/(app)/bets/**`, `src/components/bet-slip/**` |
| Standings leaderboard; the Me tab and its full ledger view; the entire admin area (approvals, seasons, balance adjustments, void/re-settle) | Games board with the odds grid; game detail with line history; the bet slip sheet with singles/parlay toggle; My Bets |
| Cron routes: `sync-odds`, `allowance`, `reconcile` | Cron route: `settle` |

Each worker takes the screens that sit on top of the code they already wrote. A built the
ledger, so A builds the ledger view; B built settlement, so B builds the bet views.

**Rejoin:** deployment. Hosted Postgres, environment variables, OAuth credentials, Vercel cron
configuration, and a first real season. Do this together — it's the one part with credentials
involved, and both of you should know how it's wired.

---

## Rules that hold across all three plans

1. **Never edit a file you don't own.** If a task seems to need it, stop and raise it. That is
   a design problem, not a coding problem.
2. **Never edit the other worker's tests**, including to make your build pass.
3. **One branch per task.** `a/task-5-ledger`, `b/task-11-odds`. Merge as each passes. Small
   PRs get reviewed; large ones sit for a week.
4. **Run only your own tests while working.** The full suite is expected to fail for one worker
   until the other merges. That is not a bug and not yours to fix.
5. **Published interfaces are contracts.** Changing a signature the other worker depends on
   requires telling them first.
6. **Review each other's PRs even when you don't understand the area.** The point is not
   catching every bug — it's that neither of you ends up the only person who understands half
   the codebase. "Why does this take a lock here?" is a good review.

## Handing the work to AI agents

Plan 1 contains two copy-pasteable agent briefs — one for A, one for B — in its
[ownership section](2026-08-15-01-foundation-and-money-core.md#handing-this-to-two-ai-agents).
Each brief names the tasks, the directories that agent may write, the directories it must not
touch, and the test command to verify with.

Two things worth knowing before you do this:

**Pair-phase tasks are not agent-parallel work.** Tasks 1, 2, and 14 in Plan 1 — and the pair
phases of Plans 2 and 3 — touch shared config and shared schema. Run them yourself, or with a
single agent while you both watch. Two agents editing `package.json` at once is exactly the
mess the split is designed to avoid.

**Give each agent only its own brief, not both.** An agent handed the whole document will start
at Task 1 and work through everything, which is precisely the conflict you're trying to prevent.
