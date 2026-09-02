# Roadmap

The project has two parts. **Part one** is four independent subsystems, each with its own
spec, plan, and build cycle — all four are built. **Part two** is everything between "the code
works" and "hand the URL to your friends."

## Part one — the four subsystems

| # | Subsystem | Status |
|---|---|---|
| 1 | Core betting engine | [Built](specs/2026-08-14-core-betting-engine-design.md) — fixture odds only, no production deploy yet |
| 2 | Social layer | [Built](specs/2026-08-17-social-layer-design.md) |
| 3 | Custom events | [Built](specs/2026-08-17-custom-events-design.md) |
| 4 | Peer-to-peer bets | [Built](specs/2026-08-19-peer-to-peer-bets-design.md) |

Every subsystem passes `npm run verify` and has been exercised end to end against fixture data.
None of it has been through a human test pass yet — that is the gate on phase 5 starting.

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

**Its open questions are now answered** — see [the spec](specs/2026-08-19-peer-to-peer-bets-design.md).
A wager can be either: it attaches to a selection the engine already grades, or it carries a
freeform description the two parties settle themselves
([D47](decisions.md#d47--a-freeform-wager-is-settled-by-both-parties-agreeing-with-admins-as-the-fallback)).
Unaccepted offers do expire, swept by the existing `settle` cron, and can also be withdrawn —
both refund the escrow. A wager can be canceled after acceptance, but only by both parties
agreeing; unilateral cancellation is just losing without paying
([D45](decisions.md#d45--void-is-an-arbitration-verdict-and-an-automatic-consequence-never-a-standing-admin-power)).

**Two things this framing got wrong.** Escrow does *not* happen at acceptance: once offers can sit
open to the season, an offerer could post more offers than their balance covers, so the offerer's
stake escrows at offer instead
([D46](decisions.md#d46--the-offerers-stake-escrows-at-offer-not-at-acceptance)). And "the existing
ledger design handles this without modification" understated one thing — escrowed credits have left
a balance and arrived nowhere, which is the first time in this project that the sum of all balances
is not the sum of everything granted. `reconcileBalances` cannot see the difference, so escrow gets
its own reconciliation check
([D43](decisions.md#d43--escrow-needs-its-own-reconciliation-check-balance-reconciliation-cannot-see-it)).

**Everything peer-to-peer is staked in credits**, including wagers on real games
([D40](decisions.md#d40--every-peer-to-peer-wager-moves-credits-including-the-market-backed-kind)),
which is what keeps the cash bankroll untouchable by any P2P path. Head-to-head, deferred here by
[D27](decisions.md#d27--head-to-head-is-deferred-to-subsystem-4), is now defined as the P2P record
and nothing else ([D48](decisions.md#d48--head-to-head-is-the-peer-to-peer-record-and-nothing-else)).

---

## Sequencing

Build order was 1 → 2 → 3 → 4, with one qualifier: subsystems 3 and 4 are independent of
each other, so whichever sounded more fun at the time could go first. Subsystem 2 came
second regardless — a leaderboard with no feed gets boring quickly, and it was the cheapest
of the three to build.

---

# Part two — production readiness

The four subsystems are feature-complete and green, but the app cannot be handed to anyone
yet. The odds board is fixtures. Nothing is deployed. Every route renders a white screen if it
throws. Phases 5 through 9 close that gap.

| # | Phase | Why it is here |
|---|---|---|
| 5 | [Real data: the ESPN adapter](#5--real-data-the-espn-adapter) | Everything downstream is theater while the board is fixtures |
| 6 | [Production deployment](#6--production-deployment) | Somewhere to run, and a way to know when it breaks |
| 7 | [The UI ladder](#7--the-ui-ladder) | Graduated 7a → 7d; ship-able at every rung |
| 8 | [Email notifications](#8--email-notifications) | An offer nobody sees expires; a dispute nobody sees stalls |
| 9 | [Hardening](#9--hardening) | The last mile before the URL goes out |

**Order matters for 5 and 6 only.** The adapter comes first because deploying a fixture
sportsbook proves nothing, and because it is the phase most likely to surface a schema
surprise. 7, 8, and 9 are independent of each other and can be taken in any order or in
parallel — though 9 wants 7a done first, since half of what a smoke test checks is that the
error states exist.

Prerequisite for all of it: **the human test pass**. The suite is green, but no person has
clicked through placing a parlay, disputing an event, or arbitrating a wager. Bugs found
there change what these phases contain.

---

## 5 — Real data: the ESPN adapter

**What it adds.** `EspnOddsProvider` and `EspnScoreProvider`, replacing the fixtures behind
the two provider interfaces — real NFL and CFB slates, real lines, real final scores.

**Why this is cheap.** `src/server/odds/types.ts` already declares `OddsProvider` and
`ScoreProvider` as separate interfaces over provider-shaped data, and
`src/app/api/cron/sync-odds/route.ts` constructs both implementations inline. The swap is
those two constructor calls. Nothing in `syncOdds`, `syncResults`, grading, or settlement
knows a provider changed. This is the payoff for [D2](decisions.md#d2--odds-build-against-fixtures-integrate-a-real-provider-later)
having been made two years' worth of design decisions ago.

**Why ESPN and not The Odds API.** Free, unmetered, no key
([D49](decisions.md#d49--espns-public-json-is-the-odds-and-score-source-superseding-d2)). The
Odds API's free tier is 500 credits a month; a `*/15` sync across two sports and three markets
burns roughly 17,000. Going free through them would have meant building a credit budgeter and
a variable sync cadence — real work, in service of a worse feed.

**The tasks.**

1. **Spike the payload first.** Confirm the shape for NFL *and* CFB, on both
   `site.api.espn.com/.../scoreboard` and the per-book
   `sports.core.api.espn.com/.../odds/{providerId}` endpoints. This is genuinely unverified —
   community documentation says `competitions[].odds[]` carries spread, over/under, and
   moneyline, but no one on this project has seen the response. Everything below assumes an
   answer this task has not produced yet.
2. **`EspnScoreProvider`** — the simpler half, and the one settlement depends on. ESPN's event
   id becomes `externalId` for games, which keeps odds and scores keyed identically.
3. **`EspnOddsProvider`** — team upserts from ESPN team ids, market and selection mapping, and
   American price normalization.
4. **CFB paging.** NFL is one request per week. College football is ~130 FBS teams across
   conference groups, and the scoreboard endpoint pages by week and group — the one place the
   two sports genuinely differ.
5. **Defensive parsing.** A field that is missing or reshaped skips that market; it never
   throws out of the cron. The existing `STALE_AFTER_MS` suspension then does the right thing
   on its own: a feed that goes dark closes markets rather than leaving stale lines bettable.
   That behavior already exists and is the reason an unofficial upstream is survivable.
6. **A kill switch.** An env flag that falls back to the fixture providers, so a bad ESPN
   deploy is a config change rather than a rollback.
7. **First real slate.** An admin-run backfill that pulls a genuine week into a real season,
   plus reconciliation over it.

**The honest risk.** This is an undocumented endpoint with no SLA and no contract. It can
change shape without notice. The mitigations are tasks 5 and 6 and the fact that this is a
private group of friends, not a business — a broken Saturday is an annoyance, not an incident.

---

## 6 — Production deployment

**What it adds.** Somewhere for the app to actually run, and a way to find out when it stops.

**The tasks.**

- **Hosted Postgres** with automated backups and a documented restore path. Connection pooling
  matters here: serverless functions plus a per-request Postgres client is the classic way to
  exhaust a connection limit.
- **Vercel project wiring** — environment variables, `AUTH_URL` and the Google OAuth redirect
  for the real domain, and migrations applied as part of deploy rather than by hand.
- **`CRON_SECRET` on the real invocations.** The routes already require it
  ([`src/server/cron/auth.ts`](../src/server/cron/auth.ts)); production has to supply it.
- **Error monitoring** — Sentry's free tier, wired to server actions and route handlers.
- **Alerting on cron failure and reconciliation drift.** This is the item that earns the phase.
  Four jobs move money on a schedule, and today a `settle` run that throws is invisible: no bet
  settles, no one is told, and the first signal is a member asking why Sunday never graded.
  `reconcileBalances` and `reconcileEscrow` already compute the answer — they just have nowhere
  to shout.
- **An admin health page.** Last successful run per cron, last reconcile result and drift, count
  of suspended-stale markets, total credits sitting in escrow. One screen that answers "is it
  working."
- **An admin season-creation screen.** `createSeason` exists in
  [`src/server/seasons/service.ts`](../src/server/seasons/service.ts) but is only ever called
  from `seed.ts`. In production that means starting next season requires shell access to the
  database, which is not a thing you want to discover in September.

**Deliberately skipped.** A staging environment. For a private group, a kill switch plus fast
rollback covers what staging would, at a fraction of the setup.

---

## 7 — The UI ladder

Four rungs, ordered so the app is shippable after each one. Climb until it looks good enough
and stop there — nothing later in the ladder is a prerequisite for anything outside it.

| Rung | What it is | Status |
|---|---|---|
| [7a](#7a--foundations) | Foundations — boundaries, loading states, app identity | **Built** ([spec](specs/2026-08-22-ui-foundations-design.md), [plan](archive/plans/2026-08-22-ui-foundations-implementation-plan.md), [mobile audit](mobile-audit.md)) |
| [7b](#7b--design-system) | Design system — tokens, dark mode, the shared set | **Built** ([spec](specs/2026-08-24-design-system-design.md), [plan](archive/plans/2026-08-24-design-system-implementation-plan.md), [design-system audit](design-system-audit.md)) |
| [7c](#7c--screen-by-screen-rebuild) | Screen-by-screen rebuild | Not started — carries an [inherited backlog](#what-7c-inherits) |
| [7d](#7d--craft) | Craft — motion, accessibility, copy, density | Not started — carries an [inherited backlog](#what-7d-inherits) |

Each rung's inherited backlog is the record of what an earlier rung deliberately did not do.
Nothing is dropped silently; if a phase declines an item, it lands in the rung that owns it.

### 7a — Foundations

**Built** — see [the spec](specs/2026-08-22-ui-foundations-design.md) for the full design and
[the mobile audit](mobile-audit.md) for the findings it left to later rungs. That audit assigned
7b nothing: its six findings went 7a (two, fixed on the spot), 7c (three), and 7d (one), and they
are now listed under those rungs below. The original description below got two
things wrong, recorded in the spec rather than silently re-scoped: root-level `error.tsx`,
`global-error.tsx`, and `not-found.tsx` had already landed with the deploy groundwork, and
pending states were already on all twelve forms — both needed a regression test, not a rebuild.

- Error and not-found boundaries inside the `(app)` shell and `admin`, so a throw or a bad id
  keeps the header, tab bar, and bet slip instead of replacing them; the two root boundaries
  now call `retry()` instead of `reset()`, so "Try again" actually re-fetches
- `loading.tsx` on every top-level feature segment (eight files cover all eighteen pages)
- Real metadata, a title template, generated app icons, and a web manifest, so the browser tab,
  the app switcher, and an installed home-screen icon all say SimulatedBetting; search engines
  are told not to index it
- A regression test asserting all twelve forms' pending states, and a structural test that fails
  the day a route ships without a boundary
- A mobile audit at 375×812 across all eighteen routes, which caught and fixed two genuine
  blocks-use bugs in passing: the bet slip's collapsed bar occluding the entire tab bar, and a
  mobile keyboard with no minus key blocking negative odds entry on custom events

### 7b — Design system

**Built** — see [the spec](specs/2026-08-24-design-system-design.md),
[the plan](archive/plans/2026-08-24-design-system-implementation-plan.md), and
[the design-system audit](design-system-audit.md).

Before 7b there were six shared components ([`src/components/ui/`](../src/components/ui/)) — not
the four this section originally counted, since 7a added two — and every other screen was inline
Tailwind. That is why the app looked like four different apps: 474 `className` attributes, 144 of
them carrying a hand-written `dark:` variant, over a raw zinc scale used eleven different ways.

7b replaced the vocabulary rather than the screens. The app looks *the same* as it did before —
apart from the two contrast/fill bugs the audit caught and fixed, and the switch to Geist — it is
simply written in something a person can hold in their head, which is what 7c needs in order to
rebuild against anything at all.

**What it does.**

- **A two-tier token layer** landed in `src/app/globals.css` — private colour ramps underneath,
  thirty semantic tokens (`--surface-raised`, `--ink-muted`, `--negative-line`) on top, exposed
  through `@theme inline`
  ([D52](decisions.md#d52--semantic-tokens-in-two-tiers-dark-mode-is-a-remap-not-a-variant-sweep))
- **Dark mode defined once**, as a remap of those thirty names. All 144 hand-written `dark:`
  variants were deleted; the token-lint test now keeps that true. The `[data-theme]` selectors
  ship with no way to set them, so a toggle later is a drop-in rather than a CSS restructure
- **The shared set, scoped to call sites that existed** — `Button`, `Card`, `Callout`,
  `SegmentedControl`, `FormField`, plus tone-based `Badge` and consolidated `Money`/`Price`/`Line`
  ([D53](decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist))
- **A mechanical sweep** carried all 63 `.tsx` files onto the vocabulary — colour and `dark:`
  only, so any visual difference afterward was provably a token bug rather than a judgement call
- **A token-lint test** now fails when a future file reaches for raw zinc
  ([D54](decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51))
- **A browser audit** — 18 routes × two themes × two viewports, before and after, written up as
  [`docs/design-system-audit.md`](design-system-audit.md) — caught what the mechanical sweep and
  the lint test structurally couldn't see: two systemic mapping bugs, both fixed in the audit's
  own commit. `bg-white`/no-fill + `dark:bg-zinc-900` had mapped to `bg-surface-raised`, whose
  dark value is the same `zinc-950` as the `Card` sitting behind it — eleven controls (every form
  input on a card, both odds grids) lost their fill in dark mode and read as hairline outlines on
  black; fixed to `bg-surface-sunken`. Bare `text-zinc-400` (no dark partner) had mapped to
  `text-ink-subtle`, whose dark value is `zinc-600` — contrast against `--surface-raised` fell
  from ~8.6:1 to ~2.6:1, below WCAG AA, at fifteen sites including all five inactive bottom-tab
  labels; fixed to `text-ink-muted`
- **The font.** `globals.css` had ended with `body { font-family: Arial, … }`, overriding the
  Geist the root layout loads — the app had never once rendered in Geist. That override is gone;
  every glyph on every screen now renders in Geist, the single largest visual difference the
  audit captured, and the reason all 108 before/after image pairs differ

**What this section originally got wrong.** Two of its four bullets, corrected rather than
quietly re-scoped:

- **"There are four shared components today."** Six. 7a added `status-screen` and
  `loading-screen`.
- **"The shared set: button, card, sheet, dialog, table, tabs, toast, form field."** Four of
  those eight have no call site anywhere in the app — zero `<table>` elements, zero dialogs, zero
  sheets across 63 files. They are deferred to 7c rather than designed against guesses.

**What 7b defers**, each item carried below rather than dropped: `Dialog`, `Sheet`, `Table`, and
`Toast`; type-scale and spacing normalization on existing screens; a brand accent colour (→ 7c);
the dark-mode toggle UI, focus management on the new components, and the component-test harness
question (→ 7d).

### 7c — Screen-by-screen rebuild

Every screen rebuilt against 7b, hot path first, so the rungs pay off in the order people
actually feel them:

Games and the bet slip → Feed → Standings → Bets and Wagers → Events → Me → Admin.

#### What 7c inherits

Deferred here by an earlier rung. This is a backlog, not a wish list — each line has a phase
that declined it and a reason.

| Item | Deferred by | Why it landed here |
|---|---|---|
| Build `Dialog`, `Sheet`, `Table`, and `Toast` | 7b | No call sites existed; each is built in the commit that first needs one ([D53](decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist)) |
| Normalize the type scale and spacing on existing screens | 7b | 7b's sweep was colour-only so that any visual change was provably a bug; normalizing is intentional drift and belongs with a redesign |
| Choose a brand accent colour, if the app wants one | 7b | `--accent` makes it a two-line change; picking a hue before any screen is redesigned is a guess |
| `generateMetadata` on detail routes, for per-entity titles | 7a | Those screens are rebuilt here anyway |
| Odds-board density at 375px — the SPREAD/MONEY/TOTAL grid is tight | 7a (mobile audit) | Needs the screen redesigned, not restyled |
| `datetime-local` inputs cramped two-up on `/events/new` and `/wagers/new` | 7a (mobile audit) | A layout fix |
| `/admin/events` header runs together as "Event queueBack to admin" | 7a (mobile audit) | Page-specific markup |
| Controls adopted into `Button` grew 6–8px taller — `Button`'s `md` size is `h-11`; the call sites had been `py-2`, `h-9`, or `h-12` | 7b (design-system audit) | The spec declared the radius change, not the height. It is a better tap target, so it is recorded rather than reverted |
| `FormField` restyles labels from `text-sm font-medium` to `text-xs font-medium text-ink-secondary` — smaller and quieter than before | 7b (design-system audit) | Cosmetic consequence of adoption, not a bug; changing it back is a design call for the rebuild |
| `Card` adoption gives `/me`'s ledger rows and `/standings`' rank rows a 1px `border-line` and `rounded-card` (12px), where they had a bare fill and `rounded-lg` (8px) | 7b (design-system audit) | Cosmetic consequence of adoption, not a bug |
| "Create an event" on `/events` lost its 1px border — `Button`'s `primary` variant has none. The old border was the same colour as the fill, so the control is 2px smaller and otherwise unchanged | 7b (design-system audit) | Consequence of adoption; not reverted since it reads as unchanged |
| No screen has a desktop layout at 1280×800 — outside `/admin*`'s `max-w-2xl`, every list runs edge to edge | 7b (design-system audit) | Existing design, not a 7b regression, but it needs the screen redesigned, not restyled |
| The bet slip's dark-mode shadow (`shadow-slip`) is measurable but not perceptible — the shadow colour and `--surface` are both pure black in dark mode | 7b (design-system audit) | Needs a non-black shadow colour or a `--surface` that isn't pure black to read; both are Task 1 token-layer decisions, outside the audit's remit |
| `/admin/events` and `/admin/wagers` share `/admin`'s `mx-auto` (no `w-full`) container pattern — didn't overflow with current fixture content, but carries the same latent bug | 7b (design-system audit) | Not fixed since it wasn't observed to break; worth the same `w-full` fix if content grows |
| `Card` adoption is unfinished — 11 call sites (`bets/page.tsx`, `events/page.tsx`, `dispute-form.tsx` ×2, `market-card.tsx`, `events/[eventId]/page.tsx`, `comment-thread.tsx` ×2, `feed-card.tsx`, `game-card.tsx`, `preferences-form.tsx`) still hand-write the byte-identical `rounded-xl border border-line bg-surface-raised` that `Card` renders | 7b (final review) | Seven of the eleven are semantic elements (`<article>`/`<section>`/`<li>`), and `Card` hard-codes `<div>` with no element-type escape hatch |
| The radius vocabulary (`rounded-card`/`rounded-control`/`rounded-pill`) is adopted at only 10 uses across `src/`, against 45 raw `rounded-xl`/`rounded-lg`/`rounded-full` | 7b (final review) | The phase's "no radii on existing markup" constraint correctly left this alone, but it isn't tracked anywhere |

If a third screen in a row hand-rolls the same missing component, lift it immediately rather
than at the end — see the consequence noted on
[D53](decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist).

### 7d — Craft

- Motion and transitions; skeleton loaders in place of spinners
- Accessibility: keyboard paths, focus management, contrast, screen reader labels
- Error and empty-state copy that reads like a person wrote it
- **A density pass on the odds board.** A 60-game CFB Saturday is the layout stress case, and
  [D8](decisions.md#d8--layout-sportsbook-first) already rejected one-game-at-a-time cards on
  exactly these grounds. What replaces them still has to be designed.

#### What 7d inherits

| Item | Deferred by | Why it landed here |
|---|---|---|
| A dark-mode toggle — the control, the cookie, and the persistence | 7b | The `[data-theme]` selectors already ship; only the control is missing, and a control is craft |
| Focus management, keyboard paths, and SR labels on the shared components | 7b | Tokens carry contrast; behaviour is this rung's subject |
| Revisit the component-test harness question | 7b | [D54](decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51) found 7b's components too simple to earn one. `Dialog` and `Toast` are the ones that would, and they arrive in 7c |
| Skeleton loaders replacing the neutral `LoadingScreen` | 7a | A skeleton that does not match its screen is worse than none, and the screens did not exist yet |
| The admin section renders with no header or tab bar on mobile | 7a (mobile audit) | A structural decision about whether admin joins the app shell, not a styling one |

---

## 8 — Email notifications

**What it adds.** Email for the handful of events that are time-sensitive, every type
individually switchable and the whole thing switchable off
([D50](decisions.md#d50--notifications-are-opt-out-email-with-per-type-switches)).

**Why it is worth a phase.** Subsystems 3 and 4 introduced things that go stale when unseen: a
peer-to-peer offer expires, a disputed event waits on an admin who does not know they are
needed, a wager sits unclaimed while the game it references kicks off. Everything else here is
a nicety; those three are the feature not working.

**What sends.**

| Event | Urgency |
|---|---|
| A wager was offered to you | Immediate |
| Your offer expires soon | Immediate |
| A dispute needs your ruling (admin) | Immediate |
| Your account was approved | Immediate |
| Your bets settled | Digest |
| The weekly allowance landed | Digest |

**The design constraint that matters.** Sends have to be idempotency-keyed exactly the way
`feed_events` are ([D34](decisions.md#d34--currency-is-a-dimension-on-the-existing-ledger-not-a-second-ledger)
and the ledger pattern generally). `settle` is resumable and re-runnable by design — if the
mail send is not keyed, a re-run emails everyone twice, and unlike a duplicate ledger write
there is no reversing entry for an email. The natural move is to emit from the same points
that already emit feed events, reusing their dedupe key.

**The tasks.** A transactional email provider on its free tier; a `notification_preferences`
table extending the pattern [`/me/feed-preferences`](<../src/app/(app)/me/feed-preferences/page.tsx>)
already established; per-type toggles plus a global off; a one-click unsubscribe link that works
without signing in; and a dev mode that logs instead of sending.

---

## 9 — Hardening

The last mile. Wants 7a finished first — half of a smoke test is checking that error states
exist.

- **A written smoke checklist**, derived from the human test pass this whole part is gated on.
  Place a parlay, settle it, dispute an event, arbitrate a wager, run reconciliation, confirm
  every balance. Repeatable before every deploy.
- **Rate limiting on mutations.** Bet placement, offers, comments, reactions. Small group, low
  risk, but every one of these writes to the ledger or the feed.
- **Load sanity.** A full CFB Saturday board and a season's worth of feed events, checked for
  the queries that only get slow with real row counts.
- **A house rules page.** Plain language: no real money, how the allowance works, what credits
  are and why they cannot become cash, who arbitrates and how.
- **The new-member path.** What someone sees before an admin approves them, after approval, and
  when there is no active season to join. Three screens that exist
  ([`/pending`](../src/app/pending/page.tsx), [`/join`](../src/app/join/page.tsx),
  [`/no-season`](../src/app/no-season/page.tsx)) and have never been looked at as a sequence.

---

## What is deliberately not on this roadmap

Kept here so it stays decided rather than getting re-litigated:

- **Player props and live betting** — [D6](decisions.md#d6--bet-types-singles-and-parlays)
  rejected both; props need a second stats integration, live needs continuous polling
- **Line shopping across books** — [D9](decisions.md#d9--lines-one-house-line-per-market) picks
  one house line per market. ESPN as the only source in phase 5 makes this moot anyway.
- **More sports** — the schema is sport-dimensioned and the fixtures are not, so this is real
  work with no demand behind it yet
- **Real money, in any form** — not a feature gap, a category the project stays out of
