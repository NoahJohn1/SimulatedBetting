# Roadmap

Everything this project has built and everything left to build, in one table. Completed items
carry their spec and plan links here rather than a section below — the spec is the authority on
what a subsystem does and [`decisions.md`](decisions.md) on why, so a third summary in this file
would only drift from both.

**Who finishes what.** `[CLOUD]` is a Claude Code web session, start to finish. `[LOCAL]` needs
Docker and Postgres on a desktop. `[MANUAL]` is human hands, either person. `[NOAH]` needs an
account only Noah holds — GitHub settings, the Vercel dashboard, DNS, paid signups. See
[`repo-health.md`](repo-health.md#status-at-a-glance) for the same tags on repo mechanics.

**What this table records is what is in the repository**, not what is on somebody's laptop.
Where a status cannot be verified from the repo, it says so and dates the observation.

| #   | Item                                                          | Status                             | Who finishes what's left | Reference                                                                                                                                                  |
| --- | ------------------------------------------------------------- | ---------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Core betting engine                                           | ✅ Complete                        | —                        | [spec](specs/2026-08-14-core-betting-engine-design.md)                                                                                                     |
| 2   | Social layer                                                  | ✅ Complete                        | —                        | [spec](specs/2026-08-17-social-layer-design.md) · [plan](archive/plans/2026-08-17-social-layer-implementation-plan.md)                                     |
| 3   | Custom events                                                 | ✅ Complete                        | —                        | [spec](specs/2026-08-17-custom-events-design.md) · [plan](archive/plans/2026-08-17-custom-events-implementation-plan.md)                                   |
| 4   | Peer-to-peer bets                                             | ✅ Complete                        | —                        | [spec](specs/2026-08-19-peer-to-peer-bets-design.md) · [plan](archive/plans/2026-08-19-peer-to-peer-bets-implementation-plan.md)                           |
| —   | **Human test pass** — the gate on phase 5                     | 🔲 Backlog                         | **[MANUAL]**             | —                                                                                                                                                          |
| 5   | [Real data: the ESPN adapter](#5--real-data-the-espn-adapter) | 🔄 In progress — code complete, production verification pending | [NOAH]           | [spec](specs/2026-08-22-espn-adapter-design.md) · [plan](plans/2026-08-22-espn-adapter-implementation.md) |
| 6   | [Production deployment](#6--production-deployment)            | 🔄 Partial — deployed, unmonitored | **[NOAH]** mostly        | —                                                                                                                                                          |
| 7a  | UI foundations                                                | ✅ Complete                        | —                        | [spec](specs/2026-08-22-ui-foundations-design.md) · [plan](archive/plans/2026-08-22-ui-foundations-implementation-plan.md) · [audit](mobile-audit.md)      |
| 7b  | Design system                                                 | ✅ Complete                        | —                        | [spec](specs/2026-08-24-design-system-design.md) · [plan](archive/plans/2026-08-24-design-system-implementation-plan.md) · [audit](design-system-audit.md) |
| 7c  | [Screen-by-screen rebuild](#7c--screen-by-screen-rebuild)     | 🔲 Backlog                         | [CLOUD]                  | —                                                                                                                                                          |
| 7d  | [Craft](#7d--craft)                                           | 🔲 Backlog                         | [CLOUD]                  | —                                                                                                                                                          |
| 8   | [Email notifications](#8--email-notifications)                | 🔲 Backlog                         | [CLOUD] [NOAH]           | —                                                                                                                                                          |
| 9   | [Hardening](#9--hardening)                                    | 🔲 Backlog                         | [CLOUD] [LOCAL] [MANUAL] | —                                                                                                                                                          |

All four subsystems pass `npm run verify` and have been exercised end to end against fixture
data. None of it has been through a human test pass — that is the gate on phase 5, and no
amount of tooling substitutes for it.

**Phase 5's code is now verifiable from the repo — and, as of 2026-09-03, partly against the
live feed too.** The `espn-adapter` branch (16 commits) adds `EspnOddsProvider`/
`EspnScoreProvider` behind the `ODDS_PROVIDER` kill switch, with a spec and implementation
plan. `npm run typecheck` and `npm run lint` are clean, and all 34 pure-logic unit tests pass
(mappers, `parseLine`, `fetchScoreboard`, providers).

With outbound network opened up for this session, `EspnOddsProvider`/`EspnScoreProvider` were
also run directly against ESPN's real live scoreboard (NFL and NCAAF, 2026-09-03) — no
database involved, since the fetch/parse layer is pure. Results: 17 NFL and 177 NCAAF games
parsed, **zero game- or result-level skips** on either sport, confirming the payload shape
hasn't drifted since the 2026-08-22 spike and that the CFB `groups=80&limit=200` paging
redesign holds at real scale. 86 of ~415 attempted market legs were skipped — all traced to
ESPN's documented `"OFF"` price / out-of-range price paths (a book pulling a lopsided line),
i.e. the defensive-parsing path working exactly as designed, not a bug. One sandbox-only
wrinkle: Node's global `fetch()` doesn't honor `HTTPS_PROXY` by default in this environment,
so a bare cloud-session request gets a `403` straight from ESPN's own edge (a datacenter-IP
block, confirmed by comparing a proxied vs. direct `curl`) — running `node --use-env-proxy`
routes it through the session's local proxy correctly. This is purely a quirk of *this sandbox
reaching the internet*, not something the adapter code needs to handle — Vercel production has
no such proxy in front of it.

**Update, same day:** the "needs Docker" blocker above turned out to be specific to this
repo's own `db:up` script, not to Postgres itself. This sandbox runs as root with passwordless
`sudo` and no Docker daemon, but `apt-get install postgresql-16` and `pg_ctlcluster 16 main
start` gave a real local Postgres with no container runtime involved. Against that: `npm run
verify` — typecheck, lint, and all 866 tests across 81 files, including the previously-unrunnable
`sync.test.ts`/`results.test.ts` — passes clean. Further, `syncOdds`/`syncResults` were run for
real with `EspnOddsProvider`/`EspnScoreProvider` against live ESPN data, writing into that local
database: 194 games, 329 markets, 658 selections, 658 snapshots, 0 games skipped, 43 markets
skipped (same `"OFF"`-price pattern as above). A spot check of the written rows (real teams,
real DraftKings spreads and moneylines, correct sides) confirms the data is right. That is
spec success criterion 2 and the persistence half of task 7, mechanically exercised end to end
from a cloud session — against a disposable local database, not Noah's real one.

**A safety finding surfaced doing this, worth recording.** This container's environment already
carries `DATABASE_URL`/`TEST_DATABASE_URL` pointing at a real hosted Supabase project
(`aws-0-us-east-1.pooler.supabase.com`) — presumably the phase-6 production database. `src/db/migrate.ts`
loads env with plain `dotenv` (no `override: true`), so it does *not* override an
already-set `DATABASE_URL` — an `npm run db:migrate:test` run in this session tried to reach
that Supabase project instead of the local `.env.test` target, and only failed to do anything on
a connection timeout. `src/test/setup.ts` is the one file in this codebase that loads `.env.test`
with `override: true`, which is why the actual test suite stayed safely local throughout this
session. This is a real footgun for any cloud session with this environment's credentials
injected and worth Noah's attention independent of phase 5 — see the plan's status note for
detail. No production data was read or written while establishing this.

**What genuinely still needs Noah or a human, not a cloud AI session:** actually pointing
`ODDS_PROVIDER=espn` at *production* and reconciling what lands there, and the human test pass
gate — clicking through the real app and judging it. Neither of those is a technical blocker
this session can route around; they're Noah's database and a person's judgment, respectively.
The branch is not yet merged to `main` and has no open PR.

---

# Part two — production readiness

The four subsystems are feature-complete and green, but the app cannot be handed to anyone
yet. The odds board is fixtures. Nothing is deployed. Every route renders a white screen if it
throws. Phases 5 through 9 close that gap.

| #   | Phase                                                         | Why it is here                                               |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| 5   | [Real data: the ESPN adapter](#5--real-data-the-espn-adapter) | Everything downstream is theater while the board is fixtures |
| 6   | [Production deployment](#6--production-deployment)            | Somewhere to run, and a way to know when it breaks           |
| 7   | [The UI ladder](#7--the-ui-ladder)                            | Graduated 7a → 7d; ship-able at every rung                   |
| 8   | [Email notifications](#8--email-notifications)                | An offer nobody sees expires; a dispute nobody sees stalls   |
| 9   | [Hardening](#9--hardening)                                    | The last mile before the URL goes out                        |

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

1. **Spike the payload first.** Confirm the shape for NFL _and_ CFB, on both
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

| Task                                                  | Status                                     | Owner                                          |
| ----------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Spike the payload — NFL and CFB, both endpoints       | ✅ Complete                                | —                                                |
| `EspnScoreProvider`                                   | ✅ Complete                                | —                                                |
| `EspnOddsProvider`                                    | ✅ Complete                                | —                                                |
| CFB paging by week and conference group               | ✅ Complete — one request (`groups`/`limit`), not a loop; see spec | —                          |
| Defensive parsing — a reshaped field skips its market | ✅ Complete                                | —                                                |
| Kill switch env flag falling back to fixtures         | ✅ Code complete · 🔲 **[NOAH]** still needs to set it in Vercel | **[NOAH]** to set in Vercel        |
| First real slate — admin backfill plus reconciliation | 🔄 Mechanically verified (2026-09-03) — `syncOdds`/`syncResults` run for real against live ESPN data, persisted correctly into a scratch Postgres (194 games, 329 markets, 658 selections, spot-checked); **only the actual run against production plus reconciliation is outstanding** | **[NOAH]** — runs against production |

Everything in this table, including the persistence half of the last row, was built and
verified from a Claude Code cloud session once outbound network was opened up and a local
Postgres was hand-installed (`apt-get install postgresql-16`, no Docker) — see the
[plan](plans/2026-08-22-espn-adapter-implementation.md)'s status note for the full detail,
including why a bare cloud-session `fetch()` call needs `node --use-env-proxy` to reach ESPN
here (a sandbox networking quirk, not something production needs). What's left is not a
technical limitation of a cloud session at all: it's Noah's production credentials to run the
real thing against, and a human's judgment for the test pass gate below.

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

**Verified against the repo 2026-09-02.** The app is deployed, but the observability half —
which this phase calls the item that earns it — is absent.

| Task                                                                  | Status     | Owner                                 | Evidence                                                                                                            |
| --------------------------------------------------------------------- | ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Hosted Postgres, backups, documented restore                          | 🔲 Backlog | **[NOAH]**                            | Not verifiable from the repo                                                                                        |
| Vercel wiring — env, `AUTH_URL`, OAuth redirect, migrations on deploy | 🔄 Partial | **[NOAH]**                            | App runs; `CRON_SECRET` presence unconfirmed                                                                        |
| `CRON_SECRET` on the real invocations                                 | 🔲 Backlog | **[NOAH]**                            | Actions secrets absent — see [repo-health 1.5](repo-health.md#15-the-cron-workflow--the-only-thing-actually-broken) |
| Error monitoring (Sentry free tier)                                   | 🔲 Backlog | **[NOAH]** signup · [CLOUD] wiring    | No monitoring dependency in `package.json`                                                                          |
| Alerting on cron failure and reconciliation drift                     | 🔲 Backlog | [CLOUD] code · **[NOAH]** destination | `reconcileBalances`/`reconcileEscrow` are called only from the cron route                                           |
| Admin health page                                                     | 🔲 Backlog | [CLOUD]                               | `src/app/admin` holds only `page.tsx`, `events/`, `wagers/`                                                         |
| Admin season-creation screen                                          | 🔲 Backlog | [CLOUD]                               | `createSeason` is reachable only from `seed.ts` and `bootstrap-season.ts`                                           |

**Deliberately skipped.** A staging environment. For a private group, a kill switch plus fast
rollback covers what staging would, at a fraction of the setup.

---

## 7 — The UI ladder

Four rungs, ordered so the app is shippable after each one. Climb until it looks good enough
and stop there — nothing later in the ladder is a prerequisite for anything outside it.

Each rung's inherited backlog is the record of what an earlier rung deliberately did not do.
Nothing is dropped silently; if a phase declines an item, it lands in the rung that owns it.

### 7c — Screen-by-screen rebuild

Every screen rebuilt against 7b, hot path first, so the rungs pay off in the order people
actually feel them:

Games and the bet slip → Feed → Standings → Bets and Wagers → Events → Me → Admin.

#### What 7c inherits

Deferred here by an earlier rung. This is a backlog, not a wish list — each line has a phase
that declined it and a reason.

| Item                                                                                                                                                                                                                                                                                                                                                   | Deferred by              | Why it landed here                                                                                                                                             | Owner   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Build `Dialog`, `Sheet`, `Table`, and `Toast`                                                                                                                                                                                                                                                                                                          | 7b                       | No call sites existed; each is built in the commit that first needs one ([D53](decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist)) | [CLOUD] |
| Normalize the type scale and spacing on existing screens                                                                                                                                                                                                                                                                                               | 7b                       | 7b's sweep was colour-only so that any visual change was provably a bug; normalizing is intentional drift and belongs with a redesign                          | [CLOUD] |
| Choose a brand accent colour, if the app wants one                                                                                                                                                                                                                                                                                                     | 7b                       | `--accent` makes it a two-line change; picking a hue before any screen is redesigned is a guess                                                                | [CLOUD] |
| `generateMetadata` on detail routes, for per-entity titles                                                                                                                                                                                                                                                                                             | 7a                       | Those screens are rebuilt here anyway                                                                                                                          | [CLOUD] |
| Odds-board density at 375px — the SPREAD/MONEY/TOTAL grid is tight                                                                                                                                                                                                                                                                                     | 7a (mobile audit)        | Needs the screen redesigned, not restyled                                                                                                                      | [CLOUD] |
| `datetime-local` inputs cramped two-up on `/events/new` and `/wagers/new`                                                                                                                                                                                                                                                                              | 7a (mobile audit)        | A layout fix                                                                                                                                                   | [CLOUD] |
| `/admin/events` header runs together as "Event queueBack to admin"                                                                                                                                                                                                                                                                                     | 7a (mobile audit)        | Page-specific markup                                                                                                                                           | [CLOUD] |
| Controls adopted into `Button` grew 6–8px taller — `Button`'s `md` size is `h-11`; the call sites had been `py-2`, `h-9`, or `h-12`                                                                                                                                                                                                                    | 7b (design-system audit) | The spec declared the radius change, not the height. It is a better tap target, so it is recorded rather than reverted                                         | [CLOUD] |
| `FormField` restyles labels from `text-sm font-medium` to `text-xs font-medium text-ink-secondary` — smaller and quieter than before                                                                                                                                                                                                                   | 7b (design-system audit) | Cosmetic consequence of adoption, not a bug; changing it back is a design call for the rebuild                                                                 | [CLOUD] |
| `Card` adoption gives `/me`'s ledger rows and `/standings`' rank rows a 1px `border-line` and `rounded-card` (12px), where they had a bare fill and `rounded-lg` (8px)                                                                                                                                                                                 | 7b (design-system audit) | Cosmetic consequence of adoption, not a bug                                                                                                                    | [CLOUD] |
| "Create an event" on `/events` lost its 1px border — `Button`'s `primary` variant has none. The old border was the same colour as the fill, so the control is 2px smaller and otherwise unchanged                                                                                                                                                      | 7b (design-system audit) | Consequence of adoption; not reverted since it reads as unchanged                                                                                              | [CLOUD] |
| No screen has a desktop layout at 1280×800 — outside `/admin*`'s `max-w-2xl`, every list runs edge to edge                                                                                                                                                                                                                                             | 7b (design-system audit) | Existing design, not a 7b regression, but it needs the screen redesigned, not restyled                                                                         | [CLOUD] |
| The bet slip's dark-mode shadow (`shadow-slip`) is measurable but not perceptible — the shadow colour and `--surface` are both pure black in dark mode                                                                                                                                                                                                 | 7b (design-system audit) | Needs a non-black shadow colour or a `--surface` that isn't pure black to read; both are Task 1 token-layer decisions, outside the audit's remit               | [CLOUD] |
| `/admin/events` and `/admin/wagers` share `/admin`'s `mx-auto` (no `w-full`) container pattern — didn't overflow with current fixture content, but carries the same latent bug                                                                                                                                                                         | 7b (design-system audit) | Not fixed since it wasn't observed to break; worth the same `w-full` fix if content grows                                                                      | [CLOUD] |
| `Card` adoption is unfinished — 11 call sites (`bets/page.tsx`, `events/page.tsx`, `dispute-form.tsx` ×2, `market-card.tsx`, `events/[eventId]/page.tsx`, `comment-thread.tsx` ×2, `feed-card.tsx`, `game-card.tsx`, `preferences-form.tsx`) still hand-write the byte-identical `rounded-xl border border-line bg-surface-raised` that `Card` renders | 7b (final review)        | Seven of the eleven are semantic elements (`<article>`/`<section>`/`<li>`), and `Card` hard-codes `<div>` with no element-type escape hatch                    | [CLOUD] |
| The radius vocabulary (`rounded-card`/`rounded-control`/`rounded-pill`) is adopted at only 10 uses across `src/`, against 45 raw `rounded-xl`/`rounded-lg`/`rounded-full`                                                                                                                                                                              | 7b (final review)        | The phase's "no radii on existing markup" constraint correctly left this alone, but it isn't tracked anywhere                                                  | [CLOUD] |

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

| Item                                                                     | Deferred by       | Why it landed here                                                                                                                                                                                  | Owner   |
| ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A dark-mode toggle — the control, the cookie, and the persistence        | 7b                | The `[data-theme]` selectors already ship; only the control is missing, and a control is craft                                                                                                      | [CLOUD] |
| Focus management, keyboard paths, and SR labels on the shared components | 7b                | Tokens carry contrast; behaviour is this rung's subject                                                                                                                                             | [CLOUD] |
| Revisit the component-test harness question                              | 7b                | [D54](decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51) found 7b's components too simple to earn one. `Dialog` and `Toast` are the ones that would, and they arrive in 7c | [CLOUD] |
| Skeleton loaders replacing the neutral `LoadingScreen`                   | 7a                | A skeleton that does not match its screen is worse than none, and the screens did not exist yet                                                                                                     | [CLOUD] |
| The admin section renders with no header or tab bar on mobile            | 7a (mobile audit) | A structural decision about whether admin joins the app shell, not a styling one                                                                                                                    | [CLOUD] |

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

| Event                               | Urgency   |
| ----------------------------------- | --------- |
| A wager was offered to you          | Immediate |
| Your offer expires soon             | Immediate |
| A dispute needs your ruling (admin) | Immediate |
| Your account was approved           | Immediate |
| Your bets settled                   | Digest    |
| The weekly allowance landed         | Digest    |

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

| Task                                                       | Status     | Owner                                                    |
| ---------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| Transactional email provider on a free tier                | 🔲 Backlog | **[NOAH]** — signup, API key, DNS for the sending domain |
| `notification_preferences` table and migration             | 🔲 Backlog | [CLOUD]                                                  |
| Per-type toggles plus a global off                         | 🔲 Backlog | [CLOUD]                                                  |
| One-click unsubscribe that works without signing in        | 🔲 Backlog | [CLOUD]                                                  |
| Dev mode that logs instead of sending                      | 🔲 Backlog | [CLOUD]                                                  |
| Idempotency-keyed sends from the `feed_events` emit points | 🔲 Backlog | [CLOUD]                                                  |
| Confirm a real email renders correctly in an inbox         | 🔲 Backlog | **[MANUAL]**                                             |

---

## 9 — Hardening

The last mile. 7a and 7b are both complete and merged, so this phase is unblocked — half of a
smoke test is checking that error states exist, and they do.

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

| Task                                                                  | Status     | Owner                                                                          |
| --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| A written smoke checklist                                             | 🔲 Backlog | [CLOUD] to draft · **[MANUAL]** to validate — it is derived from the test pass |
| Rate limiting on mutations                                            | 🔲 Backlog | [CLOUD]                                                                        |
| Load sanity — a full CFB Saturday and a season of feed events         | 🔲 Backlog | **[LOCAL]** — needs real row counts, so it needs a database                    |
| A house rules page                                                    | 🔲 Backlog | [CLOUD]                                                                        |
| The new-member path — `/pending`, `/join`, `/no-season` as a sequence | 🔲 Backlog | [CLOUD]                                                                        |

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
