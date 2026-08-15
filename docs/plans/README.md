# Implementation plans

The [core betting engine spec](../specs/2026-08-14-core-betting-engine-design.md) is too
large for one plan. It's split into three, each producing working, testable software on its
own.

| Plan | Produces | Status |
|---|---|---|
| [1 — Foundation & money core](2026-08-15-01-foundation-and-money-core.md) | Postgres schema, append-only ledger, seasons, allowance, admin adjustments, and the pure betting math. Headless — no odds, no UI. | **Task-level detail written. Ready to build.** |
| 2 — Odds & betting engine | Provider interfaces, fixture data, odds sync, bet placement, settlement. Still headless. | Scoped in the worker briefs; task detail written after Plan 1 ships |
| 3 — Web app & auth | Google/Apple sign-in, the four tabs, bet slip, admin screens, cron routes, deployment. | Scoped in the worker briefs; task detail written after Plan 2 ships |

---

# Start here: the two worker briefs

**Each person takes one brief, works out the details on their side, and builds.**

| | [**Worker A — Betting logic**](worker-a-brief.md) | [**Worker B — Data & money**](worker-b-brief.md) |
|---|---|---|
| Owns | Odds math, grading, bet placement, settlement, betting screens | Database, ledger, seasons, admin, odds ingestion, account screens |
| Plan 1 | Tasks 10–13 | Tasks 3–9 |
| Plan 2 | Bet placement, settlement | Providers, fixtures, odds sync |
| Plan 3 | Games, Game detail, Bet slip, My Bets | Standings, Me/ledger, Admin |
| Needs Docker | No — pure functions only | Yes |
| Suits someone who likes | Algorithms, edge cases, product surface | Databases, transactions, correctness under concurrency |

Each brief states exactly which directories that person may write, which they must never touch,
the function signatures they consume from the other, the ones they publish, and the open
questions they need to resolve before writing their own task detail for Plans 2 and 3.

Pick who is who once and keep it across all three plans — each of you builds continuous
knowledge of one half of the system instead of a random scattering.

---

## The shape of every plan: pair, split, rejoin

1. **Pair phase** — the shared foundation. Both workers, one sitting, one screen. Short.
2. **Split phase** — the long stretch. Strict file ownership, no overlap, days of independent
   work with no merge conflicts.
3. **Rejoin** — integration and whatever needed both halves to exist.

The pair phase is not ceremony. It's where you agree the things both of you build against:

| Plan | Pair phase |
|---|---|
| 1 | Tasks 1–2: project scaffold, Docker Postgres (~1 hour) |
| 2 | The sports and betting schema: `teams`, `games`, `markets`, `selections`, `odds_snapshots`, `bets`, `bet_legs`, and `ledger_entries.bet_id` |
| 3 | Auth.js with Google/Apple, app shell, tab bar, session and authorization helpers, shared UI primitives |
| — | **Rejoin for Plan 3:** deployment. Hosted Postgres, OAuth credentials, Vercel cron. Do it together — both of you should know how it's wired. |

Skip a pair phase and you get two incompatible halves. Two people independently inventing a
button component, or two migrations that disagree about a column, is exactly what this prevents.

---

## Why Plans 2 and 3 have no task detail yet

Their `Interfaces` blocks would be guesses — exact function signatures for code that doesn't
exist. Two workers building against a guessed contract is worse than no plan at all.

Each brief instead lists the **specific open questions that person must answer** before writing
their own tasks. Worker A's include the placement error codes and settlement batching strategy;
Worker B's include the fixture slate design and the upsert/snapshot strategy. Work those out on
your side, then write your tasks.

Plan 2's detail should be written the week Plan 1 merges, while the real shapes are fresh.

---

## Rules that hold across all three plans

1. **Never edit a file you don't own.** If a task seems to need it, stop and raise it. That is
   a design problem, not a coding problem.
2. **Never edit the other worker's tests**, including to make your build pass.
3. **One branch per task.** `a/task-11-odds`, `b/task-5-ledger`. Merge as each passes. Small
   PRs get reviewed; large ones sit for a week.
4. **Run only your own tests while working.** The full suite is expected to fail for one worker
   until the other merges. That is not a bug and not yours to fix.
5. **Published interfaces are contracts.** Changing a signature the other worker depends on
   requires telling them first.
6. **Review each other's PRs even when the area is unfamiliar.** The point is not catching every
   bug — it's that neither of you ends up the only person who understands half the codebase.

## Handing the work to AI agents

Give each agent **only its own brief**, plus the plan file. An agent handed both briefs, or the
plan alone, will start at Task 1 and work through everything — precisely the conflict you're
avoiding.

Ready-to-paste agent instructions are in the plan's
[ownership section](2026-08-15-01-foundation-and-money-core.md#handing-this-to-two-ai-agents).

**Pair-phase work is not agent-parallel.** Tasks 1, 2, and 14 in Plan 1, and the pair phases of
Plans 2 and 3, touch shared config and shared schema. Run them yourselves, or with a single
agent while you both watch. Two agents editing `package.json` at once is the mess the split
exists to prevent.
