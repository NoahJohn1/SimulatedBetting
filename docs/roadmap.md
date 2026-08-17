# Roadmap

The project is four independent subsystems. Each gets its own spec, plan, and build cycle.
Subsystems 1–3 are specified in full; subsystem 4 is captured here at the level of detail
needed to make sure the earlier subsystems don't paint us into a corner.

| # | Subsystem | Status |
|---|---|---|
| 1 | Core betting engine | [Built](specs/2026-08-14-core-betting-engine-design.md) — fixture odds only, no production deploy yet |
| 2 | Social layer | [Built](specs/2026-08-17-social-layer-design.md) |
| 3 | Custom events | [Specified](specs/2026-08-17-custom-events-design.md) — not built |
| 4 | Peer-to-peer bets | Roadmap only |

---

## 1. Core betting engine

NFL and CFB, real sportsbook lines, singles and parlays, seasons with a starting bankroll
and weekly allowance, automatic settlement, admin controls, and an immutable ledger.

See [the spec](specs/2026-08-14-core-betting-engine-design.md).

---

## 2. Social layer

**What it adds.** A friend or follow graph, an activity feed of what members just bet and
how it resolved, reactions on bets, and head-to-head records between members.

**Why it's cheap after subsystem 1.** Season membership already groups members, and every
bet and settlement is already recorded. This is largely read-model and UI work — no changes
to the money core.

**Its open questions are now answered** — see [the spec](specs/2026-08-17-social-layer-design.md).
Bets are visible at placement ([D22](decisions.md#d22--bets-are-public-the-moment-they-are-placed)).
There is no friend or follow graph after all; season membership is the visibility boundary
([D21](decisions.md#d21--no-social-graph-the-season-is-the-graph)), which also settles the
season-scoped-vs-global question in favor of season-scoped. Moderation is author-delete plus
admin-delete, with no queue ([D28](decisions.md#d28--reactions-hard-delete-comments-soft-delete)).
Head-to-head moved to subsystem 4, where it has an unambiguous meaning
([D27](decisions.md#d27--head-to-head-is-deferred-to-subsystem-4)).

---

## 3. Custom events

**What it adds.** Member-created betting markets for things no sportsbook covers — the
Jyxnzi Rainbow Six tournaments, for instance: who wins the tournament, individual match
winners, possibly player stat lines. A creator publishes an event with markets and prices,
members bet, and the creator resolves it.

**Why subsystem 1 is already compatible.** Bets reference a `selection`, never a `game`
([D11](decisions.md#d11--bets-reference-selections-never-games)). Adding custom events means
introducing an `event` supertype above `games` and pointing `markets` at it
([D33](decisions.md#d33--events-is-a-true-supertype-not-a-pair-of-nullable-foreign-keys)).
The ledger and the grading functions are genuinely untouched by it — but the design session
found one thing this framing understated: `placeBet` and `settleGame` both hard-join
`markets → games → teams` for bettability checks and for the frozen feed snapshot, so those
joins do have to become kind-aware. Confined and well-bounded, but not free.

**The hard part is not the data model — it's resolution.** Sports games settle from an
objective score feed. A custom event settles because a person says so.

**Its open questions are now answered** — see [the spec](specs/2026-08-17-custom-events-design.md).
Anyone can create events and creators may bet their own, disclosed rather than prohibited
([D32](decisions.md#d32--anyone-can-create-events-and-creators-may-bet-their-own-with-disclosure)).
There is no exposure cap, because custom events are bet in **credits** — a second, granted,
non-convertible currency that cannot touch the cash bankroll the standings are built on
([D31](decisions.md#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency),
[D38](decisions.md#d38--no-exposure-cap-on-hand-priced-markets)). Resolution pays immediately
and disputes are an admin re-resolution over the existing reversal path
([D35](decisions.md#d35--custom-events-pay-on-resolution-disputes-are-an-admin-re-resolution)).
An abandoned event surfaces through its own resolve-by date and is voided by an admin
([D37](decisions.md#d37--events-carry-a-resolve-by-date-overdue-is-derived-and-swept-to-admins)).
Creators cannot reprice placed bets, exactly as the roadmap expected — legs already freeze
their price ([D10](decisions.md#d10--legs-freeze-their-line-and-price-at-placement)), so this
needed no new mechanism.

---

## 4. Peer-to-peer bets

**What it adds.** A direct wager between two members over any game or event — one person
offers terms, the other accepts, and the winner takes the pot.

**How it works with the ledger.** Both stakes are escrowed as ledger entries at acceptance
(`P2P_ESCROW`), and resolution pays the winner (`P2P_WON`) or refunds both on a void. The
existing ledger design handles this without modification — escrow is just another entry
type.

**The hard part is disputes.** "We disagree about who won" is a social problem wearing a
technical costume. For bets tied to a real game, settlement can be automatic from the score
feed and there's nothing to argue about. For freeform bets ("I bet you Jake can't name ten
starting quarterbacks"), someone has to arbitrate. Admin arbitration is the obvious v1
answer.

**Open questions.** Can a P2P bet reference an arbitrary text description, or must it
attach to a market the system already knows how to grade? Is there an expiry on unaccepted
offers? Can a bet be canceled by mutual agreement after acceptance but before the event?

---

## Sequencing

Build order is 1 → 2 → 3 → 4, with one qualifier: subsystems 3 and 4 are independent of
each other, so whichever sounds more fun at the time can go first. Subsystem 2 should come
second regardless — a leaderboard with no feed gets boring quickly, and it is the cheapest
of the three to build.
