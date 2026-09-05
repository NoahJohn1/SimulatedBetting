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

**How to keep a phase's section current.** The top table is the whole roadmap at a glance; a
phase's `##`/`###` section below exists only to carry the work still owed on it. Update a
section every time a task in it actually ships — don't let it drift into a history of what was
built.

- **Nothing left owed → no section at all.** Once a phase's top-table row has no lane tags left
  in "Who finishes what's left" (every row in its old task table is done, `[NOAH]` included),
  delete the `##`/`###` heading and everything under it — match rows 1–4, 7a, and 7b: a table
  row with spec/plan/audit links is the whole record. **Never delete information on the way
  out** — if the section held a table with unique detail (an inherited-backlog list, a
  disposition record, a finding) that isn't already captured in that phase's spec or audit doc,
  move it there first, in a section that says where it came from. Then grep the repo for any
  anchor link pointing at the heading you're removing (`grep -rn '#your-anchor-slug'`) and fix or
  redirect every one — a collapsed section's old anchor breaks silently otherwise.
- **Work still owed → keep only what helps someone act.** A one-sentence `**Status:**` line (not
  a restatement of everything that shipped — link the spec instead: "see the spec for what
  shipped"), a task table with **only the still-open rows** (drop `✅ Complete` rows the moment
  they ship; the top table's spec/plan links already cover finished work — don't carry a mixed
  done+open table as history), and any genuinely forward-looking notes (what's left, in what
  order, deliberately skipped, known-but-not-fixed). Cut any paragraph whose only job is
  describing what a subsystem does or how it was built ("What it adds", architecture summaries)
  — that's what the spec is for; a second description in the roadmap only drifts from it.
- **Keep the tags honest.** Every time a row leaves a phase's task table (because it shipped),
  re-derive that phase's top-table "Who finishes what's left" cell from what actually remains —
  drop a lane tag the moment no open row in that phase still needs it.

| #   | Item                                                          | Status                                                                                                                                                                                                                                                                                                                                  | Who finishes what's left | Reference                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Core betting engine                                           | ✅ Complete                                                                                                                                                                                                                                                                                                                             | —                        | [spec](specs/2026-08-14-core-betting-engine-design.md)                                                                                                                                                                                      |
| 2   | Social layer                                                  | ✅ Complete                                                                                                                                                                                                                                                                                                                             | —                        | [spec](specs/2026-08-17-social-layer-design.md) · [plan](archive/plans/2026-08-17-social-layer-implementation-plan.md)                                                                                                                      |
| 3   | Custom events                                                 | ✅ Complete                                                                                                                                                                                                                                                                                                                             | —                        | [spec](specs/2026-08-17-custom-events-design.md) · [plan](archive/plans/2026-08-17-custom-events-implementation-plan.md)                                                                                                                    |
| 4   | Peer-to-peer bets                                             | ✅ Complete                                                                                                                                                                                                                                                                                                                             | —                        | [spec](specs/2026-08-19-peer-to-peer-bets-design.md) · [plan](archive/plans/2026-08-19-peer-to-peer-bets-implementation-plan.md)                                                                                                            |
| 5   | [Real data: the ESPN adapter](#5--real-data-the-espn-adapter) | 🔄 In progress — merged to `main`, production cutover pending                                                                                                                                                                                                                                                                           | **[NOAH]**               | [PR #21](https://github.com/NoahJohn1/SimulatedBetting/pull/21) (merged) · [spec](specs/2026-08-22-espn-adapter-design.md) · [plan](plans/2026-08-22-espn-adapter-implementation.md)                                                        |
| 6   | [Production deployment](#6--production-deployment)            | 🔄 Partial — cloud half built and merged (`sync-odds` now instrumented, [PR #30](https://github.com/NoahJohn1/SimulatedBetting/pull/30)), `job_runs` migration applied to production 2026-09-05; nothing is live until the env vars land                                                                                                | **[NOAH]** [MANUAL]      | [spec](specs/2026-09-02-production-deployment-design.md) · [plan](archive/plans/2026-09-02-production-deployment-implementation-plan.md)                                                                                                    |
| 7a  | UI foundations                                                | ✅ Complete                                                                                                                                                                                                                                                                                                                             | —                        | [spec](specs/2026-08-22-ui-foundations-design.md) · [plan](archive/plans/2026-08-22-ui-foundations-implementation-plan.md) · [audit](mobile-audit.md)                                                                                       |
| 7b  | Design system                                                 | ✅ Complete                                                                                                                                                                                                                                                                                                                             | —                        | [spec](specs/2026-08-24-design-system-design.md) · [plan](archive/plans/2026-08-24-design-system-implementation-plan.md) · [audit](design-system-audit.md)                                                                                  |
| 7c  | Screen-by-screen rebuild                                      | ✅ Merged — Tasks 1–13 merged to `main` in [PR #28](https://github.com/NoahJohn1/SimulatedBetting/pull/28), audited against an 80-game slate                                                                                                                                                                                            | —                        | [PR #28](https://github.com/NoahJohn1/SimulatedBetting/pull/28) · [spec](specs/2026-09-05-screen-rebuild-and-craft-design.md) · [plan](plans/2026-09-05-screen-rebuild-and-craft-implementation-plan.md) · [audit](screen-rebuild-audit.md) |
| 7d  | [Craft](#7d--craft)                                           | ✅ Merged — Tasks 14–21 merged to `main` in [PR #29](https://github.com/NoahJohn1/SimulatedBetting/pull/29), audited (structural re-verification + an end-to-end keyboard trace)                                                                                                                                                        | **[MANUAL]**             | [PR #29](https://github.com/NoahJohn1/SimulatedBetting/pull/29) · [spec](specs/2026-09-05-screen-rebuild-and-craft-design.md) · [plan](plans/2026-09-05-screen-rebuild-and-craft-implementation-plan.md) · [audit](screen-rebuild-audit.md) |
| 8   | [Email notifications](#8--email-notifications)                | 🔄 Merged to `main` in [PR #25](https://github.com/NoahJohn1/SimulatedBetting/pull/25); notification migration applied to production 2026-09-05; inert until a provider key is set                                                                                                                                                      | **[NOAH]** [MANUAL]      | [spec](specs/2026-09-03-email-notifications-design.md) · [plan](plans/2026-09-03-email-notifications-implementation-plan.md)                                                                                                                |
| 9   | [Hardening](#9--hardening)                                    | 🔄 Merged to `main` in [PR #25](https://github.com/NoahJohn1/SimulatedBetting/pull/25) — spot-checked live 2026-09-05 ([repo-health.md](repo-health.md#7-phase-5689-live-verification-2026-09-05)); `rate_limits` migration applied to production 2026-09-05; the [MANUAL] smoke checklist (real Google accounts) still awaits its pass | **[MANUAL]**             | [spec](specs/2026-09-03-hardening-design.md) · [plan](plans/2026-09-03-hardening-implementation-plan.md)                                                                                                                                    |

---

## 5 — Real data: the ESPN adapter

**Status: code complete, merged ([PR #21](https://github.com/NoahJohn1/SimulatedBetting/pull/21)), verified against live ESPN data and a real database.**
See the [spec](specs/2026-08-22-espn-adapter-design.md) and
[plan](plans/2026-08-22-espn-adapter-implementation.md) for what shipped. Only the rows still
owed appear below.

| Task                                               | Status                                   | Owner                                                                                     |
| -------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Kill switch (`ODDS_PROVIDER` env flag)             | ✅ Code complete — not yet set in Vercel | **[NOAH]**                                                                                |
| First real slate — flip the switch, then reconcile | 🔲 Backlog                               | **[NOAH]** to set `ODDS_PROVIDER=espn` in Vercel · **[LOCAL]** to reconcile once it's set |

**What's left.** One Vercel environment variable is the whole gate. Once `ODDS_PROVIDER=espn` is
set, the existing `*/15` cron starts pulling real data on its own schedule — no separate backfill
step, unless a season needs seeding mid-week. Reconciling what lands only needs the production
database, so that part is `[LOCAL]`, not `[NOAH]`.

`ODDS_PROVIDER` needs no account, key, or secret — `.env.local` is as good a place to set it as
Vercel, so a real slate can be pulled into a local database without the production cutover:

```bash
ODDS_PROVIDER=espn                                   # in .env.local
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/sync-odds
```

---

## 6 — Production deployment

**Status: the `[CLOUD]` half is built and merged** — see the
[spec](specs/2026-09-02-production-deployment-design.md) for what shipped. None of it is live in
production until the rows below happen — the code is inert without them by design, not broken.

| Task                                                                  | Status                                     | Owner                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Hosted Postgres, backups, documented restore                          | 🔲 Backlog                                 | **[NOAH]**                                                                                              |
| Vercel wiring — env, `AUTH_URL`, OAuth redirect, migrations on deploy | 🔄 Partial                                 | **[NOAH]**                                                                                              |
| `CRON_SECRET` on the real invocations                                 | 🔲 Backlog                                 | **[NOAH]** — see [repo-health 1.5](repo-health.md#15-the-cron-workflow--the-only-thing-actually-broken) |
| Error monitoring (Sentry)                                             | ✅ Code complete — signup outstanding      | **[NOAH]**                                                                                              |
| Alerting on cron failure and reconciliation drift                     | ✅ Code complete — destination outstanding | **[NOAH]**                                                                                              |
| Create an alert webhook, set `ALERT_WEBHOOK_URL`                      | 🔲 Backlog                                 | **[NOAH]**                                                                                              |
| Sentry signup, set `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`              | 🔲 Backlog                                 | **[NOAH]**                                                                                              |
| Optional `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`            | 🔲 Backlog                                 | **[NOAH]**                                                                                              |
| Break a cron on purpose, confirm the alert arrives                    | 🔲 Backlog                                 | **[MANUAL]**                                                                                            |
| Create and activate the real season from `/admin/seasons`             | 🔲 Backlog                                 | **[MANUAL]**                                                                                            |

**What's left.** The `job_runs` migration landed on production on 2026-09-05 (Supabase-hosted
Postgres); `sync-odds` is now instrumented with `runJob` too
([PR #30](https://github.com/NoahJohn1/SimulatedBetting/pull/30)), and the phase-6 DB-backed test
suite has been re-confirmed against that tree with Docker Postgres up. Every `[NOAH]` item here
is a Vercel environment variable that the code already handles being absent
([D58](decisions.md#d58--cron-health-is-a-job_runs-table-and-sync-odds-is-derived-from-market-freshness),
[D62](decisions.md#d62--sentry-is-inert-without-a-dsn)), and can land in any order, whenever
convenient; nothing needs a redeploy.

**Deliberately skipped.** A staging environment — a kill switch plus fast rollback covers what
staging would, for a private group.

---

## 7 — The UI ladder

Four rungs, ordered so the app is shippable after each one. Climb until it looks good enough and
stop there — nothing later in the ladder is a prerequisite for anything outside it.

Each rung's inherited backlog is the record of what an earlier rung deliberately did not do.
Nothing is dropped silently; if a phase declines an item, it lands in the rung that owns it.

### 7d — Craft

**Status: merged.** Tasks 14–21 merged to `main` in [PR #29](https://github.com/NoahJohn1/SimulatedBetting/pull/29) — see the
[spec](specs/2026-09-05-screen-rebuild-and-craft-design.md) for what shipped and the
[screen-rebuild audit](screen-rebuild-audit.md) for how it was checked.

| Task                                     | Status     | Owner        |
| ---------------------------------------- | ---------- | ------------ |
| Noah's phone pass against the live slate | 🔲 Backlog | **[MANUAL]** |

**Known, recorded, not fixed.** Placing a bet successfully drops keyboard focus to
`document.body` on both the Sheet and rail, because clearing the slip unmounts the button the
focus-restore was targeting — found during the Task 21 close-out, written up in the
[screen-rebuild audit](screen-rebuild-audit.md). It wants a small refactor of the slip's
close/clear ordering and belongs to a session of its own, not to [PR #29](https://github.com/NoahJohn1/SimulatedBetting/pull/29).

---

## 8 — Email notifications

**Status: Tasks 1–14 built, merged together with phase 9 in [PR #25](https://github.com/NoahJohn1/SimulatedBetting/pull/25).** Nothing reaches an inbox until the
provider signup below happens — the transport is inert without an API key by design
([D68](decisions.md#d68--the-email-transport-is-inert-without-an-api-key)), not broken. See the
[spec](specs/2026-09-03-email-notifications-design.md) for what shipped. Only the rows still
owed appear below.

| Task                                                               | Status     | Owner        |
| ------------------------------------------------------------------ | ---------- | ------------ |
| Transactional email provider — signup, API key, sending-domain DNS | 🔲 Backlog | **[NOAH]**   |
| Confirm a real email renders correctly in an inbox                 | 🔲 Backlog | **[MANUAL]** |

**What's left.** The notification migration landed on production on 2026-09-05. Two rows remain,
neither `[CLOUD]`: the provider signup and one look at a real message in a real inbox. Until the
first of those, every send is written to the outbox and logged rather than transmitted, which is
the designed dev-mode behaviour and what `/admin/health` reports as the live transport.

**Known, recorded, not fixed.** The integration review found that `deliverPending` has no claim
step, so two overlapping flushes can send the same row twice — see
[repo-health 5.1](repo-health.md#51-notification-delivery-has-no-claim-step). It wants a schema
change and belongs to a session of its own, not to a merge.

---

## 9 — Hardening

**Status: Tasks 1–10 built, merged together with phase 8 in [PR #25](https://github.com/NoahJohn1/SimulatedBetting/pull/25).**
See the [spec](specs/2026-09-03-hardening-design.md) for what shipped. Only the rows still owed
appear below.

| Task                                            | Status                                | Owner                                       |
| ----------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| [A written smoke checklist](smoke-checklist.md) | 🔄 Drafted — awaiting a [MANUAL] pass | [CLOUD] to draft · **[MANUAL]** to validate |

**What's left.** The `rate_limits` migration landed on production on 2026-09-05, so the limiter is
now live there. One row remains: the [MANUAL] pass over the smoke checklist. The checklist ships
as an unvalidated draft on purpose; the pass corrects it rather than writing it from scratch
([D73](decisions.md#d73--the-smoke-checklist-ships-unvalidated-with-a-run-log)).

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
