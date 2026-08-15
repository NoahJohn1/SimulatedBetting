# Implementation plans

The [core betting engine spec](../specs/2026-08-14-core-betting-engine-design.md) is too
large for one plan. It's split into three, each producing working, testable software on its
own.

| Plan | Produces | Status |
|---|---|---|
| [1 — Foundation & money core](2026-08-15-01-foundation-and-money-core.md) | Postgres schema, append-only ledger, seasons, allowance, admin adjustments, and the pure betting math. Headless — no odds, no UI. | Ready to build |
| 2 — Odds & betting engine | Provider interfaces, fixture data, odds sync, bet placement, settlement. Still headless. | Not written yet |
| 3 — Web app & auth | Google/Apple sign-in, the four tabs, bet slip, admin screens, cron routes, deployment. | Not written yet |

Plan 2 is written once Plan 1 is done and the real shape of the code is visible. Writing all
three up front would mean guessing at interfaces that don't exist yet.

---

## Splitting the work between two people

The plans are deliberately structured so two people can work at the same time without
stepping on each other.

### Plan 1: two tracks that share no files

**Tasks 1–2 — do these together, in one sitting (~1 hour).** Project scaffold and the Docker
Postgres container. Both of you need a working environment before either track starts, and
doing it once together means you both know how it was set up. One person drives, the other
watches and asks questions.

After that, the work splits cleanly:

| | **Track A — Data & money** | **Track B — Betting math** |
|---|---|---|
| Tasks | 3–9 | 10–13 |
| Files | `src/db/**`, `src/server/**` | `src/domain/**` |
| Needs a database | Yes | No |
| The work | Schema, migrations, the ledger write path, seasons, allowance, admin adjustments, reconciliation | Cents parsing, exact odds arithmetic, leg grading, parlay grading |
| Suits someone who likes | Databases, transactions, correctness under concurrency | Pure logic, algorithms, edge cases, exhaustive tests |

**These tracks touch zero files in common.** Track A never opens `src/domain/`, and Track B
never opens `src/db/` or `src/server/`. You can both work all week without a single merge
conflict.

**Task 14 (CI) is done by whoever finishes first.**

### Which track should you take?

Track A is harder to get right and easier to get *started*. The row locking in Task 5 and the
idempotency behaviour are the two genuinely subtle pieces in the whole project — if one of you
is more experienced, that person should take Track A.

Track B is more self-contained and has crisper right answers. Every task is a pure function
with a table of test cases. It's the better track if you're newer to backend work or if you
want to be able to work on a plane with no Docker running.

### How to actually collaborate day to day

**Branch per task, not per track.** `git checkout -b track-a/task-5-ledger`. Each task in the
plan ends with a commit and is independently reviewable. Small PRs get reviewed; big ones sit
for a week.

**Review each other's PRs, even when you don't understand the area.** The point isn't to catch
every bug — it's that neither of you ends up the only person who understands half the codebase.
A review that's just "why does this take a lock here?" is a good review.

**Merge to `main` as you go.** Both tracks pass their own tests independently, so there's no
reason to hold work back. `main` should be green at all times, which Task 14's CI enforces.

**The `Interfaces` block in each task is the contract.** It lists exactly what a task consumes
from earlier tasks and produces for later ones. If you need to change a signature that another
task depends on, say so before you do it — that's the one place where the tracks touch.

### Plans 2 and 3

The same shape holds:

- **Plan 2** splits into *odds ingestion* (provider interface, fixtures, the sync job) and
  *bet lifecycle* (placement validation, the settlement job). They meet at the schema, so agree
  the `games` / `markets` / `selections` tables together first — the same way Tasks 1–2 work here.
- **Plan 3** splits most naturally **by screen**. One person takes Games + Game Detail + Bet
  Slip, the other takes My Bets + Standings + Me + Admin. Auth and the app shell are shared
  setup, done together first.

Whoever built the money core in Plan 1 should take the ledger-facing screens in Plan 3 — the
"Me" tab is a direct view onto their work.
