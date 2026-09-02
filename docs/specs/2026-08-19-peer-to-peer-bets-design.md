# Peer-to-Peer Bets — Design Spec

**Date:** 2026-08-19
**Status:** Built
**Scope:** Subsystem 4 of 4 (see [../roadmap.md](../roadmap.md))
**Depends on:** [Subsystem 1 — core betting engine](2026-08-14-core-betting-engine-design.md), built ·
[Subsystem 2 — social layer](2026-08-17-social-layer-design.md), built ·
[Subsystem 3 — custom events](2026-08-17-custom-events-design.md), built

## Purpose

Let two members bet each other directly. One offers terms — "I'll put up 500 credits against
your 200 that the Chiefs cover" — the other accepts, both stakes are escrowed, and the winner
takes the pot. The wager can hang off a market the engine already grades, or it can be a
sentence the two of them made up ("I bet you Jake can't name ten starting quarterbacks").

Everything peer-to-peer moves **credits**, never cash. Subsystem 3 introduced credits so that
a market priced and resolved by a human being could never touch the bankroll the standings
rank ([D31](../decisions.md#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency)).
A wager between two members is that same situation with a smaller audience, so it lives on the
same side of the wall — including the market-backed kind, which is graded objectively but is
not worth splitting the rule for
([D40](../decisions.md#d40--every-peer-to-peer-wager-moves-credits-including-the-market-backed-kind)).

The engineering goal is that this subsystem _adds_ rather than _modifies_. It writes one new
table and reuses `postEntry`, `emitFeedEvent`, `gradeLeg`, `gradeCustomLeg` and the `settle`
cron unchanged. It does not touch `bets`, `bet_legs`, `placeBet`, `settleGame`, or
`resettleBet` at all — so it structurally cannot regress the money paths subsystems 1 and 3
are built on.

This subsystem also finally defines **head-to-head**, which
[D27](../decisions.md#d27--head-to-head-is-deferred-to-subsystem-4) deferred here on the
grounds that nobody bets _against_ anybody until peer-to-peer exists. Now they do.

## Success criteria

Subsystem 4 is done when all of the following are true:

1. A member can offer a wager — directed at one member or open to the season — against either
   an existing selection or a freeform description, naming both stakes explicitly. The
   offerer's stake is escrowed at the moment the offer is posted.
2. Accepting escrows the acceptor's stake in the same transaction that marks the wager
   accepted, and an open offer can be accepted by exactly one member no matter how many tap at
   once.
3. A market-backed wager settles automatically from the same grading the engine already runs:
   a finished game, or a resolved custom event. A push or a dead event refunds both sides.
4. A freeform wager settles when both parties name the same winner
   ([D47](../decisions.md#d47--a-freeform-wager-is-settled-by-both-parties-agreeing-with-admins-as-the-fallback)).
   When they disagree, or when one goes silent past the resolve-by date, it surfaces to admins;
   an admin returns `OFFERER`, `ACCEPTOR` or `VOID` with a mandatory note.
5. An unaccepted offer can be withdrawn by its author or expires on its own, refunding the
   escrow either way. An accepted wager can be voided only by both parties agreeing, or by an
   admin arbitrating.
6. Every credit is accounted for at all times: cached balances reconcile against the ledger
   per currency as they do today, **and** the credits missing from balances equal exactly the
   escrow held by live wagers.
7. Any two members have a head-to-head record — settled, won, lost, voided, net credits —
   derived from wager rows with no stored counter
   ([D48](../decisions.md#d48--head-to-head-is-the-peer-to-peer-record-and-nothing-else)).
8. `npm run verify` passes, and every existing test still passes with its behavior unchanged.

## Non-goals

Cash wagers of any kind · a price or odds on a wager · more than two parties · public
counter-offers or negotiation · unilateral cancellation after acceptance · a standing admin
void over healthy wagers · wagers spanning seasons · notifications · escrow partial
release or laddered stakes · evidence uploads on a claim · a seventh bottom tab · rematch
or streak mechanics beyond the head-to-head record itself.

Each is excluded deliberately. Cash is excluded by
[D40](../decisions.md#d40--every-peer-to-peer-wager-moves-credits-including-the-market-backed-kind).
A price is unnecessary once both stakes are stated as integers
([D41](../decisions.md#d41--a-wager-is-two-explicit-stakes-not-a-stake-and-a-price)).
Negotiation is a chat feature in a league that already has a group chat — an offer is taken or
it is not. Unilateral cancellation after acceptance is just losing without paying. A standing
admin void is deliberately narrowed to the cases where a winner genuinely does not exist
([D45](../decisions.md#d45--void-is-an-arbitration-verdict-and-an-automatic-consequence-never-a-standing-admin-power)).

## Architecture

No new services, no new deployment, no new dependencies, and — unusually for this project —
no changes to any existing table beyond one nullable foreign key.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Next.js app (unchanged deployment)                                     │
│                                                                         │
│  React UI ── /bets (Bets | Wagers segmented control)                    │
│              /wagers · /wagers/new · /wagers/[id] · /admin/wagers       │
│              /members/[id] (+ head-to-head block)                       │
│      ↕ server actions                                                   │
│  Domain layer ── pure, no I/O                                           │
│      domain/p2p.ts   verdictForLegStatus() · isDisputed() · isOverdue() │
│                      potCents() · computeHeadToHead()                   │
│      domain/grading.ts · custom-grading.ts · odds.ts    unchanged       │
│  Service layer                                                          │
│      server/p2p/offer.ts      offerWager() · cancelOffer()              │
│      server/p2p/accept.ts     acceptWager() · declineWager()            │
│      server/p2p/claim.ts      claimWinner() · proposeCancel()           │
│      server/p2p/settle.ts     settleP2PWager() · sweepP2PWagers()       │
│      server/p2p/arbitrate.ts  arbitrateWager()                          │
│      server/p2p/query.ts      board · detail · head-to-head             │
│      server/money/ledger.ts · feed/emit.ts        unchanged             │
│      server/money/reconcile.ts   + reconcileEscrow()                    │
│      ↕                                                                  │
│  Drizzle → Postgres                                                     │
│      p2p_wagers                              new                        │
│      ledger_entries(+p2p_wager_id)           one nullable column        │
│      feed_event_type                         five new enum values       │
│      ledger_entry_type                       three new enum values      │
└────────────────────────────────────────────────────────────────────────┘
```

### 1. A wager is its own table, not a pair of bets

`p2p_wagers` owns its own lifecycle. It is deliberately _not_ modelled as two rows in `bets`
tied by a link table, and not as a two-outcome custom event with exactly two bets
([D42](../decisions.md#d42--a-wager-is-its-own-table-not-two-bets-and-not-a-two-person-custom-event)).

What is reused is _machinery_, not tables: `postEntry` for every credit movement,
`emitFeedEvent` for every card, and the pure graders for market-backed verdicts. That is the
same distinction [D33](../decisions.md#d33--events-is-a-true-supertype-not-a-pair-of-nullable-foreign-keys)
drew when it made `events` a supertype instead of bolting nullable keys onto `markets`: share
the mechanism, not the shape.

### 2. Escrow is three new ledger entry types

`P2P_ESCROW` (negative), `P2P_WON` (the whole pot, positive) and `P2P_REFUND` (a stake back,
positive). All three always move `CREDITS`.

This does not contradict [D34](../decisions.md#d34--currency-is-a-dimension-on-the-existing-ledger-not-a-second-ledger)'s
"no new entry types". D34 refused to double the enum along the _currency_ axis, because a
`BET_WON` means precisely the same thing in either denomination. Escrow is a genuinely new
movement — value leaving a balance to sit in a pot owned by nobody — and it has no existing
name.

`ledger_entries` gains one nullable `p2p_wager_id` beside the existing `bet_id`, so the
transaction history on `/me` renders "wager vs. Dana" rather than an unattributed line.

### 3. Market-backed grading is the grading that already exists

The offerer holds the selection; the acceptor holds its negation. So a verdict is a four-case
mapping over a leg status the engine already computes:

```ts
export function verdictForLegStatus(status: 'WON' | 'LOST' | 'PUSHED' | 'VOIDED'): Verdict {
  if (status === 'WON') return 'OFFERER';
  if (status === 'LOST') return 'ACCEPTOR';
  return 'VOID'; // PUSHED or VOIDED — refund both
}
```

No new grading logic enters the system. `gradeLeg` grades a wager on an NFL spread and
`gradeCustomLeg` grades one on a custom market, both unmodified, both still pure.

A market-backed wager freezes `line_at_offer` at the moment the offer is posted, for exactly
the reason `bet_legs` freezes `line_at_placement`
([D10](../decisions.md#d10--legs-freeze-their-line-and-price-at-placement)): line movement
between the offer and the game must not retroactively change what was agreed. There is no
price to freeze, because there is no price
([D41](../decisions.md#d41--a-wager-is-two-explicit-stakes-not-a-stake-and-a-price)).

### Layering rule, restated

Every verdict is a stored value before it is money. `verdict` is written, then the pot moves —
never the other way around. That keeps the payout a pure function of the row, which is what
lets an admin correction re-derive it later without re-litigating how the original was
computed.

## Data model

### `p2p_wagers`

```ts
export const p2pWagerKind = pgEnum('p2p_wager_kind', ['MARKET', 'FREEFORM']);
export const p2pWagerStatus = pgEnum('p2p_wager_status', [
  'OFFERED',
  'ACCEPTED',
  'SETTLED',
  'VOIDED',
  'CANCELED',
  'EXPIRED',
]);
export const p2pVerdict = pgEnum('p2p_verdict', ['OFFERER', 'ACCEPTOR', 'VOID']);
```

| Column                                    | Type                              | Notes                                                                                                             |
| ----------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`                                      | uuid pk                           |                                                                                                                   |
| `season_id`                               | uuid → `seasons`                  | the visibility boundary, as everywhere else ([D21](../decisions.md#d21--no-social-graph-the-season-is-the-graph)) |
| `kind`                                    | `p2p_wager_kind`                  | `MARKET` or `FREEFORM`                                                                                            |
| `status`                                  | `p2p_wager_status`                | default `OFFERED`                                                                                                 |
| `offerer_membership_id`                   | uuid → `season_memberships`       |                                                                                                                   |
| `acceptor_membership_id`                  | uuid → `season_memberships`, null | null until accepted                                                                                               |
| `opponent_membership_id`                  | uuid → `season_memberships`, null | **null = open to the season**; set = a directed challenge                                                         |
| `offerer_stake_cents`                     | bigint                            |                                                                                                                   |
| `acceptor_stake_cents`                    | bigint                            |                                                                                                                   |
| `selection_id`                            | uuid → `selections`, null         | `MARKET` only                                                                                                     |
| `line_at_offer`                           | numeric(5,2), null                | frozen at offer, `MARKET` only                                                                                    |
| `description`                             | text, null                        | `FREEFORM` only                                                                                                   |
| `expires_at`                              | timestamptz                       | when an unaccepted offer dies                                                                                     |
| `resolves_by`                             | timestamptz                       | when a missing claim becomes overdue                                                                              |
| `offerer_claim`                           | `p2p_verdict`, null               | who the offerer says won                                                                                          |
| `acceptor_claim`                          | `p2p_verdict`, null               | who the acceptor says won                                                                                         |
| `offerer_cancel_proposed`                 | boolean                           | mutual-cancel half-signal                                                                                         |
| `acceptor_cancel_proposed`                | boolean                           | mutual-cancel half-signal                                                                                         |
| `verdict`                                 | `p2p_verdict`, null               | the final answer                                                                                                  |
| `settlement_attempts`                     | integer                           | plays `bets.settlement_attempts`' exact role                                                                      |
| `resolved_by_user_id`                     | uuid → `users`, null              | set only on admin arbitration                                                                                     |
| `resolution_note`                         | text, null                        | mandatory on arbitration                                                                                          |
| `accepted_at`, `settled_at`, `created_at` | timestamptz                       |                                                                                                                   |

A CHECK constraint enforces the discriminator: `MARKET` requires `selection_id` and forbids
`description`; `FREEFORM` requires `description` and forbids `selection_id`. Both stakes must
be positive.

Indexes:

```
p2p_wagers_season_status_idx    (season_id, status)
p2p_wagers_offerer_idx          (offerer_membership_id)
p2p_wagers_acceptor_idx         (acceptor_membership_id)
p2p_wagers_selection_idx        (selection_id)
p2p_wagers_open_idx             (expires_at)  WHERE status = 'OFFERED'
p2p_wagers_live_idx             (resolves_by) WHERE status = 'ACCEPTED'
```

The two partial indexes exist for the same reason `bet_legs_pending_idx` and
`custom_events_overdue_idx` do: the sweep runs every ten minutes forever and must not scan the
settled bulk of the table.

### What is deliberately _not_ a column

**There is no `DISPUTED` status and no `OVERDUE` status.** Both are predicates over an
`ACCEPTED` row:

```ts
isDisputed(w) =
  w.offererClaim !== null && w.acceptorClaim !== null && w.offererClaim !== w.acceptorClaim;
isOverdue(w, now) = w.resolvesBy < now && !agreed(w);
```

This is [D37](../decisions.md#d37--events-carry-a-resolve-by-date-overdue-is-derived-and-swept-to-admins)
applied a second time, and generalized by
[D44](../decisions.md#d44--dispute-and-overdue-are-derived-predicates-not-stored-statuses):
a stored flag is a third state that can disagree with the columns it summarizes, and it needs
a job to maintain.

**There is no `p2p_claims` table.** There are exactly two parties, forever. A table would
model zero-or-many, which is not a shape this domain has. Two nullable columns say precisely
what is true.

**There is no `pot_cents` column.** The pot is `offerer_stake_cents + acceptor_stake_cents`,
computed by a pure `potCents()`. A stored total is a second place for the same fact to live.

### `ledger_entries`

One new nullable column, `p2p_wager_id uuid REFERENCES p2p_wagers(id)`, and three new
`ledger_entry_type` values. Nothing else changes — `postEntry` already takes an arbitrary
type, an arbitrary currency, and an idempotency key.

## Money

### Idempotency keys

```
p2p:{wagerId}:escrow:offerer
p2p:{wagerId}:escrow:acceptor
p2p:{wagerId}:settled:{attempt}:won
p2p:{wagerId}:settled:{attempt}:refund:{membershipId}
p2p:{wagerId}:reversal:{attempt}:{membershipId}
```

`{attempt}` is `settlement_attempts` at the time of writing, exactly as
`bet:{betId}:settled:{n}` uses `bets.settlement_attempts`. An admin correction therefore
cannot collide with the payout it is correcting
([D15](../decisions.md#d15--corrections-write-reversing-entries-history-is-never-edited)).

### Where credits go

| Moment                                | Entries written                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Offer posted                          | `P2P_ESCROW` −offerer stake                                                                        |
| Offer accepted                        | `P2P_ESCROW` −acceptor stake                                                                       |
| Offer canceled or expired             | `P2P_REFUND` +offerer stake                                                                        |
| Settled, verdict `OFFERER`/`ACCEPTOR` | `P2P_WON` +pot to the winner                                                                       |
| Settled, verdict `VOID`               | `P2P_REFUND` +each stake to its owner                                                              |
| Admin correction                      | `SETTLEMENT_REVERSAL` reversing every entry from the prior attempt, then the new attempt's entries |

### The new invariant, and the check that proves it

Until this subsystem, every credit was in exactly one member's balance at every instant, and
`reconcileBalances` proved it by comparing each cached balance against the sum of its own
ledger entries. Escrow breaks that: credits sitting in a live pot have left a balance and
arrived nowhere.

`reconcileBalances` itself stays correct and unchanged — a member's cache and their ledger sum
still agree, both already net of escrow. What is no longer implied is that the _system_ total
is conserved. So a second check runs beside it in the same `reconcile` cron:

```ts
export interface EscrowDiscrepancy {
  wagerId: string;
  expectedHeldCents: bigint; // from the wager's own stakes and status
  actualHeldCents: bigint; // escrow entries minus payouts and refunds
}

export async function reconcileEscrow(): Promise<EscrowDiscrepancy[]>;
```

For every wager it asserts that the credits the ledger has locked against that wager equal
what its status says should be locked: one stake while `OFFERED`, both while `ACCEPTED`, zero
once `SETTLED`, `VOIDED`, `CANCELED` or `EXPIRED`. A wager that escrowed and never paid out is
exactly the bug this catches, and it is invisible to `reconcileBalances`
([D43](../decisions.md#d43--escrow-needs-its-own-reconciliation-check-balance-reconciliation-cannot-see-it)).

The README's first stated property — every simulated dollar is accounted for — is what this
check keeps true.

## Lifecycle

```
                     cancelOffer / expiry sweep
         ┌──────────────── refund offerer ───────────────┐
         │                                               ▼
    [OFFERED] ──accept──▶ [ACCEPTED] ─────────▶ [SETTLED]    CANCELED / EXPIRED
  escrow offerer        escrow acceptor       pot → winner
                             │
                             ├─ both claims agree ──────▶ settle
                             ├─ claims disagree ────────▶ (derived) disputed → admin
                             ├─ past resolves_by ───────▶ (derived) overdue  → admin
                             ├─ both propose cancel ────▶ [VOIDED] refund both
                             └─ market result arrives ──▶ settle, or [VOIDED]
```

### Offering

`offerWager` validates the terms, writes the row, escrows the offerer's stake and emits one
`P2P_OFFERED` card, all in one transaction. A directed offer names an `opponent_membership_id`;
an open offer leaves it null.

Escrowing at offer rather than at acceptance is a deliberate departure from what the roadmap
assumed, recorded as
[D46](../decisions.md#d46--the-offerers-stake-escrows-at-offer-not-at-acceptance). Once offers
can sit open, an offerer with 1,000 credits could otherwise post five 1,000-credit offers, four
of which are promises they cannot keep. Escrow at offer makes a live offer _always good_: an
acceptance can never fail because of the offerer's balance.

Validation rejects: a stake ≤ 0, a stake exceeding the offerer's credits, an opponent who is
the offerer, an opponent outside the season, an `expires_at` in the past or after the
underlying event starts, a `resolves_by` before `expires_at`, a `MARKET` wager whose selection
belongs to a suspended market or an event that has already started, and a `FREEFORM` wager
with an empty description.

### Accepting

`acceptWager` takes `SELECT ... FOR UPDATE` on the wager row, re-checks `status = 'OFFERED'`,
re-checks expiry against `now`, checks the acceptor is permitted (the named opponent, or anyone
but the offerer when open), escrows their stake, sets `acceptor_membership_id` and
`accepted_at`, and emits `P2P_ACCEPTED`.

The lock plus the status re-check is what makes an open offer accepted by exactly one member.
It is the same pattern `resolveCustomEvent` uses to serialize two people hitting Resolve.

`declineWager` exists only for a directed offer and only for the named opponent. It sets
`CANCELED` and refunds. Declining is not the same as ignoring — an ignored offer expires.

### Claiming

Resolution of a freeform wager is symmetric — this is the one place subsystem 4 deliberately
does not copy subsystem 3's creator-resolves model
([D47](../decisions.md#d47--a-freeform-wager-is-settled-by-both-parties-agreeing-with-admins-as-the-fallback)).

`claimWinner(wagerId, actorMembershipId, verdict)` writes the caller's own claim column and
then decides, inside the same transaction:

- **Both claims set and equal** → that is the verdict; settle immediately.
- **Both claims set and unequal** → emit `P2P_DISPUTED`. No status change; the row is disputed
  by derivation and appears in the admin queue.
- **Only one claim set** → nothing else happens. The other party sees it awaiting them.

A party may overwrite their own claim while the wager is still unsettled — changing your mind
before it is resolved is honest, and the alternative is a locked-in mistake requiring an admin.
A claim can never be written by a non-party, and never after `SETTLED`.

`VOID` is a legitimate claim: two members who agree the bet was unresolvable settle it
themselves as a mutual refund without an admin.

### Mutual cancel

`proposeCancel` sets the caller's `*_cancel_proposed` flag. When both are set, the wager voids
and both stakes are refunded. One flag alone does nothing — unilateral cancellation after
acceptance is losing without paying, and it is not offered.

### Market-backed settlement

`sweepP2PWagers` runs inside the existing `settle` cron route, after `settleFinalGames` and
beside `sweepOverdueEvents` — no new schedule and no cursor, for the reason
[D37](../decisions.md#d37--events-carry-a-resolve-by-date-overdue-is-derived-and-swept-to-admins)
gives. It performs three passes:

1. **Expire.** `OFFERED` wagers past `expires_at` → refund the offerer, status `EXPIRED`.
2. **Settle.** `ACCEPTED` `MARKET` wagers whose underlying result has arrived:
   - game `FINAL` → `gradeLeg` with `line_at_offer` → `verdictForLegStatus`
   - custom market `SETTLED` → `gradeCustomLeg` → `verdictForLegStatus`
   - game `CANCELED` or `POSTPONED`, or custom event `VOIDED` → verdict `VOID`
3. **Flag overdue.** `ACCEPTED` wagers past `resolves_by` without an agreed verdict → one
   `P2P_OVERDUE`-carrying admin queue entry, announced once via a dedupe-keyed feed card.

Each wager settles in its own transaction, so one failure cannot roll back the rest — the same
resumability discipline `settleFinalGames` follows for
[D3](../decisions.md#d3--stack-single-nextjs-app-on-postgres)'s invocation limit.

A `FREEFORM` wager is never settled by the sweep. Only people settle those.

### Arbitration

`arbitrateWager` is admin-only and takes a verdict plus a **mandatory** note. It handles both
cases:

- **Not yet settled** → write the verdict, pay the pot (or refund on `VOID`), attempt 1.
- **Already settled** → increment `settlement_attempts`, write `SETTLEMENT_REVERSAL` entries
  undoing every entry from the prior attempt, then write the corrected payout.

The second case is [D15](../decisions.md#d15--corrections-write-reversing-entries-history-is-never-edited)
reused whole, and it is the same shape `resettleBet` and a disputed
`resolveCustomEvent` already run. History is never edited.

## Head-to-head

`computeHeadToHead(wagers, memberA, memberB)` is pure and takes rows in, statistics out:

```ts
export interface HeadToHead {
  settled: number;
  aWon: number;
  bWon: number;
  voided: number;
  /** Positive means A is up on B, in credits. */
  netCentsForA: bigint;
}
```

Only `SETTLED` and `VOIDED` wagers count. `CANCELED` and `EXPIRED` never happened. Nothing is
stored — there is no counter to drift out of agreement with the rows, which is exactly why
subsystem 2's `computeMemberStats` derives profile statistics at read time rather than
maintaining them.

Head-to-head is defined over peer-to-peer wagers **only**
([D48](../decisions.md#d48--head-to-head-is-the-peer-to-peer-record-and-nothing-else)). Opposed
positions on the same house line — two members on either side of one spread — are deliberately
not folded in, exactly as [D27](../decisions.md#d27--head-to-head-is-deferred-to-subsystem-4)
anticipated: one number built from two unrelated things is worse than one number that means what
it says.

## Feed

Five new `feed_event_type` values:

| Type           | Subject                          | Dedupe key                    |
| -------------- | -------------------------------- | ----------------------------- |
| `P2P_OFFERED`  | offerer                          | `p2p:{id}:offered`            |
| `P2P_ACCEPTED` | acceptor                         | `p2p:{id}:accepted`           |
| `P2P_SETTLED`  | winner, or offerer on `VOID`     | `p2p:{id}:settled:{attempt}`  |
| `P2P_DISPUTED` | the party who claimed second     | `p2p:{id}:disputed:{attempt}` |
| `P2P_VOIDED`   | none — a void is about the wager | `p2p:{id}:voided:{attempt}`   |

Payloads follow the existing conventions exactly: money is a decimal string
([D25](../decisions.md#d25--money-inside-a-feed-payload-is-a-decimal-string)), facts freeze and
identity does not — display names are joined live from `users` at read time, never copied into
the payload.

An offer posts publicly even when it is directed at one member.
[D22](../decisions.md#d22--bets-are-public-the-moment-they-are-placed) already settled that
bets are public the moment they are made, and a challenge issued in front of the league is most
of the appeal.

**A cancellation or an expiry posts no card.** A withdrawn or ignored offer is a non-event, and
twelve members abandoning offers would bury everything anyone wants to read — the same instinct
[D26](../decisions.md#d26--allowance-posts-one-aggregated-card-per-week) applied to the weekly
allowance. Both remain visible on the wager itself and in the offerer's ledger.

Reactions and comments come for free: they attach to `feed_events`, and these are feed events.

## Screens

**No seventh bottom tab.** `src/components/ui/tab-bar.tsx` already documents the fallback for
exactly this moment — a segmented control rather than another tab — so `/bets` gains a
**Bets | Wagers** toggle, which is also where a member would look for them.

| Route                     | Contents                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/bets`                   | existing bets list, plus a Bets \| Wagers segmented control                                                                    |
| `/wagers`                 | four sections: open offers, offers directed at you, your live wagers, and awaiting your claim                                  |
| `/wagers/new`             | kind toggle; opponent picker or "open to the season"; both stakes; selection picker or description; expiry and resolve-by      |
| `/wagers/[wagerId]`       | terms, status, the counterparty, and whichever of accept / decline / cancel / claim / propose-cancel the viewer is entitled to |
| `/admin/wagers`           | the two derived queues — disputed and overdue — with the arbitration form                                                      |
| `/members/[membershipId]` | gains a head-to-head block against the viewing member                                                                          |

Every action is authorized server-side through `requireApprovedMemberOrThrow` or
`requireAdmin`, never by hiding UI. A member who is not a party to a wager can read it — the
season is the visibility boundary — but every mutation checks membership against the row.

## Failure handling

| Failure                                            | Handling                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Two members accept one open offer at once          | Row lock plus `status = 'OFFERED'` re-check; the loser gets `WAGER_NOT_OPEN`                  |
| Accept races the expiry sweep                      | Same lock; whichever commits first wins, the other sees the moved status                      |
| Both parties claim simultaneously                  | Row lock; the second write sees the first claim and deterministically agrees or disputes      |
| Offerer's credits spent between offer and accept   | Impossible — the stake is already escrowed                                                    |
| Cron invocation times out mid-sweep                | Each wager settles in its own transaction; the next run resumes                               |
| Sweep runs twice                                   | Idempotency keys make every duplicate write a no-op                                           |
| Underlying game postponed after acceptance         | Sweep sees the status and voids the wager, refunding both                                     |
| Custom event voided after a wager on it            | Same path — verdict `VOID`                                                                    |
| Admin arbitrates a wager the sweep already settled | `settlement_attempts` increments; reversal entries undo attempt 1 before attempt 2 is written |
| Escrow written but payout never made               | `reconcileEscrow` reports it on the next daily run                                            |

## Testing

Following the shape subsystems 1–3 established.

**Pure, no database** — `src/domain/__tests__/p2p.test.ts`: `verdictForLegStatus` over all four
statuses, `isDisputed` and `isOverdue` across every claim combination, `potCents` including
asymmetric stakes, and `computeHeadToHead` over settled, voided, canceled and expired mixtures.

**Services, against Postgres** — one test file per service. Offer validation and escrow;
acceptance including the permitted-acceptor matrix; the double-accept race driven by two
concurrent transactions; claim agreement, disagreement, and overwrite; mutual cancel requiring
both flags; the sweep's three passes; arbitration in both the fresh and the correcting case;
and idempotency for every one of them — replaying a call must write no second ledger entry and
no second feed card.

**Money integrity** — a dedicated `reconcileEscrow` test that deliberately writes an escrow
with no payout and asserts the discrepancy is reported, plus a test asserting a fully settled
season reports none.

**End-to-end** — one arc in `src/server/__tests__/end-to-end.test.ts` mirroring the
custom-event arc: offer → accept → conflicting claims → dispute card → admin arbitration →
reversal and corrected payout → both balances and both reconciliation checks clean.

## Open questions carried forward

None blocking. Two noted for a later pass:

- **Notifications.** A directed challenge is invisible until the opponent opens the app.
  Subsystem 2 declined real-time transport ([D29](../decisions.md#d29--no-real-time-transport-in-v1))
  and nothing here changes that argument, but P2P is the first feature where the absence is
  felt rather than merely noticed.
- **A wagers tab.** If the segmented control on `/bets` proves too buried in practice, the
  question of a seventh tab reopens — with the same answer the tab bar's own comment gives.
