# Custom Events — Design Spec

**Date:** 2026-08-17
**Status:** Built
**Scope:** Subsystem 3 of 4 (see [../roadmap.md](../roadmap.md))
**Depends on:** [Subsystem 1 — core betting engine](2026-08-14-core-betting-engine-design.md), built ·
[Subsystem 2 — social layer](2026-08-17-social-layer-design.md), built

## Purpose

Let members create the markets the sportsbook doesn't carry — the Jyxnzi Rainbow Six
tournaments, who wins map 3, whether Jake can name ten starting quarterbacks. A member writes
an event, prices its outcomes by hand, other members bet, and the creator declares the winner.

The money at risk is **credits**, a second currency introduced by this subsystem. Credits are
granted, never bought, and never convert to or from the cash bankroll. That separation is the
entire integrity story: a hand-priced market resolved by a human being cannot move a single
cash cent, so the standings keep measuring what they measure today.

The engineering goal is that this is *one* betting engine, not two. Custom markets flow
through the same placement path, the same odds arithmetic, the same parlay grading, and the
same ledger as an NFL spread. What differs is where the result comes from — a person instead
of a score feed — and which denomination moves.

## Success criteria

Subsystem 3 is done when all of the following are true:

1. Any approved member can create an event with one or more markets, each a question with two
   or more hand-priced outcomes, and other members can bet credits on it.
2. Cash and credits are independently correct: every membership carries two balances, both
   reconcile against the ledger, and no operation in the system moves value between them.
3. A creator resolves their event and winners are paid immediately, in credits, through the
   existing ledger with deterministic idempotency keys.
4. A member who disagrees can dispute a resolution; an admin re-resolves, which reverses the
   original payout and posts the correction without editing history.
5. An event that passes its resolve-by date without being resolved surfaces to admins and to
   the season feed on its own, and an admin can void it, refunding every stake.
6. A slip cannot mix a game leg with a custom-event leg, and a creator's bet on their own
   event is visibly labelled everywhere it appears.
7. `npm run verify` passes, and every existing test still passes with its behavior unchanged.

## Non-goals

Cash↔credits conversion in either direction · exposure caps on hand-priced markets ·
creator-set spreads or numeric totals · live or moving custom lines · a formal dispute queue,
voting, or juries · custom events spanning seasons · peer-to-peer bets (subsystem 4) ·
notifications of any kind · a creator reputation or accuracy score · attachments or evidence
uploads on a resolution.

Each is excluded deliberately. Conversion would defeat the reason for splitting the currency
([D31](../decisions.md#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency)).
Exposure caps become unnecessary once credits are sealed off
([D38](../decisions.md#d38--no-exposure-cap-on-hand-priced-markets)). Numeric totals are
expressible as a two-outcome market in words
([D36](../decisions.md#d36--one-custom-market-shape-n-way-pick-the-winner)). The rest are
machinery that a five-person league that already shares a group chat would never run.

## Architecture

No new services, no new deployment, no new dependencies. Three structural changes to the
existing Next.js app.

```
┌───────────────────────────────────────────────────────────────────────┐
│  Next.js app (unchanged deployment)                                    │
│                                                                        │
│  React UI ── /events · /events/new · /events/[id]                      │
│              /events/[id]/resolve · /admin/events                      │
│      ↕ server actions                                                  │
│  Domain layer ── pure, no I/O                                          │
│      domain/grading.ts   + gradeCustomLeg()                            │
│      domain/odds.ts · money.ts · milestones.ts   unchanged             │
│  Service layer                                                         │
│      server/events/create.ts    createCustomEvent()                    │
│      server/events/resolve.ts   resolveCustomEvent() · voidCustomEvent │
│      server/events/dispute.ts   disputeResolution()                    │
│      server/events/overdue.ts   sweepOverdueEvents()                   │
│      server/bets/{place,settle,resettle}.ts   kind-aware joins         │
│      server/money/ledger.ts                   currency-aware           │
│      ↕                                                                 │
│  Drizzle → Postgres                                                    │
│      events · custom_events · custom_event_disputes                    │
│      games(+event_id) · markets(event_id, title, winning_selection_id) │
│      selections(+label, sort_order)                                    │
│      ledger_entries(+currency) · season_memberships(+credits_balance)  │
│      bets(+currency) · seasons(+credit grants)                         │
└───────────────────────────────────────────────────────────────────────┘
```

### 1. `events` becomes the supertype markets hang off

Today `markets.game_id` is `NOT NULL` and points straight at `games`. This subsystem inserts a
thin identity table above it: `events` carries only `id`, `kind`, `title`, `starts_at`, and
`created_at`. `games` becomes a subtype with a unique `event_id` back-reference; `custom_events`
is its sibling. `markets.event_id NOT NULL` replaces `markets.game_id`, and one migration
backfills an event row per existing game.

`events` deliberately has **no status column**. Each subtype owns its own lifecycle — `games.status`
is untouched, `custom_events.status` is its own enum — so there is no polymorphic status
to interpret differently depending on kind, and no risk of the two disagreeing. See
[D33](../decisions.md#d33--events-is-a-true-supertype-not-a-pair-of-nullable-foreign-keys).

### 2. `currency` becomes a dimension on the ledger

`ledger_entries` gains `currency` (`CASH` | `CREDITS`, existing rows backfilled to `CASH`).
`season_memberships` gains `credits_balance_cents` beside `balance_cents`. `postEntry(tx, …)`
takes a currency, locks the same membership row, checks the matching balance, and updates the
matching cache column. `reconcileBalances` groups by `(membership, currency)` and asserts both.

**No new ledger entry types.** `SEASON_STARTING_GRANT`, `WEEKLY_ALLOWANCE`, `BET_PLACED`,
`BET_WON`, `BET_PUSHED`, `BET_VOIDED`, `ADMIN_CREDIT`, `ADMIN_DEBIT` and `SETTLEMENT_REVERSAL`
all mean exactly the same thing in either denomination; adding `CREDITS_BET_PLACED` alongside
`BET_PLACED` would double the enum to say nothing new. See
[D34](../decisions.md#d34--currency-is-a-dimension-on-the-existing-ledger-not-a-second-ledger).

### 3. Grading routes by event kind

`gradeLeg` — the score-based grader for moneyline, spread and total — is not modified. A new
pure function sits beside it:

```ts
export function gradeCustomLeg(input: {
  selectionId: string;
  winningSelectionId: string | null;   // null = market not yet resolved
}): 'WON' | 'LOST' | 'PENDING';
```

One helper, `gradeBetLegs`, picks between them per leg from the leg's event kind. Everything
downstream — `gradeParlay`, `settledPayoutCents`, `americanToRational`, `combine` — is used
unchanged. A three-leg credits parlay is priced by the same exact rational arithmetic as a
three-leg NFL parlay, because it *is* the same code.

### Layering rule, restated

The result of a custom market is a stored value (`markets.winning_selection_id`) before it is
ever a grade. That is the same discipline `line_at_placement` enforces for spreads
([D10](../decisions.md#d10--legs-freeze-their-line-and-price-at-placement)): grading stays a
pure function of stored values, so it stays exhaustively testable without a database.

## Data model

All monetary values remain integer cents ([D17](../decisions.md#d17--all-money-is-integer-cents)).
Timestamps are `TIMESTAMPTZ`. Primary keys are UUIDv4
([D18](../decisions.md#d18--primary-keys-are-uuidv4-not-uuidv7)).

### `events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `kind` | enum | `GAME` \| `CUSTOM` |
| `title` | text | `"KC @ BUF"` for games (backfilled from abbreviations), the creator's title for custom |
| `starts_at` | timestamptz | when betting closes |
| `created_at` | timestamptz | |

`title` exists so a polymorphic read has something to render without knowing the subtype. The
sports feed snapshot keeps building its own richer leg description from `teams` exactly as it
does today — this column is a fallback, not a replacement.

### `custom_events`

| Column | Type | Notes |
|---|---|---|
| `event_id` | uuid | PK, FK `events` |
| `season_id` | uuid | FK `seasons` — credits are season-scoped, so events are too |
| `creator_membership_id` | uuid | FK `season_memberships` |
| `description` | text | nullable, free text |
| `resolves_by` | timestamptz | the creator's own deadline |
| `status` | enum | `OPEN` \| `RESOLVED` \| `VOIDED` |
| `resolved_at` | timestamptz | nullable |
| `resolved_by_user_id` | uuid | nullable FK `users` — creator or admin |
| `resolution_note` | text | nullable; **mandatory on a re-resolution** |
| `resolution_attempts` | integer | default 0 |

`resolution_attempts` is `bets.settlement_attempts` under another name, and for the same
reason: a disputed re-resolution must write idempotency keys that cannot collide with the
original payout's.

**Overdue is derived, never stored** — `status = 'OPEN' AND resolves_by < now()`. A stored flag
is a third state that can disagree with the clock, and it would need a job to maintain.

**Indexes**

| Index | Columns | Serves |
|---|---|---|
| `custom_events_season_status_idx` | (`season_id`, `status`) | the events board |
| `custom_events_overdue_idx` | (`resolves_by`) `WHERE status = 'OPEN'` | the overdue sweep |
| `custom_events_creator_idx` | (`creator_membership_id`) | a member's created events |

### `custom_event_disputes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK `events` |
| `membership_id` | uuid | FK `season_memberships` — who disputed |
| `reason` | text | required, trimmed, ≤ 500 chars |
| `created_at` | timestamptz | |
| `resolved_at` | timestamptz | nullable — set when an admin re-resolves or voids |

Unique on `(event_id, membership_id)`: one dispute per member per event, and a second click is
a no-op rather than a second row.

A four-column table rather than reading disputes back out of `feed_events`. The feed is a
publication, not a system of record — an admin queue that queries feed rows to find its work
would be the first place in this codebase where that line is crossed. The dispute also posts a
feed card; the card is the announcement, the row is the state.

### `games`

Unchanged, plus `event_id uuid NOT NULL UNIQUE REFERENCES events(id)`. Every existing column,
index, and query on this table keeps working.

### `markets`

| Change | Detail |
|---|---|
| `event_id` | `NOT NULL` FK `events`, **replaces** `game_id` |
| `type` | gains `CUSTOM_OUTCOME` |
| `title` | new, nullable — the question ("Who wins map 3?"); null for sports markets |
| `source_book` | becomes **nullable**; NULL means hand-priced by a member |
| `winning_selection_id` | new, nullable FK `selections` — set at resolution |
| `markets_event_type_idx` | becomes **partial**: `UNIQUE (event_id, type) WHERE type <> 'CUSTOM_OUTCOME'` |

The unique index has to become partial because one custom event carries many `CUSTOM_OUTCOME`
markets (tournament winner, map 1, map 2), while the odds sync still depends on one market per
type per game for its upsert. Partial indexes are already idiomatic here — `bet_legs_pending_idx`
and `seasons_one_active_idx` are both partial.

`winning_selection_id` is what makes custom grading pure. It is nullable until resolution and
is rewritten (not cleared and re-set) on a re-resolution.

### `selections`

| Change | Detail |
|---|---|
| `side` | becomes **nullable** — a custom outcome has no HOME/AWAY/OVER/UNDER |
| `label` | new, nullable — the outcome name ("Team Falcons"); null for sports |
| `sort_order` | new, `smallint NOT NULL DEFAULT 0` — the creator's display order |
| `selections_market_side_idx` | becomes `UNIQUE (market_id, side) WHERE side IS NOT NULL` |
| `selections_market_label_idx` | new, `UNIQUE (market_id, label) WHERE label IS NOT NULL` |

`price_american` is unchanged and required. A hand-priced outcome is priced in the same units
as a sportsbook line, which is exactly why no odds code changes. `line` stays null for custom
selections.

A `CUSTOM_OUTCOME` market must have **at least two** selections, enforced at creation — a
one-outcome market is not a market.

### `bets`

Gains `currency` (`CASH` | `CREDITS`, `NOT NULL DEFAULT 'CASH'`). Derived from the legs at
placement and stored, so no read has to re-derive it by joining four tables to find out which
balance a bet came out of.

### `season_memberships` and `seasons`

| Table | Column | Notes |
|---|---|---|
| `season_memberships` | `credits_balance_cents` | `bigint NOT NULL DEFAULT 0` |
| `seasons` | `starting_credits_cents` | `bigint NOT NULL DEFAULT 0` |
| `seasons` | `weekly_credit_allowance_cents` | `bigint NOT NULL DEFAULT 0` |

### `ledger_entries`

Gains `currency` (`CASH` | `CREDITS`, `NOT NULL DEFAULT 'CASH'`). Existing rows backfill to
`CASH` by that default, which is correct: every entry written before this subsystem was cash.
`idempotency_key` stays globally unique — keys are already namespaced by what wrote them, and
credit keys carry their own suffix (below).

## Credits

### Where they come from

| Movement | Entry | Idempotency key |
|---|---|---|
| Joining a season | `SEASON_STARTING_GRANT`, `CREDITS` | `grant:<membershipId>:credits` |
| Weekly drip | `WEEKLY_ALLOWANCE`, `CREDITS` | `allowance:<membershipId>:<weekKey>:credits` |
| Admin grant/removal | `ADMIN_CREDIT` / `ADMIN_DEBIT`, `CREDITS` | caller-supplied, as today |

Each key is the existing cash key plus a `:credits` suffix — `grant:<id>` and
`grant:<id>:credits` are two entries in two denominations for one event, lined up by eye.

`payWeeklyAllowance` pays both currencies in the same run: two `postEntry` calls per membership
inside the same transaction, with distinct keys. It still emits exactly one `ALLOWANCE_PAID`
card per season per week ([D26](../decisions.md#d26--allowance-posts-one-aggregated-card-per-week)),
now carrying both amounts. `joinSeason` likewise grants both in one transaction.

Seasons created before this subsystem default both credit fields to zero, which means zero
credits granted and no custom betting — a safe default, not a broken one.

### Where they cannot go

There is no conversion service, no exchange rate, and no admin override that moves value
between denominations. The only way credits enter the economy is a grant; the only way they
leave is a losing bet. An admin who wants to reward someone in cash uses the existing cash
adjustment; the two paths never meet.

### What they're used for

Custom markets are credits-only. Games are cash-only. Nothing else in the system accepts
credits, and standings are unchanged: the existing leaderboard ranks cash balance. Credits get
their own ranked table on the same screen, clearly a second scoreboard.

`MILESTONE_LEAD_CHANGE` remains a **cash-only** signal, because "the lead" means the standings.
`MILESTONE_BIG_WIN` and `MILESTONE_PARLAY_HIT` fire for credits bets too, with the currency in
the payload so the card renders in the right units — a 12× credits parlay is worth announcing
even though it moves no cash.

## Placement

`placeBet` keeps its shape entirely: validate cheaply, open a transaction, insert the bet,
re-validate under the membership lock, freeze the legs, post the ledger entry, emit the feed
card. Four changes inside it.

**1. `loadSelections` becomes kind-aware.** Today it inner-joins `markets → games → teams`,
which would drop every custom leg on the floor. It becomes `markets → events`, left-joining
`games` (+ team aliases) and `custom_events`, and returns a discriminated `LoadedSelection`:

```ts
type LoadedSelection =
  | { kind: 'GAME';   selectionId; marketId; marketType; marketStatus; side; line;
      priceAmerican; eventId; eventStatus; eventStartsAt; sport; homeAbbr; awayAbbr }
  | { kind: 'CUSTOM'; selectionId; marketId; marketType; marketStatus; label; line: null;
      priceAmerican; eventId; eventStatus; eventStartsAt; eventTitle; marketTitle;
      creatorMembershipId };
```

`gameId`/`gameStatus`/`gameStartsAt` become `eventId`/`eventStatus`/`eventStartsAt` across both
variants, so every existing bettability check reads the same for both kinds.

**2. Currency is derived and then enforced.** All legs must share one kind; `GAME` → `CASH`,
`CUSTOM` → `CREDITS`. A mixed slip returns a new error before any transaction opens:

```ts
| { code: 'MIXED_CURRENCY_PARLAY'; gameLegIndexes: number[]; customLegIndexes: number[] }
```

This is the one genuinely new placement rule, and it is unreachable from the UI — the slip is
in one mode or the other. It exists because the server decides, not the client.

**3. `DUPLICATE_GAME` generalizes to `DUPLICATE_EVENT`.** [D13](../decisions.md#d13--no-same-game-parlay-legs-max-10-legs)
bans same-game parlay legs because they are correlated and paying them at independent odds is
free money. "Who wins the tournament" and "who wins the final" are correlated for exactly the
same reason, so the rule extends unchanged to events; only the error code's name and field
change (`gameId` → `eventId`).

**4. Bettability, per kind.** A game leg is bettable when `games.status = 'SCHEDULED'` and
kickoff is in the future — unchanged. A custom leg is bettable when `custom_events.status = 'OPEN'`
and `events.starts_at` is in the future. Market status (`OPEN` / `SUSPENDED` / `SETTLED`) is
checked identically for both.

Stake minimum, balance check, and line/price re-validation are unchanged. `INSUFFICIENT_FUNDS`
now reports the balance in the bet's own currency, and the `BET_PLACED` ledger entry carries
that currency — the debit comes out of `credits_balance_cents` for a custom bet and
`balance_cents` for a game bet, from the same `postEntry` call with the same key.

## Creating an event

```ts
export async function createCustomEvent(input: {
  creatorMembershipId: string;
  title: string;
  description?: string;
  startsAt: Date;
  resolvesBy: Date;
  markets: {
    title: string;
    outcomes: { label: string; priceAmerican: number }[];   // ≥ 2
  }[];                                                       // ≥ 1
}): Promise<{ ok: true; eventId: string } | { ok: false; error: CreateEventError }>;
```

One transaction writes `events`, `custom_events`, every market and every selection, and emits
one `CUSTOM_EVENT_CREATED` feed card. Validation, all server-side:

| Rule | Error |
|---|---|
| Title trimmed, 1–120 chars; description ≤ 1000 | `INVALID_TITLE` / `INVALID_DESCRIPTION` |
| `startsAt` in the future; `resolvesBy` ≥ `startsAt` | `INVALID_SCHEDULE` |
| At least one market, at most 20 | `INVALID_MARKET_COUNT` |
| Each market: title 1–120 chars, 2–20 outcomes, labels unique within the market | `INVALID_MARKET` |
| Each price parses through `americanToRational` | `INVALID_PRICE` |
| Creator is an approved member of the active season | `NOT_A_MEMBER` |

Prices are **not** validated for sanity. A creator may offer +50000 on a coin flip; that is
their credits to give away, and a house-edge rule is a tuning knob nobody asked for
([D38](../decisions.md#d38--no-exposure-cap-on-hand-priced-markets)).

### Editing and suspending

A creator may edit their event — titles, prices, outcomes, dates — **only while it has zero
bets**. Once one credit is at risk, the event is frozen, with one exception: the creator (or an
admin) may set any market to `SUSPENDED`, which stops new bets without touching placed ones.
That is the only lever available after the fact, and it is enough. Reopening a suspended market
is allowed while the event is `OPEN` and `starts_at` has not passed.

Placed bets are immune to all of this by [D10](../decisions.md#d10--legs-freeze-their-line-and-price-at-placement):
legs froze their price at placement, so there is no path by which a creator can reprice a bet
that already exists. The freeze that exists for line movement is exactly the protection needed
here, which is why the roadmap's worry about creators adjusting prices needs no new mechanism.

## Resolution

```ts
export async function resolveCustomEvent(input: {
  eventId: string;
  actorUserId: string;
  actorMembershipId: string;
  isAdmin: boolean;
  winners: { marketId: string; winningSelectionId: string }[];  // every market, or none
  note?: string;              // required when this is a re-resolution
}): Promise<ResolveResult>;
```

Authorized for the event's creator or any admin. One transaction, in order:

1. Lock `custom_events` `FOR UPDATE`. Reject if `VOIDED`.
2. Reject unless `winners` covers **every** market of the event exactly once, and each
   `winningSelectionId` belongs to its named market. A partially resolved event is not a state
   this design has — it would mean a parlay that can never grade.
3. Increment `resolution_attempts` to `n`.
4. Set each market's `winning_selection_id` and its status to `SETTLED`.
5. Grade every pending leg on those markets with `gradeCustomLeg`, then every bet those legs
   belong to with the existing `gradeParlay`, exactly as `settleGame` does.
6. Pay via `postEntry(tx, { currency: 'CREDITS', idempotencyKey: 'bet:<betId>:settled:<attempts>' })`
   — the bet's own settlement-attempt counter, unchanged from subsystem 1.
7. Set `status = 'RESOLVED'`, `resolved_at`, `resolved_by_user_id`, `resolution_note`.
8. Emit `CUSTOM_EVENT_RESOLVED` plus the usual `BET_SETTLED` and milestone cards.

Payout is immediate — there is no challenge window and no held state
([D35](../decisions.md#d35--custom-events-pay-on-resolution-disputes-are-an-admin-re-resolution)).

### Disputes

Any member of the season may dispute a `RESOLVED` event from its page, with a required reason.
`disputeResolution` inserts a `custom_event_disputes` row (unique per member per event) and
emits a `CUSTOM_EVENT_DISPUTED` card naming the disputer and quoting the reason. It moves no
money and changes no status.

An admin then re-resolves through the same `resolveCustomEvent` with a mandatory note and, for
each bet whose grade changed, the existing correction path: `SETTLEMENT_REVERSAL` of what the
previous attempt paid, then the corrected entry, both keyed on the new attempt number. This is
[D15](../decisions.md#d15--corrections-write-reversing-entries-history-is-never-edited) applied
without modification — `resettleBet`'s regrade is extended to route by event kind rather than
being copied into a second function. Open disputes on the event are stamped `resolved_at`.

Only an admin may re-resolve. A creator gets one shot; after that the league's referee is the
referee.

### Voiding

```ts
export async function voidCustomEvent(input: {
  eventId: string; actorUserId: string; note: string;   // note required
}): Promise<VoidResult>;
```

Admin-only. Every pending leg on the event becomes `VOIDED`, every affected bet grades through
the existing void path, and every stake refunds as `BET_VOIDED` in credits — the same code a
postponed game already runs. A resolved event can also be voided, in which case each bet goes
through the reversal path first, on a fresh `resolution_attempts` number. Sets
`status = 'VOIDED'`, sets every market to `SETTLED` with `winning_selection_id` left as it was,
stamps any open disputes `resolved_at`, and emits `CUSTOM_EVENT_VOIDED`.

### Overdue sweep

```ts
export async function sweepOverdueEvents(now?: Date): Promise<{ flagged: number }>;
```

Selects `custom_events` where `status = 'OPEN' AND resolves_by < now()` and emits one
`CUSTOM_EVENT_OVERDUE` card per event, dedupe key `customevent:<eventId>:overdue`, so it posts
exactly once no matter how often the sweep runs. It moves no money and changes no status —
its entire job is to make a forgotten event impossible to ignore.

Called from the end of the existing `settle` cron route, next to `detectLeadChange`. No new
entry in `vercel.json`, no cursor table, nothing to get stuck — the same reasoning subsystem 2
used for lead changes.

Credits are only unlocked by a human: an admin resolves the event or voids it. Auto-voiding on
a timer was rejected — a job that moves money because a date passed is a job that will
eventually void an event that just needed one more day
([D37](../decisions.md#d37--events-carry-a-resolve-by-date-overdue-is-derived-and-swept-to-admins)).

## Feed

Five new event types, and two existing payloads gain a currency:

| Type | Subject | Emitted from | Reads as |
|---|---|---|---|
| `CUSTOM_EVENT_CREATED` | creator | `createCustomEvent` | *Dana* opened **Jyxnzi Cup** · 3 markets · closes Fri 8pm |
| `CUSTOM_EVENT_RESOLVED` | resolver | `resolveCustomEvent` | **Jyxnzi Cup** resolved by *Dana* · Falcons win |
| `CUSTOM_EVENT_DISPUTED` | disputer | `disputeResolution` | *Sam* disputed **Jyxnzi Cup** — "map 3 was forfeited" |
| `CUSTOM_EVENT_VOIDED` | *null* | `voidCustomEvent` | **Jyxnzi Cup** voided by admin *Chris* · all stakes refunded |
| `CUSTOM_EVENT_OVERDUE` | creator | `sweepOverdueEvents` | **Jyxnzi Cup** is past its resolve-by date |

Dedupe keys follow the existing scheme: `customevent:<eventId>:created`, `…:resolved:<attempt>`,
`…:disputed:<membershipId>`, `…:voided`, `…:overdue`.

`BET_PLACED` and `BET_SETTLED` payloads gain `currency`, and their leg snapshot becomes a
discriminated union so a custom leg can render at all:

```ts
type FeedLegSnapshot =
  | { kind: 'GAME'; sport; startsAt; homeAbbr; awayAbbr; marketType; side; line; priceAmerican }
  | { kind: 'CUSTOM'; startsAt; eventTitle; marketTitle; outcomeLabel; priceAmerican;
      byCreator: boolean };
```

`byCreator` is the disclosure: a creator's bet on their own event is labelled on every card it
appears in, not only on the event page
([D32](../decisions.md#d32--anyone-can-create-events-and-creators-may-bet-their-own-with-disclosure)).
The rule that identity is joined live and facts are frozen holds here too — `eventTitle` and
`outcomeLabel` are frozen into the payload, the creator's display name is not.

Existing per-viewer mute preferences extend to the five new types with no code change; the
preferences screen enumerates the enum.

## Screens

The bottom bar goes from five tabs to six: **Games · Events · Feed · My Bets · Standings · Me**.
Six is the practical ceiling on a phone; if it reads as crowded once it is on a real device,
the fallback is a segmented control on the Games screen rather than a seventh tab.

- **Events** (`/events`) — open events sorted by close time, then an *Awaiting resolution*
  section (past `starts_at`, unresolved), then recently resolved. Each row shows title, creator,
  close time, market count, and total credits staked. Overdue rows are marked.
- **Create** (`/events/new`) — title, description, close time, resolve-by, then a repeatable
  market block: question plus a list of outcomes, each with a label and an American price. A
  live implied-probability readout per market, purely informational — it tells a creator their
  book adds to 140% without stopping them.
- **Event detail** (`/events/[eventId]`) — the markets and their outcomes as a bet-slip surface,
  the creator's name, **the creator's own position if any**, every member's open interest, and
  the state-appropriate control: *Resolve* for creator or admin while `OPEN`, *Dispute* for any
  member while `RESOLVED`, nothing while `VOIDED`. Resolution notes and disputes are shown
  inline with the outcome.
- **Resolve** (`/events/[eventId]/resolve`) — one radio group per market, a note field
  (mandatory on a re-resolution), and a confirmation that names what will be paid. Creator or
  admin.
- **Admin events** (`/admin/events`) — overdue events, events with open disputes, and a void
  control with its mandatory note. This is the only screen that can re-resolve.

Changed existing screens: the bet slip renders credits and refuses to mix kinds; **Standings**
gains a credits leaderboard beneath the cash one; **Me** shows both balances and the ledger
gains a currency column; **My Bets** filters by currency; **Season admin** gains the two credit
grant fields.

## Failure handling

| Failure | Behavior |
|---|---|
| Two resolutions submitted at once | The `FOR UPDATE` lock on `custom_events` serializes them; the second sees `RESOLVED` and is rejected as a re-resolution attempt (admin-only, note required). |
| A resolution is retried after a timeout | Bet payouts are keyed `bet:<betId>:settled:<attempt>`; the retry re-posts nothing. The event's own status update is idempotent. |
| A bet lands as the event resolves | The resolution holds the event row and grades only legs that are `PENDING`; placement re-validates bettability under lock and fails on `starts_at`/status. One of the two loses cleanly. |
| Creator resolves an event they bet on | Allowed, and the payout to their own bet is visible on the card and on their profile. Disclosure, not prevention ([D32](../decisions.md#d32--anyone-can-create-events-and-creators-may-bet-their-own-with-disclosure)). |
| Resolution names a selection from another market | Rejected in step 2. Never partially applied — the whole transaction rolls back. |
| An event is resolved with a market missing | Rejected. Partial resolution is not a state; a parlay leg on the missing market could never grade. |
| A creator leaves the league mid-event | `season_memberships` rows are never deleted, so the FK holds. The event goes overdue and an admin resolves or voids it. |
| Credits would go negative | `postEntry` rejects against `credits_balance_cents` exactly as it does for cash. A bet cannot be placed with credits the member does not have. |
| A cash operation touches credits, or vice versa | Impossible by construction — currency is explicit on every `postEntry` call and every entry row, and reconciliation asserts each denomination separately. |
| Reconciliation finds a credits drift | Reported per membership *per currency*, so a clean cash balance never masks a broken credits one. |
| A member disputes twice | Unique `(event_id, membership_id)`; the second is a no-op returning the existing dispute. |
| The overdue sweep runs every ten minutes forever | One card per event, ever, by dedupe key. |
| Events that predate this subsystem | None exist. Games get backfilled event rows by the migration; no bet, leg, or ledger row is rewritten. |
| A season with zero credit grants | Members hold zero credits and simply cannot bet custom markets. The events board says so rather than erroring. |

## Testing

**Unit, table-driven, no I/O:**

- `gradeCustomLeg`: the winning selection grades `WON`; any other selection in the market grades
  `LOST`; a null `winningSelectionId` grades `PENDING`.
- Parlay composition over custom legs, reusing `gradeParlay`: all-won pays, one loss kills it,
  a voided leg drops out and pays as a shorter parlay ([D12](../decisions.md#d12--pushed-and-voided-parlay-legs-are-removed-not-fatal)).
- Payout arithmetic on hand-priced outcomes, including a deliberately absurd +50000 price, to
  prove no rounding or overflow path differs from sports pricing.
- Currency derivation from a leg set: all-game → `CASH`, all-custom → `CREDITS`, mixed →
  `MIXED_CURRENCY_PARLAY` with both index lists reported.
- Event creation validation: every row of the rules table above, each asserting its own error
  code.

**Integration, against the test database:**

1. *Two balances stay independent* — grant both, place and settle a cash bet and a credits bet,
   and assert each balance moved by exactly its own currency's amount and the other did not.
2. *Reconciliation per currency* — corrupt `credits_balance_cents` directly and assert
   `reconcileBalances` reports exactly that membership and currency while cash reports clean.
3. *Resolution idempotency* — resolve, then replay the same resolution; assert the ledger and
   `feed_events` are byte-identical after the second call. The most important test in the
   subsystem, and the direct analogue of subsystem 2's settlement-idempotency test.
4. *Dispute and re-resolution* — resolve wrongly, dispute, admin re-resolves; assert a
   `SETTLEMENT_REVERSAL` plus the corrected entry, `resolution_attempts = 2`, the original
   entries untouched, and a correction-flagged card.
5. *Void refunds everything* — bets across three markets, admin voids; assert every stake is
   back, every bet is `VOIDED`, and credits reconcile.
6. *Mixed parlay rejected* — one NFL leg and one custom leg in one slip; assert the error and
   assert no `bets` row was written.
7. *Same-event parlay rejected* — two legs on two markets of one event; assert `DUPLICATE_EVENT`.
8. *Bettability* — a leg on a `SUSPENDED` custom market, on an event past `starts_at`, and on a
   `VOIDED` event are each rejected with the right code.
9. *Overdue sweep* — an event past `resolves_by` emits one card; running the sweep five more
   times emits none.
10. *Authorization* — a non-creator non-admin cannot resolve; a creator cannot re-resolve; a
    member of another season cannot bet, resolve, or dispute; a `PENDING` user is rejected
    everywhere.
11. *Supertype migration* — every pre-existing game has exactly one `events` row, every market
    points at it, and the full subsystem-1 settlement flow still produces identical ledger
    entries. Run against a database seeded before the migration.
12. *End-to-end* — extend `end-to-end.test.ts` with a second arc: create event → two members bet
    → creator resolves → member disputes → admin re-resolves → assert both balances, the full
    feed sequence, and clean reconciliation in both currencies.

The subsystem-1 property must still hold after every operation here: cash balances reconcile
against the cash ledger exactly. The test suite proves it rather than assuming it.

## Open questions carried forward

**Subsystem 4 will inherit this currency split.** Peer-to-peer bets over freeform terms have
the same "a person decides who won" problem and should almost certainly also be credits-only,
which would leave cash meaning exactly one thing: bets against real sportsbook lines, graded by
a score feed. That is a decision for subsystem 4's own design session, but this spec is built so
that it is available rather than foreclosed.

**A creator accuracy signal** — how often a creator's resolutions get disputed or overturned —
is deliberately not built. If disputes turn out to cluster on one member, the data to show it is
already in `custom_event_disputes` and `resolution_attempts`.
