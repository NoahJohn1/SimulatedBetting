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
