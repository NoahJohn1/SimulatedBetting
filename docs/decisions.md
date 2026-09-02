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

Supersedes the "friend or follow graph" sketched in [the roadmap](roadmap.md#roadmap).
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

---

### D31 — Custom events are bet in credits, a second non-convertible currency

*Added 2026-08-17 during the subsystem 3 design session.*

Custom events are bet with **credits**, a second currency granted at season join and dripped
weekly alongside the cash allowance. Credits never convert to cash and cash never converts to
credits — there is no exchange rate, no admin override, and no one-way purchase.

Hand-priced markets resolved by a person are a fundamentally different game from real
sportsbook lines graded by a score feed. Mixing the two economies would mean a mispriced
Rainbow Six market is a way to print bankroll, and the standings would stop measuring
handicapping. Sealing credits off is what makes "anyone can create an event"
([D32](#d32--anyone-can-create-events-and-creators-may-bet-their-own-with-disclosure)) safe
enough to say yes to.

*Rejected:* buying credits with cash, one-way. It ties the economies together — the cash leader
dominates custom markets — and permanently drains bankroll out of the standings. *Rejected:*
full convertibility, which makes credits a relabeled dollar and defeats the entire purpose.

*Falls out for free:* a bet carries one stake in one currency, so a parlay mixing a game leg
with a custom leg is impossible by construction. No rule needed — the money model enforces it.

---

### D32 — Anyone can create events, and creators may bet their own, with disclosure

Any approved member creates events and resolves their own. A creator may also bet on the event
they will resolve, and every place that bet appears — feed card, event page, profile — labels
it as the creator's.

Restricting creation to admins would make an admin the bottleneck on the most social feature in
the app. The conflict of interest is real, and the answer is visibility rather than prohibition:
in a league where everyone knows each other, a creator who prices soft and rules for himself is
doing it in front of an audience, with an admin able to reverse it
([D35](#d35--custom-events-pay-on-resolution-disputes-are-an-admin-re-resolution)).

*Rejected:* barring creators from their own events — it excludes the person most interested in
the market. *Rejected:* a creator who bets forfeits resolution rights, which gives one event two
possible resolution paths and a rule members must learn.

---

### D33 — `events` is a true supertype, not a pair of nullable foreign keys

A new `events` table (`id`, `kind`, `title`, `starts_at`) becomes what `markets` points at.
`games` becomes a subtype with a unique `event_id`; `custom_events` is its sibling. One
migration backfills an event row per existing game and drops `markets.game_id`.

`events` carries no status column — each subtype owns its lifecycle, so no polymorphic status
can be read wrong or drift out of agreement with its subtype.

*Rejected:* nullable `game_id` + `custom_event_id` on `markets` with a CHECK that exactly one is
set. It needs no backfill, but it puts two LEFT JOINs and a coalesce into every polymorphic
query and moves an invariant out of the type system into a constraint. [D30](#d30--correlated-subqueries-in-drizzle-need-literal-qualified-identifiers)
is a live reminder of what a subtly wrong join costs in this codebase.

*Rejected:* parallel `custom_markets` / `custom_selections` tables with their own settlement
path. Zero risk to subsystem 1, but it abandons [D11](#d11--bets-reference-selections-never-games)
— whose entire purpose was making this moment cheap — and writes every future feature twice.

---

### D34 — Currency is a dimension on the existing ledger, not a second ledger

`ledger_entries.currency` (`CASH` | `CREDITS`, existing rows backfilled `CASH`), a second cached
balance column on `season_memberships`, and per-currency reconciliation. `postEntry` takes a
currency and updates the matching cache.

**No new entry types.** `BET_PLACED`, `BET_WON`, `WEEKLY_ALLOWANCE` and the rest mean exactly
the same thing in either denomination; doubling the enum would say nothing new.
[D5](#d5--balance-immutable-ledger-plus-a-cached-balance)'s "the ledger is truth" stays one
invariant over two denominations.

*Rejected:* a parallel `credit_ledger_entries` table. It proves a credits bug cannot touch cash,
but it clones `postEntry`, reconciliation, the allowance job and the transaction history screen
— and the clone is where the drift will be.

---

### D35 — Custom events pay on resolution; disputes are an admin re-resolution

The creator resolves and winners are paid immediately. A member who disagrees files a dispute
(one per member per event, with a reason); an admin re-resolves with a mandatory note, which
reverses the previous payout and posts the corrected one.

This is [D15](#d15--corrections-write-reversing-entries-history-is-never-edited) reused whole:
`resolution_attempts` plays the role `settlement_attempts` already plays, so a correction can
never collide with the original. No new money concept enters the system.

*Rejected:* a 24-hour challenge window before payout. Nobody is ever paid on a wrong resolution,
but it adds a held state, a cron sweep to finalize, and a day of delay on every event — to
prevent something the reversal path already fixes. *Rejected:* mandatory admin confirmation on
every resolution, which undoes [D32](#d32--anyone-can-create-events-and-creators-may-bet-their-own-with-disclosure).

---

### D36 — One custom market shape: N-way pick-the-winner

A custom market is a question plus two or more labelled, hand-priced outcomes, exactly one of
which wins. `market_type` gains `CUSTOM_OUTCOME`; `selections.side` becomes nullable and gains a
`label`.

A stat line is expressible as a two-outcome market in words ("Over 24.5 kills" / "Under 24.5
kills"), which costs a creator nothing and saves the system a second grading path plus a numeric
result-entry UI.

*Rejected:* a real numeric total for custom events — creators would enter results as well as
winners, doubling the resolution surface for a shape the N-way form already covers.
*Rejected:* full parity with sports markets, which forces a tournament bracket into a two-sided
home/away frame it is not.

---

### D37 — Events carry a resolve-by date; overdue is derived and swept to admins

Every custom event has a `resolves_by`. The existing `settle` cron sweeps for `OPEN` events past
it and emits one `CUSTOM_EVENT_OVERDUE` feed card per event. An admin then resolves it or voids
it, refunding every stake through the path a postponed game already takes.

Overdue is **derived** (`status = 'OPEN' AND resolves_by < now()`), never stored — a stored flag
is a third state that can disagree with the clock and needs a job to maintain. The sweep rides
in an existing cron route with no cursor, for the same reason lead-change detection does.

*Rejected:* auto-voiding after a grace period. It guarantees credits are never locked forever,
but it is a job that moves money because a date passed, and it will eventually void an event
that needed one more day. *Rejected:* no deadline at all, where nothing surfaces a forgotten
event and stale credits accumulate quietly.

---

### D38 — No exposure cap on hand-priced markets

There is no limit on how many credits can ride on a member-priced market, and no validation of
whether a creator's book adds to more than 100%. The create screen shows implied probability as
information; it does not block.

The roadmap flagged badly priced markets as a risk worth capping. Once credits are sealed off
from cash ([D31](#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency)), a
mispriced market can only redistribute credits — which is the point of splitting the currency.
This follows [D19](#d19--no-maximum-bet-no-cash-out): a cap is a rule that would need tuning,
and nothing yet says which number it should be.

---

### D39 — Editing an event reuses `CreateEventError`'s `INVALID_PRICE` shape

*Added 2026-08-18 during subsystem 3 implementation.*

`editCustomEvent`'s `ManageError` union, as the plan specified it, had no case for a bad price:
`EVENT_NOT_FOUND | MARKET_NOT_FOUND | NOT_AUTHORIZED | EVENT_NOT_OPEN | EVENT_HAS_BETS`. But
editing re-validates every submitted price the same way creation does
([D36](#d36--one-custom-market-shape-n-way-pick-the-winner)), and an invalid one needs
somewhere to land. `ManageError` gained `INVALID_PRICE; marketIndex; outcomeIndex`, shaped
identically to `CreateEventError`'s case of the same name, so the edit form can point at the
same field either way without a second error-rendering path.

*Rejected:* rejecting the edit generically (`EVENT_NOT_OPEN` or a bare validation failure) and
letting the client re-derive which outcome was bad. It throws away information the validator
already has, for no reason beyond the union having been written before this case was found.
*Rejected:* a distinct `EDIT_INVALID_PRICE` code. Nothing about the failure differs by which
screen triggered it, and a second name for the same shape is a rename with no meaning attached.

---

### D40 — Every peer-to-peer wager moves credits, including the market-backed kind

*Added 2026-08-19 during the subsystem 4 design session.*

All peer-to-peer wagers are staked in **credits**, never cash — a wager on Sunday's Chiefs game
just as much as a wager on whether Jake can name ten quarterbacks.

[D31](#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency) split the
currency so that a market priced or resolved by a person could never move the bankroll the
standings rank. A two-person wager is that same situation with a smaller audience: its terms are
set by hand, and most of its resolution paths end in a human being deciding. Putting all of it
on the credits side of the wall means subsystem 4 cannot touch cash through *any* path, which
makes the whole subsystem safe to reason about by construction rather than by audit.

*Rejected:* deriving the currency from what settles the wager — cash for a game-backed wager
graded by the score feed, credits for anything a person calls. It is the more principled reading
of D31 and it would put head-to-head into the cash standings, where it would mean more. But it
makes an escrow path that touches cash, and then the guarantee is only as good as the branch
that chose the currency. The version with no cash branch at all is the one that cannot be got
wrong.

*Rejected:* cash for everything, which drives a hole straight through D31 — two members agree, one
arbitrates, and cash moves on human say-so.

*Consequence accepted:* a wager on a real game settles from the same score feed as the house bet
beside it, in a different denomination. That is genuinely arbitrary from a member's point of
view, and it is the price of the guarantee.

---

### D41 — A wager is two explicit stakes, not a stake and a price

*Added 2026-08-19 during the subsystem 4 design session.*

The offerer names both numbers: "500 credits against your 200." The pot is the sum and the
winner takes all of it. There is no price, no odds, and nothing to freeze but the line.

A handshake bet *is* two integers. Storing it as one stake plus an American price would borrow a
book's vocabulary for something with no book behind it, and would introduce rounding on a
two-party pot where [D17](#d17--all-money-is-integer-cents) demands every cent be accounted for.
Implied odds are still shown — they are derivable from the two numbers and never stored.

*Rejected:* even money only. Simplest of all, but "I'll give you 3-to-1 that he can't" is half of
why anyone makes a bet like this, and it would be inexpressible.

---

### D42 — A wager is its own table, not two bets and not a two-person custom event

*Added 2026-08-19 during the subsystem 4 design session.*

`p2p_wagers` owns its own lifecycle. It reuses `postEntry`, `emitFeedEvent`, `gradeLeg` and
`gradeCustomLeg` — the *machinery* — while sharing no table with `bets`.

This is the distinction [D33](#d33--events-is-a-true-supertype-not-a-pair-of-nullable-foreign-keys)
already drew: share the mechanism, not the shape. The practical payoff is that `bets`,
`bet_legs`, `placeBet`, `settleGame` and `resettleBet` are untouched by this subsystem, so it
cannot regress the money paths subsystems 1 and 3 stand on.

*Rejected:* two rows in `bets` joined by a link table. It appears to buy My Bets, settlement and
grading for free, but `bets` carries `potential_payout_cents` and `combined_price_american` and
there is no price here ([D41](#d41--a-wager-is-two-explicit-stakes-not-a-stake-and-a-price)) —
those columns would hold lies. Worse, `settleGame`'s pending-leg sweep would find these legs and
try to pay them from the house's side, so every existing money query would need a "and not a P2P
leg" clause forever.

*Rejected:* a wager as a two-outcome custom event with exactly two bets. Maximum reuse of
subsystem 3, but a custom event has a creator who resolves it, N markets and open betting by
anyone — a 1v1 wager has none of the three, and creator-resolution is precisely the model
[D47](#d47--a-freeform-wager-is-settled-by-both-parties-agreeing-with-admins-as-the-fallback)
rejects for P2P. Every custom-events query would then need to filter these out.

---

### D43 — Escrow needs its own reconciliation check; balance reconciliation cannot see it

*Added 2026-08-19 during the subsystem 4 design session.*

A second check, `reconcileEscrow`, runs beside `reconcileBalances` in the existing `reconcile`
cron. For every wager it asserts that the credits the ledger has locked against it match what its
status says should be locked: one stake while `OFFERED`, both while `ACCEPTED`, none once it has
ended.

Until this subsystem, every credit sat in exactly one member's balance at every instant, and
[D5](#d5--balance-immutable-ledger-plus-a-cached-balance)'s reconciliation proved it. Escrow
breaks that: credits in a live pot have left a balance and arrived nowhere. `reconcileBalances`
stays correct — each member's cache and ledger sum still agree, both net of escrow — but it can
no longer see whether the system total is conserved. A wager that escrowed and never paid out is
invisible to it, and that is the exact bug most worth catching.

*Rejected:* leaving reconciliation as-is. It would still pass every day while credits leaked, which
is worse than having no check, because the green result would be read as proof.

*Rejected:* a stored `escrow_balance_cents` cache on `season_memberships`. It is a third number to
keep in agreement with two others, and the thing it would be reconciled against is the sum this
check already computes directly.

---

### D44 — Dispute and overdue are derived predicates, not stored statuses

*Added 2026-08-19 during the subsystem 4 design session.*

`p2p_wager_status` has six values — `OFFERED`, `ACCEPTED`, `SETTLED`, `VOIDED`, `CANCELED`,
`EXPIRED` — and neither `DISPUTED` nor `OVERDUE` is among them. Both are predicates over an
`ACCEPTED` row: disputed is *both claims set and unequal*, overdue is *past `resolves_by` with no
agreed verdict*. The admin queue queries them; nothing writes them.

This generalizes [D37](#d37--events-carry-a-resolve-by-date-overdue-is-derived-and-swept-to-admins)
from one case to a rule. A stored flag is a third state that can disagree with the columns it
summarizes, and it needs a job to maintain. Here it would be worse than in D37's case: a stored
`DISPUTED` could survive a party revising their claim, leaving a wager permanently in an admin
queue it no longer belongs in.

*Rejected:* a `DISPUTED` status set by `claimWinner`. It reads more explicitly at the call site and
makes the queue a trivial equality filter — at the cost of a state that can lie about the two
columns sitting next to it.

---

### D45 — Void is an arbitration verdict and an automatic consequence, never a standing admin power

*Added 2026-08-19 during the subsystem 4 design session.*

Credits are returned to both parties in exactly three situations: an admin who is *already
arbitrating* a disputed or overdue wager returns `VOID` as one of three verdicts; the underlying
game is canceled or postponed, or the underlying custom event is voided; or both parties agree to
cancel. There is no admin control that voids a healthy wager.

A void is unwinding an agreement between two consenting members, so it should exist only where a
winner genuinely does not — not as a general override. The automatic cases need no judgment at
all: they are the path a postponed game already takes for a house bet
([D12](#d12--pushed-and-voided-parlay-legs-are-removed-not-fatal)), reached from a different
trigger.

*Rejected:* a broad admin void at any stage, mirroring `voidCustomEvent`. A custom event is a
market the whole season is exposed to, which is why an admin holds a standing power over it; a
wager is a private agreement between two people who can already cancel it by agreeing.

*Rejected:* no void verdict at all, forcing every arbitration to name a winner. It is the tightest
rule, but "we genuinely both misremember what we said" is a real outcome, and refunding is the
fair call for it.

---

### D46 — The offerer's stake escrows at offer, not at acceptance

*Added 2026-08-19 during the subsystem 4 design session.*

Posting an offer escrows the offerer's stake immediately. Accepting escrows the acceptor's. An
unaccepted offer refunds on cancellation or expiry.

[The roadmap](roadmap.md#roadmap) assumed both stakes escrow at acceptance, and that
was right for the model it had in mind — a directed challenge, accepted or not. It stops being
right once an offer can sit open to the season: an offerer with 1,000 credits could post five
1,000-credit offers, four of which are promises they cannot keep. Escrowing at offer makes a live
offer *always good* — acceptance can never fail on the offerer's balance — and it makes the
refund path a first-class part of the design rather than an edge case, which it has to be anyway
for expiry.

*Rejected:* both at acceptance, per the roadmap. Offers cost nothing to make and nothing to
abandon, but a member can tap Accept on a live offer and be told no. With open offers, that will
happen.

*Rejected:* no escrow, settling from balances at the end. The loser can be broke by then, and a
wager the ledger cannot honor is the failure escrow exists to prevent.

---

### D47 — A freeform wager is settled by both parties agreeing, with admins as the fallback

*Added 2026-08-19 during the subsystem 4 design session.*

Each party names who won. Agreement settles the wager immediately. Disagreement makes it disputed;
silence past the resolve-by date makes it overdue; both land in the admin queue, where an admin
returns a verdict with a mandatory note.

A wager is symmetric, so its resolution should be. This is the one place subsystem 4 deliberately
does *not* copy subsystem 3: a custom-event creator resolves unilaterally
([D35](#d35--custom-events-pay-on-resolution-disputes-are-an-admin-re-resolution)) because they
are a market-maker acting in front of an audience, and
[D32](#d32--anyone-can-create-events-and-creators-may-bet-their-own-with-disclosure) accepted that
conflict of interest in exchange for visibility. A P2P offerer is not a market-maker — they are one
of the two people whose credits are at stake — and letting one side of a two-person bet call the
result is a different proposition entirely.

`VOID` is a legitimate claim, so two members who agree the bet was unresolvable can settle it as a
mutual refund without ever involving an admin.

*Rejected:* the offerer resolves and the counterparty disputes, mirroring D35 exactly. Maximum
reuse, wrong incentives.

*Rejected:* an admin resolves every freeform wager. Impossible to game, and it makes an admin the
bottleneck on every casual bet in a league where most of them are ones both parties already agree
about.

---

### D48 — Head-to-head is the peer-to-peer record, and nothing else

*Added 2026-08-19 during the subsystem 4 design session.*

Between any two members: wagers settled, won, lost, voided, and net credits. Derived at read time
from `p2p_wagers` by a pure `computeHeadToHead`, with no stored counter.

This closes [D27](#d27--head-to-head-is-deferred-to-subsystem-4), which deferred the metric here
on the grounds that it had no unambiguous meaning until members could bet against each other.
They now can, and the meaning is the obvious one.

*Rejected:* also scoring opposed positions on the same house line, which D27 had floated. It would
produce a record even between members who have never wagered directly — but it makes one number
out of two unrelated things, and D27 anticipated exactly this by preferring to define the metric
once, late.

*Rejected:* a materialized record table. It is a counter that can drift from the rows it
summarizes, for a query over a table that will hold hundreds of rows, not millions — the same
reasoning subsystem 2 applied to `computeMemberStats`.

---

### D49 — ESPN's public JSON is the odds and score source, superseding D2

*Added 2026-08-20 during the production-readiness roadmap session.*

Both providers read ESPN's public JSON endpoints: the scoreboard for slates and final scores,
and the per-book odds endpoint for lines. Free, unmetered, no API key, no account.

This supersedes the second half of [D2](#d2--odds-build-against-fixtures-integrate-a-real-provider-later),
which named The Odds API as the first real adapter. The interface half of D2 stands and is
exactly why this costs so little — `OddsProvider` and `ScoreProvider` never encoded a vendor.

*Rejected:* The Odds API on its free tier. 500 credits a month against a `*/15` sync across two
sports and three markets, which costs roughly 17,000. Staying inside the free tier would have
meant a credit budgeter and a kickoff-weighted sync cadence — a real subsystem, built to make a
feed worse.

*Rejected:* The Odds API at $30/month for 20,000 credits. It works and it is contractual, but a
private game among friends should not carry a subscription, and the coverage advantage —
forty-odd books — is worthless under [D9](#d9--lines-one-house-line-per-market), which uses one
house line per market anyway. ESPN being a single book is not a limitation here; it is the
design.

*Rejected:* an admin entering lines by hand each week. Zero dependencies, and it makes the
person running the league do data entry every Thursday until they stop.

*What this accepts:* an undocumented endpoint with no SLA that can change shape without notice.
Two things make that survivable. Parsing is defensive — an unrecognized field skips its market
instead of throwing — and `suspendStaleMarkets` already closes markets whose data has aged past
`STALE_AFTER_MS`, so a feed that goes dark degrades into "no betting" rather than "betting
against stale lines." A fixture-provider kill switch stays wired for the case where it breaks
outright.

*Note on D2's other rejection:* D2 also rejected scraping ESPN Bet, on the grounds that scraping
markup violates terms and breaks constantly. That reasoning is untouched — this reads a public
JSON API that ESPN's own site consumes, and no HTML is parsed. It remains unofficial, and the
project is non-commercial and private, which is the whole basis for finding that acceptable.

---

### D50 — Notifications are opt-out email with per-type switches

*Added 2026-08-20 during the production-readiness roadmap session.*

Transactional email, on by default, with a toggle per notification type and one global off
switch. Time-sensitive events send immediately; settlements and the weekly allowance are
batched into a digest.

Notifications exist for one reason: subsystems 3 and 4 created states that rot when unseen. An
unaccepted peer-to-peer offer expires, and a disputed event stalls on an admin who has no idea
they are the bottleneck. Everything else on the list is decoration.

*Rejected:* web push via the PWA. Better urgency, but it needs an installed app, a service
worker, permission prompts, and subscription lifecycle management — meaningful infrastructure
for a group small enough that everyone reads email.

*Rejected:* opt-in. In a group this size, defaulting off means nobody turns it on and the
expiring-offer problem stays unsolved. Per-type switches plus a global off make opting out
one click, which is the part that actually matters.

*Constraint this carries into the build:* every send is idempotency-keyed the way `feed_events`
are. `settle` is deliberately resumable and safe to re-run
([D3](#d3--stack-single-nextjs-app-on-postgres) forced the batching; idempotency made it safe),
and an unkeyed send turns a harmless re-run into a second email to everyone. A duplicate ledger
write has a reversing entry. A duplicate email does not.

---

### D51 — UI conventions are tested structurally, not with a component-test harness

*Added 2026-08-22 during the phase 7a design session.*

Phase 7a is the first work in this project that produces files under `src/app` worth testing.
It tests them by walking the filesystem from a plain node test — asserting that the required
`error.tsx`, `loading.tsx`, and `not-found.tsx` files exist, that every page calling
`notFound()` has a not-found boundary above it, and that every form using `useTransition`
disables a control on the result. No jsdom, no React Testing Library, no second vitest
environment.

The assertion that carries this is the `notFound()` one. The rest describe the tree as it
stands today and would be satisfied by a developer who simply did not delete anything; that one
constrains routes not yet written, which is the only kind of structural test worth keeping.

*Rejected:* jsdom plus React Testing Library, and a vitest projects config splitting node from
browser environments. It buys real coverage of the boundary components — but those components
are a heading, a paragraph, and two links, and they are scheduled to be rewritten in 7b against
a token layer that does not exist yet. Paying for a harness now means paying to keep its tests
green through a rewrite that is already planned.

*Rejected:* browser verification alone. The one-time browser pass is what proves the boundaries
actually render, and it is genuinely necessary — a filesystem test cannot see a blank screen.
But it leaves nothing behind. A refactor that deletes `(app)/error.tsx` would restore exactly
the white-screen failure this phase exists to remove, and nothing would catch it.

*What this accepts:* the pending-state check is a source-text assertion, and source-text
assertions are coarse. It can be defeated by a form that disables its button through a variable
named something else. Its job is to fail loudly when a form is added with no pending state at
all, which is the failure that actually happens.

*Revisit when:* 7b builds the shared component set. A button, dialog, and form-field component
with real behavior is the first thing in this repo that a component test would genuinely earn,
and that is the moment to reconsider — not before.

---

### D52 — Semantic tokens in two tiers; dark mode is a remap, not a variant sweep

*Added 2026-08-24 during the phase 7b design session.*

`src/app/globals.css` is the whole token layer. Tier 1 is a set of private ramps holding the
exact `oklch()` values Tailwind ships for the zinc, red, emerald, and amber stops the app
already uses. Tier 2 is thirty semantic tokens — `--surface-raised`, `--ink-muted`,
`--negative-line`, and so on — that point at Tier 1 stops. Screens and components may name only
Tier 2. Dark mode redefines Tier 2 and never touches Tier 1: the same thirty names pointed at
different stops, under `@media (prefers-color-scheme: dark)` and again under
`:root[data-theme="dark"]`, which ships with no way to set the attribute so that adding a
toggle later is a drop-in rather than a CSS restructure.

Tokens reach Tailwind through `@theme inline`, and the `inline` is load-bearing. Verified by
compiling Tailwind 4.3.3 rather than assumed: with it, `.bg-surface` emits `background-color:
var(--surface)` and the variable resolves at the element, picking up the scoped override;
without it, the utility resolves through `--color-surface` at `:root` and every scoped override
is dead. Opacity modifiers still work, compiling to a `color-mix()` guarded by `@supports` with
the solid colour as fallback, which is what the sticky header and tab bar need.

*Rejected:* keeping the 144 hand-written `dark:` variants and simply tokenizing the light
values. It leaves every screen stating the dark theme for itself, which is how the four amber
chips in `feed-card.tsx` ended up with no dark variant at all and no one noticing. Dark mode
stated once is checkable; dark mode stated 144 times is not.

*Rejected:* referencing Tailwind's own `--color-zinc-*` variables from Tier 2 instead of
copying the values. Tailwind v4 emits a theme variable only when a generated utility uses it,
so those references are not guaranteed to resolve at runtime — and the failure would be silent
and partial.

*What this accepts:* thirty names is more vocabulary than a reader holds on first pass, and the
three `-surface-soft` dark values use `color-mix()` with no `@supports` fallback. The failure
mode of the latter is a transparent callout tint on a browser this private group does not use.

---

### D53 — The shared component set is scoped to call sites that exist

*Added 2026-08-24 during the phase 7b design session.*

Phase 7b builds `Button`, `Card`, `Callout`, `SegmentedControl`, and `FormField`, and upgrades
`Badge`, `Money`, `EmptyState`, `StatusScreen`, `LoadingScreen`, and `TabBar` in place. It does
not build `Dialog`, `Sheet`, `Table`, or `Toast`, which the roadmap's 7b bullet listed. Those
four have no call site anywhere in the app — `grep` finds zero `<table>`, zero `role="dialog"`,
and zero `<dialog>` across 63 `.tsx` files. They belong to 7c, built in the commit that first
needs one.

The selection rule is the decision, not the specific list: a component ships in 7b only if the
same diff contains a real call site for it.

*Rejected:* building all eight, so that 7c is pure screen work with nothing left to invent. A
component designed against zero consumers encodes a guess about its API, and the first real
consumer either bends to the guess or rewrites it — so the work is either wasted or worse than
wasted. "7c should not have to stop and build things" is a scheduling preference, and it is not
worth four speculative APIs.

*Rejected:* an exception for `Toast`, which was the closest call. Twelve forms report their
results as inline text that can scroll out of view, so the problem is real. But a toast needs a
client provider, a portal, and a dismissal policy — that is a design question about how this app
reports success, not a styling question, and deferring it costs nothing that is not already the
status quo.

*Consequence to watch:* if 7c reaches its third screen still hand-rolling the same missing
component, that is the signal this rule was applied too literally and the component should be
lifted at once rather than at the end.

---

### D54 — A token-lint test is the harness 7b earns, revisiting D51

*Added 2026-08-24 during the phase 7b design session.*

[D51](#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness) deferred
the question of a component-test harness to "when 7b builds the shared component set." It has,
and the answer is still no jsdom and no React Testing Library. What 7b adds instead is
`src/app/__tests__/token-lint.test.ts`, a filesystem walk that fails when any `.tsx` file
outside a four-entry allowlist contains a raw palette class, a `bg-white`/`text-black`-style
literal, a hex or arbitrary colour value, or a `dark:` variant.

This is D51's own reasoning applied a second time. D51 kept the `notFound()` assertion because
it constrains routes not yet written, and discarded the others as descriptions of a tree that
already existed. Token-lint is entirely of the first kind: once the sweep lands it says nothing
about today's code and everything about screen nineteen.

*Rejected:* jsdom plus React Testing Library for `Button`, `FormField`, and `SegmentedControl`.
D51 predicted these would be "the first thing in this repo that a component test would genuinely
earn" — and having specified them, they are not. `Button` is a class-name switch over a variant
prop, `SegmentedControl` renders `next/link`s, and `FormField` is a label and a wrapper. None
holds state, none traps focus, none has behaviour a source-text assertion cannot reach. The
components that *would* earn a harness are the deferred ones — `Dialog` and `Toast` — so the
harness question moves with them, to 7d.

*Rejected:* extending `route-conventions.test.ts` only, asserting the new components exist.
That describes the tree as it stands and nothing stops screen nineteen from being written in raw
zinc, which is the entire failure this phase exists to prevent recurring.

*What this accepts:* token-lint is a source-text assertion and cannot see a token used in the
wrong *role*. `bg-surface-muted` where `bg-surface-sunken` was meant renders wrong and passes
green. The one-time browser audit is what catches that class of error, and it is a success
criterion of the phase rather than a nicety for exactly this reason.
