# SimulatedBetting — documentation

A play-money sportsbook for a small private group. NFL and college football, real
sportsbook lines, simulated currency. No real money is involved at any point.

## Documents

### Active

| Document                                                                                        | What's in it                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [Roadmap](roadmap.md)                                                                           | The master status table — every item, done or not, with who finishes what's left                                              |
| [Repo health](repo-health.md)                                                                   | The CI gate, repo hygiene, Claude Code tooling, and issue tracking — with what is deliberately skipped at this project's size |
| [Mobile audit](mobile-audit.md)                                                                 | Every screen at 375×812, with each finding assigned to the ladder rung that owns its fix                                      |
| [Design-system audit](design-system-audit.md)                                                   | All 18 routes in both themes at two viewports, after the 7b sweep, with each remaining finding assigned to a rung             |
| [Repo health plan](plans/2026-08-20-repo-health-implementation-plan.md)                         | The task-by-task plan for the repo health work, written for parallel execution                                                |
| [Cloud lane spec](specs/2026-09-02-cloud-lane-completion-design.md)                             | Closing every [CLOUD] item in repo health — the cron guard, the funnel guard test, the CI chore, both hooks, and Prettier     |
| [Cloud lane plan](plans/2026-09-02-cloud-lane-completion-implementation-plan.md)                | The task-by-task plan for that work                                                                                           |
| [Docs status and archive spec](specs/2026-09-02-docs-status-and-archive-design.md)              | The owner taxonomy, the roadmap's master table, and what moved to the archive                                                 |
| [Docs status and archive plan](plans/2026-09-02-docs-status-and-archive-implementation-plan.md) | The task-by-task plan for that restructure                                                                                    |
| [Production deployment spec](specs/2026-09-02-production-deployment-design.md)                  | Phase 6's cloud half — the run record, alerting on cron failure and drift, Sentry, and the two admin screens                  |
| [Production deployment plan](plans/2026-09-02-production-deployment-implementation-plan.md)     | The task-by-task plan for that work, lane-tagged, with what a cloud session can and cannot verify                             |

### Reference

| Document                                                                   | What's in it                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Core betting engine spec](specs/2026-08-14-core-betting-engine-design.md) | The v1 build: architecture, data model, odds math, grading rules, jobs, failure handling, screens, testing     |
| [Social layer spec](specs/2026-08-17-social-layer-design.md)               | Subsystem 2: the season activity feed, reactions and comments, member profiles, per-viewer feed filters        |
| [Custom events spec](specs/2026-08-17-custom-events-design.md)             | Subsystem 3: member-created markets, the credits currency, human resolution and disputes                       |
| [Peer-to-peer bets spec](specs/2026-08-19-peer-to-peer-bets-design.md)     | Subsystem 4: member-vs-member wagers, escrow, two-party resolution, admin arbitration, head-to-head            |
| [UI foundations spec](specs/2026-08-22-ui-foundations-design.md)           | Phase 7a: error, not-found, and loading boundaries inside the app shell; metadata, icons, and the web manifest |
| [Design system spec](specs/2026-08-24-design-system-design.md)             | Phase 7b: the two-tier token layer, dark mode as a remap, the shared component set, and the sweep              |
| [Decision log](decisions.md)                                               | Every design decision, what was rejected, and why                                                              |

### Archive

Finished implementation plans, moved rather than deleted — each is the record of how its
subsystem was built.

| Document                                                                                    | What shipped          |
| ------------------------------------------------------------------------------------------- | --------------------- |
| [Social layer plan](archive/plans/2026-08-17-social-layer-implementation-plan.md)           | Subsystem 2 — shipped |
| [Custom events plan](archive/plans/2026-08-17-custom-events-implementation-plan.md)         | Subsystem 3 — shipped |
| [Peer-to-peer bets plan](archive/plans/2026-08-19-peer-to-peer-bets-implementation-plan.md) | Subsystem 4 — shipped |
| [UI foundations plan](archive/plans/2026-08-22-ui-foundations-implementation-plan.md)       | Phase 7a — shipped    |
| [Design system plan](archive/plans/2026-08-24-design-system-implementation-plan.md)         | Phase 7b — shipped    |

## The short version

Members sign in with Google, an admin approves them, and they join a season with
an equal starting bankroll plus a weekly allowance. They bet singles and parlays against
real sportsbook lines on NFL and CFB games. Finished games settle automatically. A
season-long leaderboard ranks everyone by balance.

Three properties the design is organized around:

1. **Every simulated dollar is accounted for.** An append-only ledger is the source of
   truth for all money. Balances are a cache reconciled against it daily. Corrections write
   reversing entries — history is never edited.
2. **Bets freeze their odds at placement.** Line movement afterward cannot change a placed
   bet.
3. **Running any background job twice moves no extra money.** Every ledger write carries a
   deterministic idempotency key.

## Where things stand

All four subsystems are built end-to-end and verified: `npm run verify` (typecheck, lint,
76 test files / 814 tests) passes clean, and the app runs, seeds a fixture slate, takes a bet
through placement and settlement (including a push), reconciles the ledger correctly in both
currencies, and posts and reads back the feed cards those actions generate — including a
custom event carried from creation through a disputed resolution and an admin correction, and
a peer-to-peer wager carried from offer through a dispute to an admin correction, with both
balance and escrow reconciliation clean throughout.

**Subsystem 1 — core betting engine:**

- Postgres schema (Drizzle), the append-only ledger, seasons, weekly allowance, admin
  balance adjustments, and daily reconciliation
- Odds math and grading (moneyline/spread/total, singles and parlays) as pure functions
- Fixture-backed odds sync and result sync, with market suspension on stale data
- Bet placement (with line/price re-validation at commit) and idempotent settlement,
  including resumable batching and admin-triggered re-settlement
- Google sign-in with admin-approval gating, seeded admins via `ADMIN_EMAILS`
- The four cron routes: `sync-odds`, `settle`, `allowance`, `reconcile`

**Subsystem 2 — social layer:**

- `feed_events`, an append-only, dedupe-keyed table mirroring the ledger's idempotency
  pattern, emitted inline from `placeBet`, `settleGame`, `resettleBet`, `joinSeason`,
  `payWeeklyAllowance`, and `adjustBalance`
- Eight event types: bets placed and settled, members joining, the weekly allowance
  (aggregated to one card, not one per member), admin adjustments (now season-visible — see
  [D24](decisions.md#d24--admin-adjustments-are-published-to-the-season-feed)), lead changes,
  big wins (10×+), and parlay hits (4+ surviving legs)
- Lead-change detection riding along in the `settle` cron route and after admin adjustments,
  with no new schedule and no cursor to get stuck
- A keyset-paginated feed read, reactions (six fixed emoji, toggle on/off), and comments
  (flat, author or admin soft-delete)
- Member profiles with season record, ROI, net, streak, and biggest win, computed by a pure
  `computeMemberStats` function
- Per-member feed filters, applied at read time so nothing muted is ever deleted
- Five member screens (Games, Feed, My Bets, Standings, Me) plus event detail and member
  profile pages

See [D30](decisions.md#d30--correlated-subqueries-in-drizzle-need-literal-qualified-identifiers)
for a real correlated-subquery bug the profile stats query's own test caught mid-build.

**Subsystem 3 — custom events:**

- The **credits** currency: a second, non-convertible balance
  ([D31](decisions.md#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency)),
  granted at season join and dripped weekly alongside the cash allowance, with its own cached
  balance column and its own line in daily reconciliation
  ([D34](decisions.md#d34--currency-is-a-dimension-on-the-existing-ledger-not-a-second-ledger))
- An `events` supertype above `games`, with `custom_events` as its sibling subtype and
  `markets` pointing at the supertype
  ([D33](decisions.md#d33--events-is-a-true-supertype-not-a-pair-of-nullable-foreign-keys))
- Event creation: any approved member opens a title, a resolve-by date, and one or more
  hand-priced N-way markets; a creator may bet their own event, disclosed everywhere that bet
  appears ([D32](decisions.md#d32--anyone-can-create-events-and-creators-may-bet-their-own-with-disclosure))
- Resolution that pays immediately in credits, and a dispute-plus-admin-re-resolution path
  that reverses and re-pays through the same reversal machinery settlement corrections already
  use ([D35](decisions.md#d35--custom-events-pay-on-resolution-disputes-are-an-admin-re-resolution))
- Admin voids, refunding every stake on the event, reached from either an open or an already
  resolved event
- A derived overdue sweep (`status = 'OPEN' AND resolves_by < now()`), riding the existing
  `settle` cron route with no new schedule
  ([D37](decisions.md#d37--events-carry-a-resolve-by-date-overdue-is-derived-and-swept-to-admins))
- Five new screens — Events, Create, Event detail, Resolve, Admin events — plus a sixth bottom
  tab, and updates to the bet slip (currency-aware, refuses to mix kinds), Standings (a credits
  leaderboard), Me, and My Bets

**Subsystem 4 — peer-to-peer bets:**

- `p2p_wagers`, a table owning its own lifecycle — six statuses, with **disputed and overdue
  derived** from the claim columns and the clock rather than stored
  ([D44](decisions.md#d44--dispute-and-overdue-are-derived-predicates-not-stored-statuses))
- Wagers staked in credits only, market-backed or freeform, with two explicit stakes and no
  price ([D40](decisions.md#d40--every-peer-to-peer-wager-moves-credits-including-the-market-backed-kind),
  [D41](decisions.md#d41--a-wager-is-two-explicit-stakes-not-a-stake-and-a-price))
- Escrow at offer rather than at acceptance, so a live offer is always good
  ([D46](decisions.md#d46--the-offerers-stake-escrows-at-offer-not-at-acceptance)), with three
  new ledger entry types and one nullable column — `bets` and `settleGame` untouched
  ([D42](decisions.md#d42--a-wager-is-its-own-table-not-two-bets-and-not-a-two-person-custom-event))
- Market-backed settlement from the existing pure graders, riding the `settle` cron beside the
  overdue-event sweep; freeform settlement when both parties agree, with admin arbitration when
  they do not ([D47](decisions.md#d47--a-freeform-wager-is-settled-by-both-parties-agreeing-with-admins-as-the-fallback))
- `reconcileEscrow`, a second daily check: balance reconciliation is blind to credits sitting
  in a pot, and a wager that escrowed and never paid out is exactly the bug it cannot see
  ([D43](decisions.md#d43--escrow-needs-its-own-reconciliation-check-balance-reconciliation-cannot-see-it))
- Head-to-head records, defined at last as the peer-to-peer record and nothing else
  ([D48](decisions.md#d48--head-to-head-is-the-peer-to-peer-record-and-nothing-else)), derived
  at read time with no stored counter
- Four screens — the wagers board, the offer form, wager detail, and the admin arbitration
  queue — reached from a Bets \| Wagers control on `/bets` rather than a seventh bottom tab

### What is left

Every open item from [the roadmap](roadmap.md#roadmap) and
[repo health](repo-health.md#status-at-a-glance), by who can finish it.

#### What a cloud session can pick up now

| Item                                                                                   | Source        |
| -------------------------------------------------------------------------------------- | ------------- |
| Uncomment the three cron `schedule:` lines                                             | repo health 3 |
| Add `format:check` to `verify` and CI                                                  | repo health 6 |
| Phase 6's `[CLOUD]` half — the run record, alerting, Sentry, and the two admin screens | roadmap 6     |
| 7c component work — `Dialog`, `Sheet`, `Table`, `Toast`, `Card`'s element escape hatch | roadmap 7c    |
| 7c layout fixes from the mobile audit                                                  | roadmap 7c    |
| 7d craft — motion, accessibility, a dark-mode toggle                                   | roadmap 7d    |
| Rate limiting, house rules page, the new-member path                                   | roadmap 9     |

Rows 3 and 6 above are `[CLOUD]` work that is currently blocked, not ready to pick up — see
their "Blocked on" column in [repo health's Outstanding table](repo-health.md#outstanding).

#### What needs a desktop with Docker

| Item                                          | Source        |
| --------------------------------------------- | ------------- |
| Verify the `session-start` hook's Docker path | repo health 4 |
| Load sanity at real row counts                | roadmap 9     |

#### What needs Noah

| Item                                                                                               | Source        |
| -------------------------------------------------------------------------------------------------- | ------------- |
| `APP_URL` and `CRON_SECRET` as Actions secrets — **the app is not settling bets until this lands** | repo health 1 |
| Dispatch both cron jobs by hand, confirm 200                                                       | repo health 2 |
| Reconcile the unpushed ESPN adapter against the merged Prettier reformat                           | repo health 5 |
| Hosted Postgres, Sentry signup, alerting destination                                               | roadmap 6     |
| Email provider signup and sending-domain DNS                                                       | roadmap 8     |

#### What needs a person, either of you

| Item                                          | Source        |
| --------------------------------------------- | ------------- |
| **The human test pass** — the gate on phase 5 | both          |
| Merging Dependabot's monthly PR               | repo health 7 |
| ESLint 10 / TypeScript 7 — blocked upstream   | repo health 8 |
| Confirming a real email renders               | roadmap 8     |

## Conventions

- Design documents live in `specs/`, dated and named by topic.
- Decisions get an entry in `decisions.md`. When one turns out to be wrong, add a new entry
  rather than editing the old one.
- Roadmap items graduate into their own spec when their turn comes.
- Every document here appears in the table above. A spec, plan, or audit that exists but is not
  listed is invisible — 7a's three were, until 7b's session noticed.
- **A phase that declines work records where the work went.** The roadmap carries the owning
  rung's backlog; the spec carries the reasoning. Nothing is dropped by omission.
- **Completed roadmap items live in the master table with their reference links, not as body
  sections.** The spec is the authority on what a subsystem does and `decisions.md` on why; a
  third summary in the roadmap only drifts from both.
- **A plan whose work has shipped moves to `archive/plans/`.** It stays listed here so it does
  not become invisible.
