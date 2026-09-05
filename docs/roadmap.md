# Roadmap

Everything this project has built and everything left to build, in one table. Completed items
carry their spec and plan links here rather than a section below — the spec is the authority on
what a subsystem does and [`decisions.md`](decisions.md) on why, so a third summary in this file
would only drift from both.

**Who finishes what.** Claude does as much of this as it can — the lanes below sort by what a
task actually needs, not by who happens to be free.

| Lane       | Means                                                                 | Why it's tagged this way                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[CLOUD]`  | A Claude Code web session, start to finish                            | The default. No local-only resource involved                                                                                                                                                                                                                   |
| `[LOCAL]`  | Claude, run from a machine that holds something a cloud session can't | Docker specifically, or a credential that only exists on that machine — e.g. Conner's production database connection string. A task that only needs the production DB (a migration, a backfill, a reconciliation query) is `[LOCAL]`, not `[NOAH]`             |
| `[MANUAL]` | A human, either of you, by hand                                       | What Claude genuinely cannot do at all, in the cloud or locally — clicking through a signup flow, judging whether a real email rendered, a live call on production data                                                                                        |
| `[NOAH]`   | Noah specifically                                                     | An account or credential **only Noah holds**: GitHub repo admin (Actions secrets, branch protection), the Vercel project dashboard (env vars, deploys, domains), a DNS registrar, or a paid signup needing his payment or identity (Sentry, an email provider) |

See [`repo-health.md`](repo-health.md#status-at-a-glance) for the same tags on repo mechanics.

**What this table records is what is in the repository**, not what is on somebody's laptop.
Where a status cannot be verified from the repo, it says so and dates the observation.

| #   | Item                                                          | Status                                                                                                                                                                                                                                                                        | Who finishes what's left            | Reference                                                                                                                                                                            |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Core betting engine                                           | ✅ Complete                                                                                                                                                                                                                                                                   | —                                   | [spec](specs/2026-08-14-core-betting-engine-design.md)                                                                                                                               |
| 2   | Social layer                                                  | ✅ Complete                                                                                                                                                                                                                                                                   | —                                   | [spec](specs/2026-08-17-social-layer-design.md) · [plan](archive/plans/2026-08-17-social-layer-implementation-plan.md)                                                               |
| 3   | Custom events                                                 | ✅ Complete                                                                                                                                                                                                                                                                   | —                                   | [spec](specs/2026-08-17-custom-events-design.md) · [plan](archive/plans/2026-08-17-custom-events-implementation-plan.md)                                                             |
| 4   | Peer-to-peer bets                                             | ✅ Complete                                                                                                                                                                                                                                                                   | —                                   | [spec](specs/2026-08-19-peer-to-peer-bets-design.md) · [plan](archive/plans/2026-08-19-peer-to-peer-bets-implementation-plan.md)                                                     |
| 5   | [Real data: the ESPN adapter](#5--real-data-the-espn-adapter) | 🔄 In progress — merged to `main`, production cutover pending                                                                                                                                                                                                                 | **[NOAH]**                          | [PR #21](https://github.com/NoahJohn1/SimulatedBetting/pull/21) (merged) · [spec](specs/2026-08-22-espn-adapter-design.md) · [plan](plans/2026-08-22-espn-adapter-implementation.md) |
| 6   | [Production deployment](#6--production-deployment)            | 🔄 Partial — cloud half built; nothing is live until the migration and env vars land                                                                                                                                                                                          | [CLOUD] **[NOAH]** [LOCAL] [MANUAL] | [spec](specs/2026-09-02-production-deployment-design.md) · [plan](archive/plans/2026-09-02-production-deployment-implementation-plan.md)                                             |
| 7a  | UI foundations                                                | ✅ Complete                                                                                                                                                                                                                                                                   | —                                   | [spec](specs/2026-08-22-ui-foundations-design.md) · [plan](archive/plans/2026-08-22-ui-foundations-implementation-plan.md) · [audit](mobile-audit.md)                                |
| 7b  | Design system                                                 | ✅ Complete                                                                                                                                                                                                                                                                   | —                                   | [spec](specs/2026-08-24-design-system-design.md) · [plan](archive/plans/2026-08-24-design-system-implementation-plan.md) · [audit](design-system-audit.md)                           |
| 7c  | [Screen-by-screen rebuild](#7c--screen-by-screen-rebuild)     | ✅ Merged — Tasks 1–13 merged to `main` in [PR #28](https://github.com/NoahJohn1/SimulatedBetting/pull/28), audited against an 80-game slate                                                                                                                                  | —                                   | [PR #28](https://github.com/NoahJohn1/SimulatedBetting/pull/28)                                                                                                                      |
| 7d  | [Craft](#7d--craft)                                           | ✅ Built — Tasks 14–21 on `claude/phase-7d-craft`, audited (structural re-verification + an end-to-end keyboard trace); PR not yet opened                                                                                                                                     | [LOCAL] **[MANUAL]**                | —                                                                                                                                                                                    |
| 8   | [Email notifications](#8--email-notifications)                | 🔄 Merged to `main` in [PR #25](https://github.com/NoahJohn1/SimulatedBetting/pull/25); inert until a provider key is set                                                                                                                                                     | **[NOAH]** [LOCAL] [MANUAL]         | [spec](specs/2026-09-03-email-notifications-design.md) · [plan](plans/2026-09-03-email-notifications-implementation-plan.md)                                                         |
| 9   | [Hardening](#9--hardening)                                    | 🔄 Merged to `main` in [PR #25](https://github.com/NoahJohn1/SimulatedBetting/pull/25) — spot-checked live 2026-09-05 ([repo-health.md](repo-health.md#7-phase-5689-live-verification-2026-09-05)); the [MANUAL] smoke checklist (real Google accounts) still awaits its pass | **[MANUAL]**                        | [spec](specs/2026-09-03-hardening-design.md) · [plan](plans/2026-09-03-hardening-implementation-plan.md)                                                                             |

---

## 5 — Real data: the ESPN adapter

**What it adds.** `EspnOddsProvider`/`EspnScoreProvider`, real NFL and CFB lines and scores,
swapped in behind the existing `OddsProvider`/`ScoreProvider` interfaces
([D2](decisions.md#d2--odds-build-against-fixtures-integrate-a-real-provider-later),
[D49](decisions.md#d49--espns-public-json-is-the-odds-and-score-source-superseding-d2)).

**Status: code complete, merged ([PR #21](https://github.com/NoahJohn1/SimulatedBetting/pull/21)), verified against live ESPN data and a real database.**
Full detail — the payload spike, the live-feed run, the persistence test, a safety finding on
`DATABASE_URL` worth Noah's attention independent of this phase — is in the
[spec](specs/2026-08-22-espn-adapter-design.md) and
[plan](plans/2026-08-22-espn-adapter-implementation.md)'s status notes, not repeated here.

| Task                                                  | Status                                   | Owner                                                                                     |
| ----------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Spike the payload — NFL and CFB, both endpoints       | ✅ Complete                              | —                                                                                         |
| `EspnScoreProvider`                                   | ✅ Complete                              | —                                                                                         |
| `EspnOddsProvider`                                    | ✅ Complete                              | —                                                                                         |
| CFB paging by week and conference group               | ✅ Complete                              | —                                                                                         |
| Defensive parsing — a reshaped field skips its market | ✅ Complete                              | —                                                                                         |
| Kill switch (`ODDS_PROVIDER` env flag)                | ✅ Code complete — not yet set in Vercel | **[NOAH]**                                                                                |
| First real slate — flip the switch, then reconcile    | 🔲 Backlog                               | **[NOAH]** to set `ODDS_PROVIDER=espn` in Vercel · **[LOCAL]** to reconcile once it's set |

**What's left.** One Vercel environment variable is the whole gate. Once `ODDS_PROVIDER=espn` is
set, the existing `*/15` cron starts pulling real data on its own schedule — no separate backfill
step, unless a season needs seeding mid-week. Reconciling what lands only needs the production
database, so that part is `[LOCAL]`, not `[NOAH]`.

**The adapter needs no account, key or secret.** It reads `site.api.espn.com`'s public JSON with
no `Authorization` header — `ODDS_PROVIDER` is the only switch, and `.env.local` is as good a
place to set it as Vercel. So a real slate can be pulled into a local database and looked at
without the production cutover, without Noah, and without touching production:

```bash
ODDS_PROVIDER=espn                                   # in .env.local
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/sync-odds
```

That is the intended way to evaluate the UI against real content rather than fixtures, which is
what [7c](#7c--screen-by-screen-rebuild) needs before it designs anything. It proves nothing
about production — the cutover row above is still the cutover row.

**The honest risk.** Undocumented endpoint, no SLA, can change shape without notice. Mitigated by
the defensive parsing and kill switch above, both already built.

---

## 6 — Production deployment

**What it adds.** Somewhere for the app to run, and a way to know when it breaks: hosted
Postgres, Vercel wiring, cron secrets, Sentry, alerting on cron failure and reconciliation drift,
and two admin screens (health, season creation).

**Status: the `[CLOUD]` half is built and merged** — the `job_runs` table, `raiseAlert` on a
webhook and Sentry, `/admin/health`, `/admin/seasons`. See the
[spec](specs/2026-09-02-production-deployment-design.md) and its (archived, because it shipped)
[plan](archive/plans/2026-09-02-production-deployment-implementation-plan.md). None of it is live
in production until the rows below happen — the code is inert without them by design, not broken.

| Task                                                                  | Status                                     | Owner                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Hosted Postgres, backups, documented restore                          | 🔲 Backlog                                 | **[NOAH]**                                                                                              |
| Vercel wiring — env, `AUTH_URL`, OAuth redirect, migrations on deploy | 🔄 Partial                                 | **[NOAH]**                                                                                              |
| `CRON_SECRET` on the real invocations                                 | 🔲 Backlog                                 | **[NOAH]** — see [repo-health 1.5](repo-health.md#15-the-cron-workflow--the-only-thing-actually-broken) |
| Error monitoring (Sentry)                                             | ✅ Code complete — signup outstanding      | **[NOAH]**                                                                                              |
| Alerting on cron failure and reconciliation drift                     | ✅ Code complete — destination outstanding | **[NOAH]**                                                                                              |
| Admin health page                                                     | ✅ Complete                                | —                                                                                                       |
| Admin season-creation screen                                          | ✅ Complete                                | —                                                                                                       |
| Instrument `sync-odds` with `runJob`                                  | 🔲 Backlog — unblocked now phase 5 merged  | [CLOUD]                                                                                                 |
| **Apply the `job_runs` migration to production**                      | 🔲 Backlog                                 | **[LOCAL]**                                                                                             |
| Create an alert webhook, set `ALERT_WEBHOOK_URL`                      | 🔲 Backlog                                 | **[NOAH]**                                                                                              |
| Sentry signup, set `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`              | 🔲 Backlog                                 | **[NOAH]**                                                                                              |
| Optional `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`            | 🔲 Backlog                                 | **[NOAH]**                                                                                              |
| Break a cron on purpose, confirm the alert arrives                    | 🔲 Backlog                                 | **[MANUAL]**                                                                                            |
| Run the phase-6 DB-backed tests on a desktop with Docker              | 🔲 Backlog                                 | **[LOCAL]**                                                                                             |
| Create and activate the real season from `/admin/seasons`             | 🔲 Backlog                                 | **[MANUAL]**                                                                                            |

**What's left, in order.** The migration first — it's the only row that gates anything; every
other `[NOAH]` item here is a Vercel environment variable that the code already handles being
absent ([D58](decisions.md#d58--cron-health-is-a-job_runs-table-and-sync-odds-is-derived-from-market-freshness),
[D62](decisions.md#d62--sentry-is-inert-without-a-dsn)). From a machine with the production
connection string: `ENV_FILE=.env.production npm run db:migrate` — one transaction per file,
idempotent, safe to re-run. Everything after that can land in any order, whenever convenient;
nothing needs a redeploy.

**Deliberately skipped.** A staging environment — a kill switch plus fast rollback covers what
staging would, for a private group.

---

## 7 — The UI ladder

Four rungs, ordered so the app is shippable after each one. Climb until it looks good enough and
stop there — nothing later in the ladder is a prerequisite for anything outside it.

Each rung's inherited backlog is the record of what an earlier rung deliberately did not do.
Nothing is dropped silently; if a phase declines an item, it lands in the rung that owns it.

### 7c — Screen-by-screen rebuild

Every screen rebuilt against 7b, hot path first, so the rungs pay off in the order people
actually feel them:

Games and the bet slip → Feed → Standings → Bets and Wagers → Events → Me → Admin.

**Status: merged.** Specced and planned with 7d
([spec](specs/2026-09-05-screen-rebuild-and-craft-design.md) ·
[plan](plans/2026-09-05-screen-rebuild-and-craft-implementation-plan.md), decisions
[D74–D79](decisions.md#d74--desktop-is-a-content-column-plus-a-games-slip-rail-not-a-redesign));
Tasks 1–13 are implemented, audited against the real slate, and merged to `main` in
[PR #28](https://github.com/NoahJohn1/SimulatedBetting/pull/28) — see the
[screen-rebuild audit](screen-rebuild-audit.md) and the dispositions below. The design canvas
did not exist when the rebuild ran, so the plan's starting classes shipped; a canvas pass can
adjust visuals in 7d without reopening structure.

**Design against real content first.** The inherited backlog below is largely a list of things
that only show up under real data — odds-board density at 375px, a 60-game CFB Saturday, a
desktop layout that has never existed. Pull a real ESPN slate into a local database before
designing anything; [phase 5](#5--real-data-the-espn-adapter) explains how, and it needs nothing
from Vercel.

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

#### 7c dispositions

Row by row, what the rebuild did with the backlog above (evidence in the
[screen-rebuild audit](screen-rebuild-audit.md)):

| Inherited item                                              | Disposition                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Dialog`, `Sheet`, `Table`, `Toast`                         | **Done** — each born in its first call site's commit (D53's rule held)                           |
| Type/spacing normalization                                  | **Done per rebuilt screen** — the subsets are a plan-wide constraint                             |
| Brand accent                                                | **Done differently** — D75: six member-choice hues, green default; picker is 7d Task 18          |
| `generateMetadata` on detail routes                         | **Done** — feed, event, wager, member detail (member added by the audit)                         |
| Odds-board density at 375px                                 | **Done** — D77 rows; an 80-game day is 9,684px vs ~34,000px for the old full board               |
| Two-up `datetime-local` inputs                              | **Done** — stacked full-width on `/events/new` and `/wagers/new`                                 |
| "Event queueBack to admin" run-together                     | **Done** — plain `<h1>` inside the shell (D78)                                                   |
| Button height +6–8px                                        | **Accepted** — the rebuild kept `Button`'s `h-11`; better tap target                             |
| `FormField` quieter labels                                  | **Accepted** — kept as the design                                                                |
| Card border/radius on ledger and rank rows                  | **Accepted** — kept; those rows render as `Table` at `lg` now anyway                             |
| "Create an event" lost its border                           | **Accepted** — reads unchanged                                                                   |
| No desktop layout                                           | **Done** — D74: header nav + content column + the games slip rail                                |
| Imperceptible dark slip shadow                              | **Done** — Task 1's second shadow layer (1px light top edge)                                     |
| `/admin/events` & `/admin/wagers` latent `mx-auto` overflow | **Done** — `w-full` applied in the D78 move                                                      |
| `Card` adoption unfinished (11 sites)                       | **Mostly done** — `as` prop shipped and adopted; 5 hand-rolled sites remain, listed in the audit |
| Radius vocabulary (45 raw / 10 vocab)                       | **Partially absorbed** — 43 raw / 13 vocab after the rebuild; continues per-screen in 7d         |

### 7d — Craft

**Specced with [7c](#7c--screen-by-screen-rebuild), built after it.** The rungs stay separate —
the app is shippable at the end of 7c, which is the whole point of the ladder — but they share
one spec and one plan.

- Motion and transitions; skeleton loaders in place of spinners
- Accessibility: keyboard paths, focus management, contrast, screen reader labels
- Error and empty-state copy that reads like a person wrote it
- ~~A density pass on the odds board~~ — this landed in **7c's Task 5** instead (D77: the
  two-line `GameRow`, sticky `<details>` day sections, league/day filter chips), not here. This
  bullet predates the finished plan, which put the board rebuild on the 7c side of the rung
  split so 7c alone would already be shippable against a real slate; it is left struck through
  rather than deleted so the record shows the plan changed rather than the work being dropped.

**Status: built.** Tasks 14–21 landed on `claude/phase-7d-craft`
([spec](specs/2026-09-05-screen-rebuild-and-craft-design.md) ·
[plan](plans/2026-09-05-screen-rebuild-and-craft-implementation-plan.md)): the jsdom/RTL
harness, motion behind `prefers-reduced-motion`, per-screen skeletons, the dark-mode toggle, the
per-account accent picker (D75), a keyboard/labels/SR a11y pass, and a copy pass on empty states
and errors. Audited — structurally re-verified against Task 13's protocol plus an end-to-end
keyboard trace from board cell through placement to the toast — in the
[screen-rebuild audit](screen-rebuild-audit.md)'s 7d sections and the dispositions below. Not
yet opened as a PR; two items stay open and don't block that: Task 18's production migration
(`[LOCAL]`) and Noah's phone pass against the live slate (`[MANUAL]`).

#### What 7d inherits

| Item                                                                     | Deferred by       | Why it landed here                                                                                                                                                                                  | Owner   |
| ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A dark-mode toggle — the control, the cookie, and the persistence        | 7b                | The `[data-theme]` selectors already ship; only the control is missing, and a control is craft                                                                                                      | [CLOUD] |
| Focus management, keyboard paths, and SR labels on the shared components | 7b                | Tokens carry contrast; behaviour is this rung's subject                                                                                                                                             | [CLOUD] |
| Revisit the component-test harness question                              | 7b                | [D54](decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51) found 7b's components too simple to earn one. `Dialog` and `Toast` are the ones that would, and they arrive in 7c | [CLOUD] |
| Skeleton loaders replacing the neutral `LoadingScreen`                   | 7a                | A skeleton that does not match its screen is worse than none, and the screens did not exist yet                                                                                                     | [CLOUD] |
| The admin section renders with no header or tab bar on mobile            | 7a (mobile audit) | A structural decision about whether admin joins the app shell, not a styling one                                                                                                                    | [CLOUD] |

#### 7d dispositions

Row by row, what 7d did with the backlog above (evidence in the
[screen-rebuild audit](screen-rebuild-audit.md)'s Task 19 and Task 21 sections):

| Inherited item                                  | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dark-mode toggle — control, cookie, persistence | **Done** — Task 17: a three-state (System/Light/Dark) control, a `theme` cookie the root layout reads, `data-theme` stamped only for the two explicit choices                                                                                                                                                                                                                                                                                            |
| Focus management, keyboard paths, SR labels     | **Done, with one disclosed gap found by this close-out** — Task 19's board→slip→Sheet/Dialog trace, `OddsCell`'s full SR label, and the icon-only-control label sweep all landed; Task 21's end-to-end extension of that trace (through placement to the toast) additionally found that a successful bet placement drops keyboard focus to `document.body` on both the Sheet and rail surfaces — recorded as debt in the audit, not fixed in this commit |
| Component-test harness                          | **Done** — Task 14: a jsdom + React Testing Library project alongside the existing node suite, with behavioural tests for `Dialog`, `Sheet`, and `Toast`                                                                                                                                                                                                                                                                                                 |
| Skeleton loaders replacing `LoadingScreen`      | **Done** — Task 16: a skeleton shaped to each of games/feed/bets/standings/admin, `LoadingScreen` kept only where no screen shape exists yet                                                                                                                                                                                                                                                                                                             |
| Admin — no header/tab bar on mobile             | **Done, ahead of 7d** — resolved by 7c's Task 12 (D78, admin joins the app shell) before any 7d task touched admin; listed here only because the original backlog entry predates that fix                                                                                                                                                                                                                                                                |

---

## 8 — Email notifications

**What it adds.** Email for the handful of events that are time-sensitive — an offer, an
expiring offer, a dispute needing a ruling, account approval — plus digests for settled bets and
the weekly allowance. Per-type toggles and a global off
([D50](decisions.md#d50--notifications-are-opt-out-email-with-per-type-switches)).

**Status: Tasks 1–14 built, merged together with phase 9, and awaiting review in [PR #25](https://github.com/NoahJohn1/SimulatedBetting/pull/25).** Nothing reaches an inbox until the
provider signup below happens — the transport is inert without an API key by design
([D68](decisions.md#d68--the-email-transport-is-inert-without-an-api-key)), not broken.
[Spec](specs/2026-09-03-email-notifications-design.md) ·
[plan](plans/2026-09-03-email-notifications-implementation-plan.md) — 16 tasks, lane-tagged,
decisions [D63–D68](decisions.md#d63--every-send-is-keyed-but-not-every-send-rides-a-feed-event).

| Task                                                               | Status      | Owner        |
| ------------------------------------------------------------------ | ----------- | ------------ |
| Transactional email provider — signup, API key, sending-domain DNS | 🔲 Backlog  | **[NOAH]**   |
| `notification_preferences` table and migration                     | ✅ Complete | [CLOUD]      |
| Per-type toggles plus a global off                                 | ✅ Complete | [CLOUD]      |
| One-click unsubscribe, no sign-in required                         | ✅ Complete | [CLOUD]      |
| Dev mode that logs instead of sending                              | ✅ Complete | [CLOUD]      |
| Idempotency-keyed sends from the `feed_events` emit points         | ✅ Complete | [CLOUD]      |
| Apply the notification migration to production                     | 🔲 Backlog  | **[LOCAL]**  |
| Confirm a real email renders correctly in an inbox                 | 🔲 Backlog  | **[MANUAL]** |

**What's left.** Three rows, none of them `[CLOUD]`: the provider signup, the migration against
production, and one look at a real message in a real inbox. Until the first of those, every send
is written to the outbox and logged rather than transmitted, which is the designed dev-mode
behaviour and what `/admin/health` reports as the live transport.

**Known, recorded, not fixed.** The integration review found that `deliverPending` has no claim
step, so two overlapping flushes can send the same row twice — see
[repo-health 5.1](repo-health.md#51-notification-delivery-has-no-claim-step). It wants a schema
change and belongs to a session of its own, not to a merge.

---

## 9 — Hardening

**What it adds.** A rate limiter on every mutation, a written smoke checklist, a house rules
page, and the new-member path — `/pending`, `/join`, `/no-season`, `/disabled` — treated as one
sequence.

**Status: Tasks 1–10 built, merged together with phase 8, and awaiting review in [PR #25](https://github.com/NoahJohn1/SimulatedBetting/pull/25).**
[Spec](specs/2026-09-03-hardening-design.md) ·
[plan](plans/2026-09-03-hardening-implementation-plan.md) — 11 tasks, decisions
[D69–D73](decisions.md#d69--rate-limiting-is-a-postgres-fixed-window-counter-enforced-at-the-action-boundary).
Load sanity's results are written up in [repo-health.md 3.7](repo-health.md#37-postgres-without-docker-in-a-cloud-session)
and [docs/README.md](README.md), not repeated here.

| Task                                                                               | Status                                | Owner                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| [A written smoke checklist](smoke-checklist.md)                                    | 🔄 Drafted — awaiting a [MANUAL] pass | [CLOUD] to draft · **[MANUAL]** to validate |
| Rate limiting on mutations                                                         | ✅ Complete                           | —                                           |
| Load sanity — a full CFB Saturday and a season of feed events                      | ✅ Complete                           | —                                           |
| A house rules page                                                                 | ✅ Complete                           | —                                           |
| The new-member path — `/pending`, `/join`, `/no-season`, `/disabled` as a sequence | ✅ Complete                           | —                                           |
| Apply the `rate_limits` migration to production                                    | 🔲 Backlog                            | **[LOCAL]**                                 |

**What's left.** Two rows, neither `[CLOUD]`: the migration against production, and the
[MANUAL] pass over the checklist. The checklist ships as an unvalidated draft on purpose; the
pass corrects it rather than writing it from scratch
([D73](decisions.md#d73--the-smoke-checklist-ships-unvalidated-with-a-run-log)).

The limiter is live in code the moment the migration lands. Before that, `consume` fails open
against a missing table ([D70](decisions.md#d70--the-rate-limiter-fails-open-and-counts-attempts-not-successes)),
so the app works and simply does not limit — which is the pre-phase-9 behaviour, not a new failure.

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
