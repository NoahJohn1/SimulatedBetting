# SimulatedBetting — documentation

A play-money sportsbook for a small private group. NFL and college football, real
sportsbook lines, simulated currency. No real money is involved at any point.

## Documents

| Document | What's in it |
|---|---|
| [Core betting engine spec](specs/2026-08-14-core-betting-engine-design.md) | The v1 build: architecture, data model, odds math, grading rules, jobs, failure handling, screens, testing |
| [Social layer spec](specs/2026-08-17-social-layer-design.md) | Subsystem 2: the season activity feed, reactions and comments, member profiles, per-viewer feed filters |
| [Social layer plan](plans/2026-08-17-social-layer-implementation-plan.md) | The task-by-task implementation plan for subsystem 2 |
| [Custom events spec](specs/2026-08-17-custom-events-design.md) | Subsystem 3: member-created markets, the credits currency, human resolution and disputes |
| [Custom events plan](plans/2026-08-17-custom-events-implementation-plan.md) | The task-by-task implementation plan for subsystem 3 |
| [Peer-to-peer bets spec](specs/2026-08-19-peer-to-peer-bets-design.md) | Subsystem 4: member-vs-member wagers, escrow, two-party resolution, admin arbitration, head-to-head |
| [Peer-to-peer bets plan](plans/2026-08-19-peer-to-peer-bets-implementation-plan.md) | The task-by-task implementation plan for subsystem 4 |
| [Roadmap](roadmap.md) | The four subsystems, what each adds, and build order |
| [Decision log](decisions.md) | Every design decision, what was rejected, and why |

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

Subsystems 1, 2, and 3 are built end-to-end and verified: `npm run verify` (typecheck, lint,
58 test files / 401 tests) passes clean, and the app runs, seeds a fixture slate, takes a bet
through placement and settlement (including a push), reconciles the ledger correctly in both
currencies, and posts and reads back the feed cards those actions generate — including a
custom event carried from creation through a disputed resolution and an admin correction.

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

Not built: a real odds provider adapter (still fixture-only — see [D2](decisions.md)) and
production deployment/hosted Postgres wiring. Subsystem 4 (peer-to-peer bets) is
[designed and planned](specs/2026-08-19-peer-to-peer-bets-design.md) but not yet implemented.

## Conventions

- Design documents live in `specs/`, dated and named by topic.
- Decisions get an entry in `decisions.md`. When one turns out to be wrong, add a new entry
  rather than editing the old one.
- Roadmap items graduate into their own spec when their turn comes.
