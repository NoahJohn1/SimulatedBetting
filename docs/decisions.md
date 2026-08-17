# Decision log

Decisions made during the 2026-08-14 design session, with what was rejected and why.
When a decision here turns out to be wrong, add a new entry rather than editing the old one.

---

### D1 — Scope: build the betting engine first, in full

The project is four subsystems (engine, social, custom events, P2P). V1 is the complete
engine — both sports, all main bet types, real settlement — not a thin slice.

*Rejected:* a moneyline-only NFL slice. It would have felt like a toy and required
reworking the bet/leg model as soon as parlays arrived.

---

### D2 — Odds: build against fixtures, integrate a real provider later

An `OddsProvider` interface with a fixture-backed implementation for v1. The first real
adapter targets The Odds API.

*Rejected:* wiring a live feed immediately. Fixtures make settlement tests deterministic
and let the engine be finished before the integration is fought.

*Also rejected:* scraping ESPN Bet or Underdog. Neither has a public API, scraping violates
their terms, and the markup changes constantly. The Odds API aggregates those same books
legitimately.

---

### D3 — Stack: single Next.js app on Postgres

Next.js (App Router) + TypeScript + Drizzle + Postgres, deployed on Vercel, with cron
routes for background work.

*Rejected:* a separate worker service — right answer only if live in-game betting is
coming, which it isn't in v1. *Rejected:* Supabase RLS as the backend — ledger integrity is
transactional business logic, and expressing it in row-level security policies is awkward
and easy to get subtly wrong.

*Consequence to watch:* Vercel cron invocations are time-limited, so settlement batches and
must be resumable.

---

### D4 — Economy: seasons, equal start, weekly allowance, admin adjustments, hard ledger

Every member starts a season with the same bankroll, receives an automatic weekly
allowance, and an admin can grant or remove funds. Every movement is logged.

*Rejected:* a persistent never-resetting bankroll (one settlement bug wipes someone out
permanently) and self-serve resets (no competitive integrity).

---

### D5 — Balance: immutable ledger plus a cached balance

The ledger is truth. `balance_cents` is a cache updated in the same transaction as its
entry, with a daily reconciliation job asserting they agree.

*Rejected:* computing balance from `SUM(ledger)` on every read — drift-proof but pays a
growing cost on every page load. The reconciliation job recovers that guarantee.

---

### D6 — Bet types: singles and parlays

Moneyline, spread, and total as singles, plus multi-leg parlays.

*Rejected:* props (needs a second stats integration for settlement), teasers, and live
betting (needs continuous polling). Parlays were included from day one specifically because
retrofitting them into a single-outcome bet model is painful.

---

### D7 — Auth: Google / Apple sign-in with admin approval

OAuth only, no passwords. First-time sign-ins land in `PENDING` and an admin approves them.

*Rejected:* invite codes (an extra flow to build and share) and open signup (OAuth alone
would let anyone with a Google account in, which is why the approval gate exists).

---

### D8 — Layout: sportsbook-first

The app opens to the odds board with a four-tab bottom bar. The social feed becomes its own
tab in subsystem 2.

*Rejected:* a feed-first home (costs a tap to place a bet) and swipeable one-game-at-a-time
cards (unusable against a 60-game Saturday CFB slate).

---

### D9 — Lines: one house line per market

A single designated book is the source of truth for each market; everyone bets the same
number. `source_book` is recorded, so multi-book line shopping remains addable later.

*Rejected:* multi-book shopping (makes standings partly a function of shopping effort),
best-available auto-selection, and a consensus average (a line that exists nowhere in
reality).

---

### D10 — Legs freeze their line and price at placement

`bet_legs` stores `line_at_placement` and `price_at_placement`. Line movement after
placement never changes a placed bet.

This is the most important correctness property in the system and the reason grading can be
a pure function of stored values.

---

### D11 — Bets reference selections, never games

The betting and money paths never touch the `games` table directly. This is what allows
custom events (subsystem 3) to be added without modifying the ledger or grading engine.

---

### D12 — Pushed and voided parlay legs are removed, not fatal

A three-leg parlay with one push pays as a two-leg parlay. Matches real sportsbook
behavior, and falls out naturally from storing legs as their own rows.

---

### D13 — No same-game parlay legs, max 10 legs

Same-game legs are correlated; paying them at independent odds is free money. Real books
price same-game parlays separately, which v1 does not attempt.

---

### D14 — Line movement between slip and placement is rejected, not absorbed

If a line moved while the slip was open, the request fails with the new price and the member
re-confirms.

*Rejected:* silently placing at the new number. Showing one price and charging another is
never acceptable, even with play money.

---

### D15 — Corrections write reversing entries; history is never edited

Re-settling a bet writes `SETTLEMENT_REVERSAL` entries and then the correct ones.

The ledger only grows, and it can always be replayed to explain a balance — including the
mistakes.

---

### D16 — Every member sees their own full ledger

The transaction history is the "Me" tab, not an admin-only view. Admin adjustments appear
there with their mandatory notes.

If an admin takes money off someone, that person sees it and sees why.

---

### D17 — All money is integer cents

`BIGINT` cents everywhere; payouts computed with exact rational arithmetic on BigInt and
rounded half-up exactly once, at the end.

No floating-point value touches a balance. Rounding never happens per parlay leg.

---

### D18 — Primary keys are UUIDv4, not UUIDv7

*Added 2026-08-15 during implementation planning.*

The spec called for time-sortable UUIDv7. Postgres 16 has no native `uuidv7()`, and pulling in
a dependency solely to generate primary keys is not worth it.

Every table carries `created_at`, which is what ordering actually uses. Revisit if the project
moves to Postgres 18, which has `uuidv7()` built in.

---

### D19 — No maximum bet, no cash-out

Bet size is limited only by balance. There is no early cash-out.

A max-bet cap is a rule that would need tuning; cash-out requires live odds that v1 does not
have.

---

### D20 — Auth: Google only, Apple dropped

*Added 2026-08-17.*

Supersedes the Apple half of [D7](#d7--auth-google--apple-sign-in-with-admin-approval). The
group all signs in with Google; Apple sign-in added a second OAuth integration and a second
set of credentials to provision for no member who'd use it. `auth_provider` is now a
single-value enum (`GOOGLE`), migrated with `drizzle/0003_drop-apple-auth-provider.sql`.

Identity is still keyed on `(provider, provider_account_id)` rather than email, so adding a
provider back later is additive — a second enum value and a second `next-auth` provider
entry, no redesign.

---

### D21 — No social graph; the season is the graph

*Added 2026-08-17 during the subsystem 2 design session.*

Supersedes the "friend or follow graph" sketched in [the roadmap](roadmap.md#2-social-layer).
Season membership defines who can see whom. There is no follow, no friend request, no accept.

Every member is already admin-approved into a small private league, so a graph would mostly
reproduce the season roster with extra screens — plus a cold-start problem where a new
member's feed is empty until they follow someone. If the group ever outgrows one shared feed,
a graph is additive: a `follows` table and a read-time filter, no redesign.

---

### D22 — Bets are public the moment they are placed

Feed cards appear at placement, not at kickoff and not at settlement.

Standings already publish everyone's exact balance, so stakes were never really private.
Visible-at-placement is what makes the feed worth opening — live sweating, and no quietly
burying a bad take. Copying somebody's pick ("tailing") is treated as a feature.

*Rejected:* hidden-until-kickoff, which needs a reveal-time concept (a `visible_at` column and
either a job or a read filter, with parlays revealing on their earliest kickoff) to solve a
copying problem this group does not have. *Rejected:* settled-only, which turns the feed into
a results log.

---

### D23 — `feed_events` is a materialized, append-only table written in the source transaction

Each event is a real row with a real id, emitted by `emitFeedEvent(tx, …)` from inside the
transaction that caused it, carrying a deterministic unique `dedupe_key`.

A real id is what lets reactions and comments be plain foreign keys. A single table is what
makes pagination one indexed keyset query and per-viewer type filters a `WHERE type = ANY(…)`.

*Rejected:* deriving the feed at read time from a `UNION` over `bets`, `ledger_entries` and
`season_memberships`. Drift-proof and needs no backfill, but a synthetic union row has no
durable id to attach a reaction to, keyset pagination across a five-way union with per-viewer
filters is unmaintainable, and milestones cannot be expressed at all.

*Rejected:* a cron feed-builder scanning for new rows since a cursor. It keeps the money core
untouched, but the cheapest interval is minutes, which contradicts [D22](#d22--bets-are-public-the-moment-they-are-placed),
and it adds a cursor that can get stuck.

*Accepted cost:* a bug in payload construction can now reject a bet. The insert itself is one
`INSERT … ON CONFLICT DO NOTHING` with no joins and no computation, so the only way it fails
is a database that is down — in which case the bet should not commit either. This is the same
argument [D5](#d5--balance-immutable-ledger-plus-a-cached-balance) already makes for the ledger.

---

### D24 — Admin adjustments are published to the season feed

Extends [D16](#d16--every-member-sees-their-own-full-ledger). An `ADMIN_CREDIT` or
`ADMIN_DEBIT` posts an `ADMIN_ADJUSTMENT` card to the whole season, carrying the amount and
the mandatory note.

D16's reasoning was that if an admin moves your money, you see it and see why. The same
reasoning applied to the group is stronger: an admin cannot quietly gift anyone, because the
league watches every adjustment land. The note field was already mandatory and already visible
to the affected member; this widens the audience, not the disclosure.

*Consequence to watch:* notes are now written for an audience. That is intended.

---

### D25 — Money inside a feed payload is a decimal string

`stakeCents`, `payoutCents` and every other amount in a `feed_events.payload` is stored as a
decimal string (`"95450"`), never a JSON number.

`JSON.stringify` throws on a `bigint`, and a `number` silently loses precision past 2^53.
A string round-trips through `BigInt()` exactly, which keeps
[D17](#d17--all-money-is-integer-cents) true inside jsonb as well as in columns. Display-only
ratios (a big win's multiple) are integer basis points for the same reason.

---

### D26 — Allowance posts one aggregated card per week

`payWeeklyAllowance` emits a single `ALLOWANCE_PAID` event per season per ISO week
(`allowance:<seasonId>:<weekKey>`), carrying the credited member count — not one card per
member.

Twelve members would otherwise produce twelve identical cards every Tuesday, which buries
everything anyone actually wants to read. It is the only event type with no subject member.

---

### D27 — Head-to-head is deferred to subsystem 4

Nobody bets *against* anybody until peer-to-peer bets exist, so "head-to-head record" has no
unambiguous meaning yet. Subsystem 2 ships member profiles with season statistics instead.

*Rejected for now:* scoring opposed positions on the same market (two members on either side
of one line) as a matchup. It is the only genuine head-to-head available pre-P2P and it is
appealing, but it is sparse in a small league and subsystem 4 may well redefine the metric.
Defining it twice is worse than defining it once, late.

---

### D28 — Reactions hard-delete, comments soft-delete

Removing a reaction deletes the row. Deleting a comment sets `deleted_at` and
`deleted_by_user_id`, keeps the row, and renders as "Comment removed".

A reaction has no history worth keeping. A comment does: the thread keeps its shape, and there
is a record of whether the author or an admin removed it — the same instinct as
[D15](#d15--corrections-write-reversing-entries-history-is-never-edited).

*Rejected:* a report queue and a hidden state. In a league where everyone knows each other,
the admin *is* the moderation system, and a queue is machinery that never runs.

---

### D29 — No real-time transport in v1

The feed loads fresh on navigation and paginates through a server action. No websockets, no
SSE, no polling interval, no unread badge.

A five-person league checking the app after a game does not need a socket, and every real-time
option adds either a connection to manage or a request every few seconds forever. Pull-to-refresh
is the browser's job.

---

### D30 — Correlated subqueries in Drizzle need literal, qualified identifiers

*Added 2026-08-17 during subsystem 2 implementation.*

`src/server/feed/stats.ts` sums a bet's ledger entries with a correlated subquery. The first
version wrote it the way every other query in this codebase writes SQL — interpolating
`${table.column}` inside a `sql` template:

```ts
sql`... WHERE ${ledgerEntries.betId} = ${bets.id} ...`
```

This is silently wrong. Drizzle renders `${table.column}` as a bare, unqualified column name
inside a raw `sql` fragment — it does not know the fragment is a subquery correlated against
an outer table it can't see. Both sides of the comparison resolved against the subquery's own
`FROM ledger_entries`, so the WHERE clause became `ledger_entries.bet_id =
ledger_entries.id` — never true — and every settled bet's profile silently read back a $0
payout. `npm run verify` did not catch it: the query executes without error and returns a
type-correct empty sum. It surfaced only because `getMemberProfile`'s own test
(`src/server/feed/__tests__/stats.test.ts`) asserted the actual `netCents` value on a known
win rather than just checking the query didn't throw.

The fix is to write the subquery with literal, table-qualified identifiers instead of
drizzle's column helpers:

```ts
sql`... FROM ledger_entries WHERE ledger_entries.bet_id = bets.id ...`
```

*Consequence to watch:* any future correlated subquery in this codebase needs the same
treatment — reach for `${table.column}` only when both sides of a comparison live in the
query's known `FROM`/`JOIN` graph, never inside a subquery correlating against an outer table.
