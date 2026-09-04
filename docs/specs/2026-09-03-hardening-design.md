# Hardening — the cloud half — design

_Written 2026-09-03._

**The problem.** [The roadmap](../roadmap.md#9--hardening) calls phase 9 "the last mile before the
URL goes out." Four things stand between the app as it is and a link a person can be sent. Every
mutation in the app is unthrottled, so one runaway client loop or one impatient double-tap writes
as many ledger entries or feed rows as it can issue requests. Nothing anywhere tells a member that
this is play money, what the allowance is, or who rules on a disputed event — the rules exist only
in [`decisions.md`](../decisions.md), which is written for the people building the app, not the
people using it. The three screens a new member actually meets first
([`/pending`](../../src/app/pending/page.tsx), [`/join`](../../src/app/join/page.tsx),
[`/no-season`](../../src/app/no-season/page.tsx)) have never been looked at together, and two of
them are dead ends. And there is no written procedure for confirming a deploy works, so every
deploy is checked by remembering.

**The goal.** After this work, **a mutation storm costs one member one minute rather than the
ledger**, **a new member can read what they are joining before they join it**, **the path from
first sign-in to first bet is a sequence rather than four unrelated screens**, and **there is a
document to follow before a deploy** — one that is honest about being a draft until a person has
run it.

**Scope.** The four outstanding rows of phase 9. Load sanity, the fifth row, is already complete.

---

## 1. Scope

| #   | Item                              | Roadmap row                | Lane                                        |
| --- | --------------------------------- | -------------------------- | ------------------------------------------- |
| 1   | Rate limiting on mutations        | Rate limiting on mutations | [CLOUD]                                     |
| 2   | The house rules page              | A house rules page         | [CLOUD]                                     |
| 3   | The new-member path as a sequence | The new-member path        | [CLOUD]                                     |
| 4   | The smoke checklist               | A written smoke checklist  | [CLOUD] to draft · **[MANUAL]** to validate |

Items 2 and 3 are one problem wearing two hats, and this design treats them as one. The people who
most need "no real money, credits cannot become cash, here is who arbitrates" are sitting on
`/pending` and `/join` — which are outside the `(app)` shell, so a rules page inside the shell is
invisible to exactly its most important audience. The rules page is the missing footer link that
turns four dead ends into a sequence.

### Three corrections to the brief that commissioned this

**The decision log is at D68, not D56.** D57 landed with the Dependabot-majors record, D58–D62
with the production-deployment work, and D63–D68 with the phase 8 email-notification design that
was written in parallel with this one and merged alongside it. This design's entries are
**D69–D73** — they were drafted as D63–D67 and renumbered when the two designs were merged, since
phase 8 took the earlier block. This is the same correction the phase 6 spec had to make — the
number in a brief is a snapshot, and the log moves.

**Load sanity is complete, not deferred.** The brief scopes it out as `[LOCAL]` work needing a
database. [The roadmap](../roadmap.md#9--hardening) records it as ✅ done on 2026-09-03 from a
cloud session: a real 300-game NFL+NCAAF board, 1,500 bets, 1,703 feed events, 178 settlements,
`getSeasonFeed` at 10–19ms throughout, and one finding that turned out to be a stale planner
statistic rather than a missing index. It is not re-scoped here; it is closed.

**`npm test` runs in a cloud session now.** The brief says it cannot, which was true on 2026-09-02
and is not true today — the `session-start` hook's native-Postgres fallback
([repo-health 3.7](../repo-health.md#37-postgres-without-docker-in-a-cloud-session)) brings up a
real database with no Docker daemon involved. Measured in the session that wrote this document.

### Measurements this design rests on

Taken 2026-09-03 in the cloud session that wrote this document.

| Claim                                  | Measured                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `node_modules` on session start        | Present — the `session-start` hook installs it before the first turn                                                                  |
| Docker                                 | No daemon, as before. Postgres is native, and both databases are migrated                                                             |
| `npm test`                             | **86 files / 925 tests pass, 80s.** The whole suite, DB-backed tests included                                                         |
| `npm run typecheck` / `lint` / `build` | All run in a cloud session                                                                                                            |
| Decision log                           | Ends at **D68**, so this design's entries are D69–D73                                                                                 |
| Existing rate limiting                 | None. No `middleware.ts` exists; no mutation path counts anything                                                                     |
| Mutation surface                       | 6 action files, 19 exported `*Action` functions (18 of them mutating), plus 5 inline `'use server'` blocks in page files              |
| Client error rendering                 | Eight `switch (error.code)` maps and one `ERRORS[]` lookup, each with a fallback. One path — reactions — discards the result entirely |
| Prune precedent                        | `pruneJobRuns` runs inside `reconcile`'s handler in its own try/catch ([route.ts:57](../../src/app/api/cron/reconcile/route.ts))      |
| Gate screens                           | Four, not three — `/disabled` is routed to by the same `requireApprovedMember` switch                                                 |
| Gate screens exporting `metadata`      | Zero of four                                                                                                                          |

---

## 2. Rate limiting

### 2.1 Architecture

One new server directory, `src/server/limits/`. Three modules, one job each.

| Module              | Exports                                           | Depends on                    |
| ------------------- | ------------------------------------------------- | ----------------------------- |
| `limits/policy.ts`  | `BUCKETS`, `Bucket`, `windowStartFor`, `decide`   | nothing                       |
| `limits/consume.ts` | `consume(subjectId, bucket)`, `pruneRateLimits()` | `db`, `rate_limits`, `policy` |
| `limits/types.ts`   | `RateLimited`, `isRateLimited`                    | nothing                       |

`policy.ts` is split out of `consume.ts` for the same reason `alert-policy.ts` was split out of
`job-runs.ts` in phase 6: it is the piece most likely to be wrong and the piece that can be proven
without a database anywhere in its import graph.

### 2.2 The table

```
rate_limits
  subject_id    uuid         not null   -- the session's user id
  bucket        text         not null
  window_start  timestamptz  not null
  count         integer      not null default 0
  primary key (subject_id, bucket, window_start)
```

`subject_id` is the **user id from the session**, never an IP and never anything the client sends.
Every mutation in this app is behind Google OAuth and an admin approval; there is no anonymous
mutation surface to protect, and an IP-keyed limiter would throttle two members on one home
network as if they were one person.

`bucket` is `text` rather than a `pgEnum`. The enum would need a migration every time a bucket is
added, and unlike `job_name` — which the health page reads and renders — nothing outside
`policy.ts` interprets this column. The `Bucket` union in `policy.ts` is the type authority.

**No foreign key to `users`.** A limiter row is a counter, not a record; a cascade delete on a
user removing rate-limit history is noise, and the counter must keep working during any moment the
users table is locked.

### 2.3 Consuming

One statement. No read-then-write, so no race between instances:

```sql
INSERT INTO rate_limits (subject_id, bucket, window_start, count)
VALUES ($1, $2, $3, 1)
ON CONFLICT (subject_id, bucket, window_start)
DO UPDATE SET count = rate_limits.count + 1
RETURNING count
```

`window_start` is computed in TypeScript — `floor(now / windowMs) * windowMs` — so the arithmetic
lives in the pure module and is testable without a database. `decide(count, limit)` returns
`{ allowed: true }` or `{ allowed: false, retryAfterSeconds }`, where `retryAfterSeconds` is the
remainder of the current window.

This is a **fixed window**, not a sliding one. _Accepted:_ a member can issue up to 2× a bucket's
limit across a window boundary. At 10 bets a minute that is 20 bets in a two-second straddle, which
is not a failure this design cares about. A sliding-window log is one row per hit plus a pruning
problem, to buy precision that nothing here needs.

### 2.4 The buckets

| Bucket         | Actions                                                                      | Limit    |
| -------------- | ---------------------------------------------------------------------------- | -------- |
| `BET_PLACE`    | `placeBetAction`                                                             | 10 / min |
| `P2P_OFFER`    | `offerWagerAction`                                                           | 10 / min |
| `P2P_RESPOND`  | `acceptWager`, `declineWager`, `cancelOffer`, `claimWinner`, `proposeCancel` | 20 / min |
| `EVENT_WRITE`  | `createEvent`, `editEvent`, `suspendMarket`, `resolveEvent`, `disputeEvent`  | 10 / min |
| `COMMENT`      | `addComment`, `deleteComment`                                                | 10 / min |
| `REACTION`     | `toggleReaction`                                                             | 30 / min |
| `ADMIN_ACTION` | `arbitrateWagerAction`, `voidEventAction`, `/admin`'s inline `setStatus`     | 30 / min |
| `DEFAULT`      | `saveFeedPreferencesAction`, `joinSeasonAction`, any future mutating action  | 30 / min |

**One window per bucket, minute-scale. No hourly tier.** The threat model is a runaway client loop
or a double-tap storm, not an adversary — the roadmap says so itself ("small group, low risk, but
every one of these writes to the ledger or the feed"). A member spamming steadily for an hour in a
four-person private group is a social problem with a social fix, and an hourly tier doubles the
query count on every mutation to address it.

Admins are **rate limited, not exempt**. Arbitration is rare enough that 30/min is invisible, and
the failure this guards against — a component re-rendering in a loop and firing its action each
time — does not care what role the session holds.

**One surface is out of reach by construction.** The limiter keys on the session's user id, so an
action that runs _before_ there is a session cannot be keyed at all. That is exactly one action:
`signIn` on [`/sign-in`](../../src/app/sign-in/page.tsx). Google and NextAuth own the rate of
sign-in attempts, and this design does not pretend otherwise.

### 2.5 The four money invariants

Reviewed against the [`money-invariants`](../../.claude/skills/money-invariants/SKILL.md) skill
before any of this was designed.

**1 — The ledger is append-only.** The limiter writes no ledger entry, reads none, and adds no
correction path. `src/server/money/` gets zero diff, and
`src/server/money/__tests__/ledger-funnel.test.ts` is unaffected.

**2 — Deterministic idempotency keys.** Untouched. `placeBet` still dedupes on the client's
`clientRequestId` and still derives `bet:<id>:placed` from the inserted row. The one interaction
worth naming: a retry of an already-submitted `clientRequestId` that trips the limiter reads
`RATE_LIMITED` where it would previously have read `DUPLICATE_REQUEST`. That is a worse message,
not a worse outcome — no second bet exists either way.

**3 — The balance cache is written in the same transaction as its entry.** The rule that protects
this: **the limiter never receives a `tx` handle, and never runs inside `db.transaction`.** It
consumes in its own transaction, before the money transaction opens. Were it inside, a limiter row
conflict could abort a money write that had already been decided, and a money rollback would
silently refund a token. The guard test in §2.7 does not enforce this; a comment on `consume`'s
signature states it and code review is the layer that holds it
([repo-health 3.2](../repo-health.md#32-the-layering-rule) — this is a convention with one call
shape, not a pattern a test can see).

**4 — Escrow needs its own reconciliation.** `offerWagerAction` escrows the offerer's stake at
offer time ([D46](../decisions.md#d46--the-offerers-stake-escrows-at-offer-not-at-acceptance)). The
limiter runs before it and outside its transaction, so a consumed token with no escrow is possible
and a created escrow with no token is not. That is the safe direction: the failure is a member
losing one of ten offers a minute, not credits sitting in a pot nothing reconciles.

**Currency correctness.** No path added here reads, compares, or moves an amount. Cash and credits
are not mentioned in `src/server/limits/`.

### 2.6 Fail open

If the `rate_limits` statement throws, `consume` logs, reports to Sentry, and returns
`{ allowed: true }`.

The thing being protected against is a nuisance. Making the guard against a nuisance a hard
dependency in front of bet placement means one bad index, one connection-pool exhaustion, or one
migration mid-deploy takes the whole app's ability to act with it. Phase 6 settled this shape
already for alerting — "alerting can never be the outage" was a global constraint of that plan —
and the same reasoning applies with more force here, because unlike an alert, this sits in the
request path of every mutation a member makes.

### 2.7 Surfacing the rejection

A shared type, in `src/server/limits/types.ts`:

```ts
export interface RateLimited {
  code: 'RATE_LIMITED';
  retryAfterSeconds: number;
}
```

**The domain error unions are not touched.** `PlaceBetError` in
[`src/server/bets/types.ts`](../../src/server/bets/types.ts), `OfferWagerError`, `ManageError`,
`ResolveError` and `FeedErrorCode` all stay exactly as they are. Each _action_ widens its own
return type instead — `Promise<PlaceBetResult | { ok: false; error: RateLimited }>`.

Two properties fall out of that. `src/server/bets/`, `src/server/p2p/` and `src/server/money/` get
no diff at all, so the `money-touch` PostToolUse hook
([D56](../decisions.md#d56--the-money-path-hook-is-a-flag-not-a-review)) never fires for this work
and the money-invariants review above is the whole of it. And the services stay callable
unthrottled from cron routes, `seed.ts`, `bootstrap-season.ts` and the test suite — the load-sanity
script that drove 1,500 bets through `placeBet` directly would still run today.

Nine client renderers surface these errors — eight `switch (error.code)` maps and the `ERRORS[]`
lookup in [`comment-thread.tsx`](<../../src/app/(app)/feed/[eventId]/comment-thread.tsx>). Each gets
an explicit `RATE_LIMITED` case rendering "You're doing that too quickly. Try again in N seconds."
Every one already has a fallback arm, so a renderer missed by mistake degrades to its generic
message rather than crashing — but none are missed.

**One path needs more than a message.** `toggleReactionAction` is called from
[`feed-list.tsx:78`](<../../src/app/(app)/feed/feed-list.tsx>) inside a transition that applies an
optimistic update first and then **discards the action's return value entirely** — there is no
result check on that call today. Left alone, a refused reaction would leave the card showing a
reaction that was never written, until something else refreshed the feed. So the reaction handler
gains the one thing it is missing: it reads the result and rolls the optimistic update back when
the action did not succeed.

That is a pre-existing gap this work is obliged to close rather than one it creates — the same
handler would already swallow a `WRONG_SEASON` or an `EVENT_NOT_FOUND`. Rate limiting is simply the
first error that will actually happen in normal use.

### 2.8 The guard test

`src/app/__tests__/mutation-limits.test.ts`, in the shape this repo already uses for conventions
it refuses to leave to memory ([D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness),
`token-lint.test.ts`, `route-conventions.test.ts`, `ledger-funnel.test.ts`):

Read every file under `src/app` containing `'use server'` and collect two populations:

1. Exported `async function`s whose name ends in `Action` — the six action files.
2. **Inline `'use server'` blocks inside page files.** There are five today, and a filter that
   looked only for `*Action` exports would miss every one of them — including `/admin`'s
   `setStatus`, which approves and disables members. The narrower test would have passed while
   leaving the app's most consequential mutation unlimited, which is the kind of green that is
   worse than red.

Assert each member of both populations either calls `consume(` or appears in an `UNLIMITED` array
with a comment saying why. Assert that array's length is what it is, so adding to it is a
deliberate edit rather than a silent one.

Today's exemptions are three: `loadMoreFeedAction`, which paginates and writes nothing; and the two
inline `signOut` forms on `/me` and `/pending`, which end a session and touch neither the ledger nor
the feed. `signIn` on `/sign-in` is a fourth, exempt for the structural reason given in §2.4 rather
than because it is harmless.

This is the layering rule applied without being asked: "every mutation carries a limit" could be a
code-review habit, so it is a test instead.

### 2.9 Pruning

`pruneRateLimits()` deletes rows whose `window_start` is older than an hour, called from the daily
`reconcile` route beside `pruneJobRuns`, inside its own try/catch, exactly as that one is. Four
members × eight buckets × 1,440 windows a day is a ceiling of about 46,000 rows a day before
pruning and, realistically, three orders of magnitude less — the prune is hygiene, not a
requirement.

**Not the sync routes.** `reconcile` is the daily job and is untouched by the ESPN adapter work;
`src/server/odds/` and `src/app/api/cron/sync-odds/route.ts` are not read, edited, or imported
anywhere in this design.

---

## 3. The new-member path

### 3.1 What reading the four screens together found

There are **four**, not three. [`/disabled`](../../src/app/disabled/page.tsx) is reached by the
same `requireApprovedMember` switch in
[`src/server/auth/session.ts`](../../src/server/auth/session.ts) that reaches the other three, and
the roadmap's three-screen framing misses it.

| #   | Finding                                                                                                                                                           | Severity                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | `/no-season` and `/disabled` offer **no control at all** — no sign-out, no link, nothing. A member landing there can only close the tab                           | The one real bug                    |
| 2   | Four hand-rolled copies of the same `flex min-h-dvh flex-col items-center justify-center` block, with `/pending` and `/join` on `gap-8` and the other two on none | Drift, and the cause of 1           |
| 3   | `/join` calls `joinSeason` in an inline server action with **no try/catch and no pending state**                                                                  | UX gap, not a money bug — see below |
| 4   | **None of the four exports `metadata`**, so all four browser tabs read "SimulatedBetting"                                                                         | Small, and invisible to the gate    |
| 5   | Nothing signals **where you are in the sequence** — "Waiting for approval" could be step 1 of 5                                                                   | The framing the roadmap asks for    |
| 6   | `/pending` has **no way to re-check**. Approval happens elsewhere and the screen never updates                                                                    | Needs one button                    |
| 7   | Nothing anywhere links to the house rules, because there are none                                                                                                 | Closed by §4                        |

On finding 3, precisely: `joinSeason` is **idempotent** — it reuses an existing membership and
posts on the deterministic key `grant:<membershipId>`
([service.ts:69](../../src/server/seasons/service.ts)) — so a double-submit grants nobody a second
bankroll. Invariant 2 holds and this is not a money bug. What is missing is the handling of the
one case that does throw: a season that ended between render and submit, which today lands the
member in `app/error.tsx` with a digest and no way back. Worth stating carefully rather than
overstating.

Finding 3 is also **invisible to the existing gate**. `route-conventions.test.ts`'s pending-state
assertion only inspects files containing `useTransition`; an inline `<form action={...}>` server
action is not covered by it.

### 3.2 The shape

One new component, `src/components/ui/gate-screen.tsx`:

```ts
{ title, body, step?: { current: number; total: number }, children?, footer? }
```

`children` is the primary control; `footer` carries the rules link and, where there is a session,
sign-out. All four routes rebuild on it. Each gains a `metadata.title`. `/join`'s inline submit
becomes a real `joinSeasonAction` in `src/app/join/actions.ts` with a typed error and a pending
state — which is also what puts it inside §2.8's `DEFAULT` bucket instead of outside the guard. `/pending` gains a "Check again" button — the
`redirect` already at the top of that file does the rest of the work, so the control is a form that
posts to the same route.

**Not `StatusScreen`.** Its doc comment documents a specific contract — `min-h-[60vh]`, sized to
render _inside_ the shell where a header and tab bar are already taking space. Gate screens are
full-viewport, have no shell, and need a footer slot. Widening `StatusScreen` with a variant prop
would make one component answer to two contracts and would falsify its own comment.

The sequence, made explicit by `step`: sign in → **1** waiting for approval → **2** join the season
→ the app. `/no-season` and `/disabled` are branches off it and carry no step number, because
neither is a stage anyone progresses through.

A `src/app/__tests__/gate-screens.test.ts` asserts all four routes import `GateScreen` and export
`metadata`, in the same structural style as §2.8.

---

## 4. The house rules page

`src/app/rules/page.tsx` — **root level, outside the `(app)` shell, no session required.**

Reachable from `/sign-in`, all four gate screens, and `/me`. A person deciding whether to hand over
a Google account can read what they are joining; a member waiting on approval can read it while
they wait; a full member can find it from Me. One page, one copy of the rules.

Public does not mean crawlable — the root layout already sets `index: false`, asserted by
`route-conventions.test.ts`. And the loading-boundary test's "covers every page in the app"
assertion filters to pages under `(app)/`, so a root-level route needs no `loading.tsx` and the
gate stays green with no edit to that test.

**The figures are read from the active season**, falling back to
[`defaults.ts`](../../src/server/seasons/defaults.ts) when none is running — so the rules page and
`/join` cannot quote different numbers at the same person on the same day.

Sections, in plain language, with decision links for anyone who wants the reasoning:

| Section                        | What it says                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This is not real money         | Stated first and stated flatly. Nothing here can be bought, cashed out, or converted. It is not a feature gap                                                                                                                                                             |
| Two currencies                 | Cash for games, credits for member-made events and wagers ([D31](../decisions.md#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency), [D34](../decisions.md#d34--currency-is-a-dimension-on-the-existing-ledger-not-a-second-ledger))                |
| Why credits cannot become cash | Non-convertible by design, in both directions. No path in the app does it and none is coming                                                                                                                                                                              |
| The allowance                  | Starting bankroll and starting credits, the weekly top-up of each, and which day it lands                                                                                                                                                                                 |
| Betting                        | Real sportsbook lines; the price freezes when the bet is placed, so later line movement cannot change it; singles and parlays; finished games settle themselves                                                                                                           |
| Member-made events             | Anyone can post one; the creator resolves it; a resolution can be disputed ([D35](../decisions.md#d35--custom-events-pay-on-resolution-disputes-are-an-admin-re-resolution))                                                                                              |
| Wagers between members         | Two explicit stakes into a pot; both parties agree the winner, admins are the fallback ([D47](../decisions.md#d47--a-freeform-wager-is-settled-by-both-parties-agreeing-with-admins-as-the-fallback))                                                                     |
| Who arbitrates, and how        | Admins. What a dispute does, what an admin can rule, and that void is a verdict reached through arbitration — not a button an admin holds standing ([D45](../decisions.md#d45--void-is-an-arbitration-verdict-and-an-automatic-consequence-never-a-standing-admin-power)) |
| If something looks wrong       | Every balance is a sum of an append-only ledger, reconciled daily; corrections are reversing entries, so history is never edited ([D5](../decisions.md#d5--balance-immutable-ledger-plus-a-cached-balance))                                                               |

---

## 5. The smoke checklist

`docs/smoke-checklist.md`, headed with what it is:

> **Draft. Written from the code, not from a completed pass.** No person has yet clicked through
> placing a parlay, disputing an event, or arbitrating a wager. Every step below is derived from
> reading the implementation, which means it can be wrong in the two ways reading is always wrong:
> a step that cannot be performed as written, and a step nobody thought to write. **The first
> [MANUAL] run's job is to correct this document**, and its findings are worth more than its
> pass/fail result.

Five sections:

**A — Before you start.** Which environment, which database, and the ambient-`DATABASE_URL` warning
from [repo-health 3.7](../repo-health.md#37-postgres-without-docker-in-a-cloud-session): any script
loading env without `override: true` is one container variable away from targeting production.

**B — The machine half.** `npm ci`, `npm run verify`, `npm run build`, the four cron routes
returning 200, `/admin/health` reporting every job fresh, `reconcile` returning no drift. Anyone
can run this, including a cloud session.

**C — The hands half.** One continuous path, in the order a real member meets it: a new Google
account signs in → `/pending` shows step 1 → an admin approves from `/admin` → `/join` shows the
season's real figures → place a single → place a parlay → settle → check the `/me` ledger and the
balance against it → create a custom event → resolve it → dispute it from a second account →
correct it as an admin → offer a wager → accept it → claim a winner → dispute → arbitrate → react
and comment on a feed card → **submit a comment eleven times quickly and confirm the eleventh is
refused with a countdown** → read `/rules` → visit a bad event id and confirm not-found rather than
a white screen → force an error and confirm the reference digest appears.

**D — A run log.** A table: date, who ran it, which commit, what broke. Empty on delivery, and its
emptiness is the point.

**E — What this document cannot know yet.** Named explicitly: whether each step is performable as
written, how long the pass takes, which steps need two accounts and whether a second Google account
is available, and everything the pass turns up that nobody thought to write down. Findings get
filed as issues under the existing `from-test-pass` label
([repo-health 4](../repo-health.md#4-issues-and-milestones)).

---

## 6. Testing

| Layer                      | What it covers                                                                                                                       | Runs where     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `limits/policy` unit tests | Window arithmetic, boundary straddles, `decide` at, under and over the limit; no DB                                                  | Anywhere       |
| `limits/consume` tests     | The upsert increments, a second window starts fresh, over-limit is refused, a thrown query fails open, prune deletes only stale rows | DB — runs here |
| `mutation-limits.test.ts`  | Every exported `*Action` consumes or is a documented exemption                                                                       | Anywhere       |
| `gate-screens.test.ts`     | Four routes on `GateScreen`, four titles                                                                                             | Anywhere       |
| Action-level tests         | A limited action returns `RATE_LIMITED` without calling its service                                                                  | DB             |
| `npm run verify`           | The whole suite plus typecheck and lint                                                                                              | Here, and CI   |

**What a cloud session proves:** all of the above, plus `next build`. Measured: the current suite
is 86 files / 925 tests in 80 seconds against the native Postgres this environment brings up.

**What it cannot prove:**

- That Vercel's multi-instance behaviour matches the local counter. The single-statement upsert is
  designed so it must, but the only evidence available here is one Node process against one
  database.
- That the rules copy reads correctly to a person who does not already know how the app works.
  That is [MANUAL], and it is most of the point of the page.
- Any row of the checklist's hands half, by construction.

---

## 7. Decisions

Five entries, D69–D73, recorded in [`decisions.md`](../decisions.md) in the commit that lands this
spec:

| #   | Decision                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D69 | [Rate limiting is a Postgres fixed-window counter, enforced at the action boundary](../decisions.md#d69--rate-limiting-is-a-postgres-fixed-window-counter-enforced-at-the-action-boundary) |
| D70 | [The rate limiter fails open and counts attempts, not successes](../decisions.md#d70--the-rate-limiter-fails-open-and-counts-attempts-not-successes)                                       |
| D71 | [The four gate screens are one sequence on one component](../decisions.md#d71--the-four-gate-screens-are-one-sequence-on-one-component)                                                    |
| D72 | [The house rules page is public and lives outside the app shell](../decisions.md#d72--the-house-rules-page-is-public-and-lives-outside-the-app-shell)                                      |
| D73 | [The smoke checklist ships unvalidated, with a run log](../decisions.md#d73--the-smoke-checklist-ships-unvalidated-with-a-run-log)                                                         |

---

## 8. Success criteria

1. Every mutating server action consumes a rate-limit bucket, and a test fails if a new one does
   not.
2. Over-limit returns a typed `RATE_LIMITED` with a countdown, rendered as a sentence in all six
   client message maps — never an error boundary.
3. `src/server/money/`, `src/server/bets/`, `src/server/p2p/` and `src/db/schema/money.ts` have
   **zero diff** at the end of this work.
4. A limiter failure cannot prevent a bet, an offer, a comment or a reaction.
5. All four gate screens render one component, carry a title, offer at least one control, and link
   to the rules. `/admin`'s `setStatus` is limited, not missed.
6. `/rules` is readable signed-out and quotes the running season's real figures.
7. `docs/smoke-checklist.md` exists, says plainly that it is unvalidated, and is listed in
   [`docs/README.md`](../README.md).
8. `npm run verify` and `npm run build` are clean.
