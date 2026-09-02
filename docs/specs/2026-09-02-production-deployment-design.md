# Production deployment — the cloud half — design

_Written 2026-09-02._

**The problem.** [The roadmap](../roadmap.md#6--production-deployment) calls alerting "the item
that earns the phase," and it is right. Four jobs move money on a schedule. Today a `settle` run
that throws returns a 500 into a GitHub Actions log nobody has open, no bet settles, and the
first signal is a member asking why Sunday never graded. `reconcileBalances` and
`reconcileEscrow` already compute the answer to "did money drift" — they have nowhere to shout.
Alongside that, `createSeason` exists in
[`src/server/seasons/service.ts`](../../src/server/seasons/service.ts) but is reachable only from
`seed.ts` and `bootstrap-season.ts`, so starting next season needs shell access to the production
database, which is not a thing you want to discover in September.

**The goal.** After this work, **the app can tell you it is broken before a member does**, and
**starting a season is a screen rather than a shell**. Concretely: every scheduled job records
what it did, a failure or a drift reaches a destination Noah chooses, one admin screen answers
"is it working," and one admin screen creates and activates a season.

**Scope.** The four `[CLOUD]` rows of phase 6 only. Hosted Postgres, Vercel environment wiring,
and `CRON_SECRET` are `[NOAH]` and appear here only where this design depends on them.

---

## 1. Scope

| #   | Item                               | Roadmap row                      | Lane                                  |
| --- | ---------------------------------- | -------------------------------- | ------------------------------------- |
| 1   | `job_runs` — the run record        | Alerting / health page (enabler) | [CLOUD] code · **[NOAH]** migration   |
| 2   | Alerting on cron failure and drift | Alerting on cron failure         | [CLOUD] code · **[NOAH]** destination |
| 3   | Sentry wiring                      | Error monitoring                 | [CLOUD] code · **[NOAH]** signup      |
| 4   | `/admin/health`                    | Admin health page                | [CLOUD]                               |
| 5   | `/admin/seasons`                   | Admin season-creation screen     | [CLOUD]                               |

Item 1 is not a roadmap row of its own. It exists because items 2 and 4 both need to know what
the last run did, and nothing in this repository records that today.

### Measurements this design rests on

Taken 2026-09-02 in the cloud session that wrote this document.

| Claim                                  | Measured                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `node_modules` on session start        | Absent; `npm ci` runs clean                                                                           |
| Docker                                 | Binary present, no daemon — so no Postgres, so `npm test` cannot run here                             |
| `npm run typecheck` / `lint` / `build` | All run in a cloud session                                                                            |
| `@sentry/nextjs` latest                | 10.73.0, peer range `next: ^13.2.0 \|\| ^14.0 \|\| ^15.0.0-rc.0 \|\| ^16.0.0-0` — 16.3.3 is supported |
| Cron routes                            | Four: `sync-odds`, `settle`, `allowance`, `reconcile`. None records anything                          |
| `reconcile`'s alarm today              | HTTP 500 on drift, and nothing else ([`route.ts:21`](../../src/app/api/cron/reconcile/route.ts))      |
| `createSeason` call sites              | `src/db/seed.ts` and `src/db/bootstrap-season.ts`. Zero in `src/app/`                                 |
| `src/app/admin`                        | `page.tsx`, `error.tsx`, `loading.tsx`, `events/`, `wagers/`                                          |
| Decision log                           | Ends at **D57**, so this design's entries are D58–D62                                                 |

**One correction falls out of this.** The brief that commissioned this work said the decision log
was at D56. It is at D57 — [D57](../decisions.md#d57--dependency-majors-blocked-upstream-are-closed-not-ignored)
landed with the Dependabot-majors record earlier the same day.

---

## 2. Architecture

One new server directory, `src/server/ops/`. Three modules, one job each, no shared state.

| Module            | Exports                           | Depends on                     |
| ----------------- | --------------------------------- | ------------------------------ |
| `ops/job-runs.ts` | `runJob(name, fn)`, `lastRuns()`  | `db`, `job_runs`, `ops/alerts` |
| `ops/alerts.ts`   | `raiseAlert(alert)`, `AlertKind`  | `fetch`, Sentry (optional)     |
| `ops/health.ts`   | `readHealth()`, `cronStaleness()` | `db`                           |

The dependency arrow runs one way — `job-runs` calls `alerts`, `alerts` calls nothing in this
repository, `health` calls neither. Nothing outside `src/server/ops/` and `src/app/admin/` changes
shape; the cron routes gain one wrapper call each and are otherwise untouched.

Three modules rather than one file because they have genuinely different dependencies and
genuinely different testability. `alerts` and the pure half of `health` can be tested in a cloud
session with no database. `job-runs` cannot. Splitting them along that line is what lets half
this work carry evidence rather than intent.

---

## 3. `job_runs` — the run record

### Why a table at all

The health page's first question is "when did each cron last succeed," and no existing table
answers it for `reconcile`. A reconcile run that passes writes nothing anywhere: no ledger entry,
no status change, no timestamp. It is precisely the job whose silence is indistinguishable from
its absence, and it is the one the roadmap calls the item that earns the phase.

### The schema

```
job_runs
  id           uuid primary key default gen_random_uuid()
  job          job_name not null            -- enum: SETTLE | ALLOWANCE | RECONCILE
  started_at   timestamptz not null default now()
  finished_at  timestamptz
  ok           boolean not null default false
  summary      jsonb                        -- the object the route already returns
  error        text                         -- "Name: message", never a stack
  alerted      boolean not null default false

  index job_runs_job_started_idx on (job, started_at desc)
```

`summary` holds the route's own return value rather than a second, parallel description of the
run. A hand-written summary is a thing that drifts from the job it describes; the returned object
cannot, because it is the same object. It is stored through the existing `jsonSafe` helper in
[`src/server/cron/auth.ts`](../../src/server/cron/auth.ts), so `bigint` cents survive as decimal
strings and no amount loses precision on the way into jsonb.

`error` is `${err.name}: ${err.message}` and never a stack trace. `job_runs` is read by a web page,
not by an incident responder — Sentry is where the stack goes. The same reasoning keeps member
identifiers out of it.

### Retention

The daily `reconcile` run deletes rows older than 30 days. At 144 `settle` runs a day, steady
state is roughly 4,400 rows, which needs nothing beyond the one index above. Pruning rides an
existing job rather than earning a schedule of its own — the same move
[D37](../decisions.md#d37--events-carry-a-resolve-by-date-overdue-is-derived-and-swept-to-admins)
made for the overdue sweep.

### `runJob`

```ts
export async function runJob<T>(job: JobName, fn: () => Promise<T>): Promise<T>;
```

It inserts a started row, runs `fn`, records the outcome, decides whether to alert, and returns
`fn`'s value — or re-throws its error, unchanged, after recording it. It observes; it does not
handle. The route's status codes are unaffected.

Three properties it must have, in priority order:

1. **Recording failure is never job failure.** The insert and the update are each wrapped so that
   a `job_runs` write that fails is logged and swallowed. A settle run that moved money correctly
   must not be reported as a 500 because a bookkeeping row would not insert. This is also what
   makes the work safe to merge before the migration is applied — see §9.
2. **It runs outside every money transaction.** `job_runs` is not money and must never be able to
   roll one back. `runJob` wraps the call to `settleFinalGames()`, never anything inside it.
3. **A throw is recorded, alerted, and re-thrown.** The route still returns 500. Nothing is
   swallowed except the bookkeeping.

### `sync-odds` is derived, not instrumented

The fourth cron is not wrapped. Two reasons, and the second is the better one.

The immediate reason is a coordination cost: Noah's ESPN adapter work is unpushed and rewrites
`src/server/odds/` and the sync route
([repo-health outstanding 5](../repo-health.md#outstanding)). An edit there today is a merge
conflict in the file he is actively rewriting, bought for one line.

The durable reason is that `max(markets.last_synced_at)` is **better evidence than a run record**.
A `job_runs` row says the handler returned 200. The freshest market timestamp says the sync
actually wrote rows — which is the thing anyone looking at the health page wants to know, and
which stays true through a provider swap that returns success while yielding an empty slate.
`suspendStaleMarkets` already treats `last_synced_at` as the source of truth for staleness
([`sync.ts:218`](../../src/server/odds/sync.ts)); the health page reads the same column the same way.

When the adapter lands, wrapping `sync-odds` in `runJob` is a one-line follow-up. It is recorded
as a task in the roadmap rather than dropped, but it is an addition, not a correction — the
derived reading stays useful either way.

Recorded as [D58](../decisions.md#d58--cron-health-is-a-job_runs-table-and-sync-odds-is-derived-from-market-freshness).

---

## 4. Alerting

### The transport

One environment variable, `ALERT_WEBHOOK_URL`. `raiseAlert` POSTs a JSON body carrying **both**
a `content` key and a `text` key with the same message. Discord's incoming webhooks read
`content` and ignore unknown keys; Slack's read `text` and do the same. Noah pastes in whichever
kind of URL he creates and it works, with no second configuration value naming the service and no
adapter layer to pick between them.

In parallel, and independently, `raiseAlert` calls `Sentry.captureMessage` with a stable
fingerprint per alert kind, so the same class of alert groups into one Sentry issue rather than
N.

Two transports rather than one because they fail differently. Sentry going down or hitting its
free-tier rate limit must not silence the money alarm, and a webhook URL that Noah rotates must
not lose the error history. Neither is a fallback for the other; both fire every time.

Recorded as [D59](../decisions.md#d59--one-generic-webhook-carrying-both-content-and-text).

### The four kinds

| Kind            | Raised when                                                | Carries                                 |
| --------------- | ---------------------------------------------------------- | --------------------------------------- |
| `CRON_FAILED`   | A job threw                                                | Job name, error string, run timestamp   |
| `CRON_ERRORS`   | A job completed with per-item failures (settle's 207 case) | Job name, failure count, first messages |
| `BALANCE_DRIFT` | `reconcileBalances` returned a non-empty array             | Count, and the total absolute drift     |
| `ESCROW_DRIFT`  | `reconcileEscrow` returned a non-empty array               | Count, and the affected wager ids       |

Drift alerts carry counts and totals, not per-member rows. The alert's job is to make someone
open `/admin/health`; it is not a report.

### Firing on transition, not on every failing run

`settle` runs every ten minutes. A settle that breaks on Saturday night would otherwise send 144
identical messages a day, and the reliable outcome of an alarm that cries constantly is that
somebody mutes the channel — at which point the money alarm is off and nobody decided to turn it
off.

The rule, computable from `job_runs` in one query at the moment of recording:

- Alert when the previous recorded run for this job was `ok`, or when there is no previous run.
- Stay quiet while it keeps failing.
- Re-alert if six hours have passed since the last run for this job with `alerted = true`.
- Send one `ok` alert on the first success after a failure — the recovery notice.

`alerted` is a column on `job_runs` rather than separate state, so the suppression decision and
the run history cannot disagree.

Drift alerts are not suppressed. `reconcile` runs daily; one message a day about money that does
not add up is not noise, it is the correct volume.

Recorded as [D60](../decisions.md#d60--alerts-fire-on-transition-not-on-every-failing-run).

### The alarm can never be the outage

`raiseAlert` returns `Promise<void>` and cannot reject. Every path is inside a `try`/`catch` that
logs and returns. The `fetch` carries `AbortSignal.timeout(5_000)`, so a webhook host that accepts
the connection and never answers cannot eat a settle invocation's budget — `settleFinalGames`
already runs against a 45-second budget
([`settle.ts:168`](../../src/server/bets/settle.ts)) and an alerting call that blocks for 30 of it
would cost real settlements.

With `ALERT_WEBHOOK_URL` unset, `raiseAlert` logs one line and returns. The code is inert until
Noah supplies a destination: CI POSTs nowhere, local development POSTs nowhere, and the tests
assert exactly that.

### What does not change

`reconcile` still returns 500 on drift. `settle` still returns 207 on partial failure. Those codes
are what `curl -sf` in [`cron.yml`](../../.github/workflows/cron.yml) reacts to, and
[repo-health §1.5](../repo-health.md#15-the-cron-workflow--the-only-thing-actually-broken)
depends on them. Alerting is added beside the existing signal, never in place of it. A design
that replaced the status code with a webhook would be trading a signal that works for one that
depends on a URL nobody has created yet.

---

## 5. Sentry

`@sentry/nextjs` 10.73.0. Five files, all of them thin:

| File                        | Contains                                                       |
| --------------------------- | -------------------------------------------------------------- |
| `instrumentation.ts`        | `register()` selecting server or edge config; `onRequestError` |
| `sentry.server.config.ts`   | Node-runtime `Sentry.init`                                     |
| `sentry.edge.config.ts`     | Edge-runtime `Sentry.init`                                     |
| `instrumentation-client.ts` | Browser `Sentry.init`                                          |
| `next.config.ts`            | Existing config wrapped in `withSentryConfig`                  |

`onRequestError` is the hook that covers server components, route handlers **and** server actions
in one place, which is exactly the surface the roadmap row asks for. This app's dangerous code is
almost entirely server actions — `placeBet`, `resolveEvent`, the arbitration forms — so a wiring
that missed them would miss the point.

**Every `init` is guarded on a DSN being present.** No `SENTRY_DSN` (server) or
`NEXT_PUBLIC_SENTRY_DSN` (client) means `Sentry.init` is never called and nothing reports. That
keeps CI, `npm test`, and local development silent with no configuration at all, and it means this
can merge and deploy before Noah has opened an account. `withSentryConfig` without
`SENTRY_AUTH_TOKEN` skips source-map upload with a warning rather than failing the build.

`tracesSampleRate` starts at 0. Four users do not need performance monitoring, and the free tier's
quota is better spent on errors. No `tunnelRoute`: ad-blocker evasion is a concern for consumer
traffic, not for a private group of four.

Recorded as [D62](../decisions.md#d62--sentry-is-inert-without-a-dsn).

---

## 6. `/admin/health`

Read-only. Four sections, no controls.

### What it shows, and where each number comes from

| Section            | Number                                       | Source                                                             |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------ |
| **Jobs**           | Last run and last **successful** run per job | `job_runs`, most recent row and most recent `ok = true` per `job`  |
|                    | `sync-odds` last success                     | `max(markets.last_synced_at)`, labelled as derived                 |
|                    | Freshness verdict                            | `cronStaleness()` — a pure function                                |
| **Reconciliation** | Balance discrepancy count and total drift    | The last `RECONCILE` run's `summary`                               |
|                    | Escrow discrepancy count                     | The same                                                           |
|                    | When that was observed                       | That run's `finished_at`                                           |
| **Markets**        | Suspended-stale count                        | `count(*) from markets where status = 'SUSPENDED'`                 |
| **Escrow**         | Total credits held                           | `-sum(ledger_entries.amount_cents) where p2p_wager_id is not null` |

**Reconciliation drift is read from the recorded run, not recomputed.** Recomputing means running
two cross-join queries over every membership and every wager on each page load, and the page is
refreshed by whoever is worried. Reading the record also lets the page state its observation time
honestly — "as of 08:00 today" — instead of implying a number is live when the expensive version
of it would be.

**Escrow total is read from the ledger, not from wager stakes.** The stake columns say what should
be held; the ledger says what is. `reconcileEscrow` already exists to compare the two, so the
health page shows the real one and lets the reconciler own the comparison.

### `cronStaleness`

```ts
export type Freshness = 'fresh' | 'stale' | 'never-run';
export function cronStaleness(
  job: JobName | 'SYNC_ODDS',
  lastSuccessAt: Date | null,
  now: Date,
): Freshness;
```

Thresholds, each roughly three times the job's own interval so a single missed fire is not an
alarm:

| Job         | Interval        | Stale after |
| ----------- | --------------- | ----------- |
| `sync-odds` | every 15 min    | 45 minutes  |
| `settle`    | every 10 min    | 30 minutes  |
| `reconcile` | daily, 08:00    | 26 hours    |
| `allowance` | weekly, Tuesday | 8 days      |

A pure function over three arguments, deliberately. It is the piece of this screen a cloud session
can actually test, and pushing the judgement out of the query and into a function is what makes
that possible.

### Why read-only

A "re-run reconcile now" button is a money operation one click from a status page, on a screen
whose entire purpose is to be opened by someone already anxious. What it adds over waiting for
tomorrow's 08:00 run is small; what it costs is a dangerous control on a page with no other
dangerous controls. If a manual re-run turns out to be wanted, it is a later addition with its own
confirmation, not a thing this screen quietly grows.

### Placement

`src/app/admin/health/page.tsx`, linked from `/admin` beside the existing events and wagers links.
Nested under `admin/`, so `admin/error.tsx` and `admin/loading.tsx` already cover it and
`route-conventions.test.ts` needs no new boundary. `requireAdmin()` at the top, like every other
admin page — the hidden link is a convenience, never the control.

---

## 7. `/admin/seasons`

A list of every season with its status and dates, plus a create form and an activate control.

### Create

The form takes a name, a start date, an end date, and the four economy amounts — starting
bankroll, weekly allowance, starting credits, weekly credit allowance — pre-filled from
[`src/server/seasons/defaults.ts`](../../src/server/seasons/defaults.ts). It calls `createSeason`
in [`src/server/seasons/service.ts`](../../src/server/seasons/service.ts) unchanged, so the screen
and `bootstrap-season.ts` remain the same operation rather than two implementations that can
diverge.

Amounts are entered in whole units and converted to cents at the boundary. The defaults file is
emphatic that its constants are cents and should not be "fixed" to look like the numbers they
render as; a form that takes cents directly is a form that eventually creates a season with a
$100.00 bankroll because someone typed the number they saw.

New seasons are created `UPCOMING`. That is the schema default and it is harmless — an `UPCOMING`
season is joinable by nobody and changes nothing about the running app.

### Activate

A separate control on each `UPCOMING` row. It refuses while another season is `ACTIVE`, and the
refusal names the season in the way rather than saying "conflict."

Two acts rather than one because activation is the half that changes what every member sees, and
because `seasons_one_active_idx` — a partial unique index on `status = 'ACTIVE'` — turns a
careless second activation into a raw database constraint error surfacing through `admin/error.tsx`.
The check is made explicit so the screen explains the situation instead of the boundary catching it.

Ending a season is deliberately not on this screen. The one-button "end the old, create and
activate the new" flow is fewest clicks on the one day a year it is used and is otherwise the most
destructive control in the app, one misclick from ending a live season. Ending stays a
`[MANUAL]`/`[NOAH]` database operation until someone actually needs it, at which point it earns its
own design with its own confirmation.

Recorded as [D61](../decisions.md#d61--the-season-screen-creates-upcoming-activation-is-a-separate-guarded-act).

### Placement

`src/app/admin/seasons/page.tsx` plus `actions.ts`, following the shape `admin/events/` already
uses: the page renders and reads, the action file carries `'use server'` and calls `requireAdmin()`
before doing anything. Linked from `/admin`.

---

## 8. Error handling

Three rules, in priority order.

1. **The alarm can never cause the outage.** `raiseAlert` cannot reject and times out at five
   seconds. `runJob`'s recording is wrapped so a `job_runs` write failure is logged and swallowed.
2. **Existing status codes do not change.** 500 on reconcile drift, 207 on partial settle failure,
   500 on a thrown handler. Observability is added beside the existing signal.
3. **A thrown cron body is recorded, alerted, and re-thrown.** `runJob` observes; the route handles.

For the screens, the existing boundaries do the work: `admin/error.tsx` catches a failed query,
`admin/loading.tsx` covers the wait. Neither screen introduces a new failure mode worth a bespoke
boundary. The health page's own read is written so a missing `job_runs` table degrades to
"never run" rather than throwing — which matters for exactly one deploy, described next.

---

## 9. What must be true before this can merge

The question this section answers: **if Noah does none of his tasks, does merging break anything?**

No — with one exception, and it is the same exception every schema change in this project has had.

| Noah's task                     | If it is not done                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Apply the `job_runs` migration  | **The one real dependency.** See below                                            |
| Create an alert webhook         | `raiseAlert` logs one line and returns. No alerts, no errors, no behaviour change |
| Sign up for Sentry, set the DSN | `Sentry.init` is never called. Nothing reports. The build still succeeds          |
| `SENTRY_AUTH_TOKEN`             | Source maps are not uploaded; the build warns and succeeds                        |
| `CRON_SECRET`, hosted Postgres  | Unchanged by this work — already the state of the world                           |

**The migration is the dependency, and it is soft by design.** Migrations are applied by hand
today; "migrations on deploy" is itself an open `[NOAH]` row on the phase-6 table. If this merges
and deploys before the migration runs, `runJob`'s insert fails against a table that does not
exist — and rule 1 above catches it: the failure is logged and swallowed, `settleFinalGames`
still settles, the routes still return what they returned. The visible consequence is that
`/admin/health` shows every job as "never run" until the migration is applied, and no alerts fire.
Degraded, not broken.

That is a deliberate property, not luck. The alternative — letting a bookkeeping insert fail a
settle run — would mean this observability work could stop the money moving, which is precisely
backwards.

**Nothing here needs to be merged in a particular order relative to Noah's work.** The webhook URL
and the Sentry DSN can be added months later, to a running app, with no redeploy of anything but
the environment.

---

## 10. Testing

Split along the line the cloud session can actually cross.

### Runs in a cloud session — no database

`src/server/ops/__tests__/`:

- `cronStaleness` — every job's threshold, both sides of each boundary, and `never-run` for a null
- `raiseAlert` payload — both `content` and `text` present and equal; the message names the job
- `raiseAlert` with `ALERT_WEBHOOK_URL` unset — no fetch is attempted
- `raiseAlert` when `fetch` rejects, and when it times out — the promise still resolves
- The suppression rule as a pure function over `{ previousOk, lastAlertedAt, now }` — first
  failure alerts, second stays quiet, six hours later re-alerts, first success alerts once

The suppression rule is deliberately extracted as a pure function taking the previous run's shape
rather than tested through the database. It is the piece most likely to be wrong and the piece a
cloud session can prove.

### Needs Postgres — written here, first executed in CI

- `runJob` records a success, a completed-with-errors run, and a throw; the throw propagates
- `runJob` swallows a recording failure without failing the job
- The health reads against seeded rows, including the empty database case
- 30-day pruning removes old rows and keeps recent ones
- `createSeason` through the action; activation refused while another season is `ACTIVE`

**These are written blind.** Say so plainly rather than discovering it in review: the pure tests in
this work carry evidence, and the database-backed ones carry intent until CI runs them. The
implementation plan schedules them accordingly.

### Also runs in a cloud session

`npx drizzle-kit generate` produces the migration SQL by diffing the schema files against
`drizzle/meta`, with no database connection. `npm run db:migrate` needs one and will not be run.

---

## 11. Verification

| Command                          | Cloud session | What it proves                                               |
| -------------------------------- | ------------- | ------------------------------------------------------------ |
| `npm ci`                         | ✅            | `node_modules` starts absent; this is step one, always       |
| `npm run typecheck`              | ✅            |                                                              |
| `npm run lint`                   | ✅            |                                                              |
| `npm run build`                  | ✅            | The Sentry wiring compiles with **no DSN and no auth token** |
| `npm run format`                 | ✅            | Prettier is adopted; `format:check` stays out of `verify`    |
| `npx drizzle-kit generate`       | ✅            | The migration SQL                                            |
| `npm test`                       | ❌            | No Postgres, no Docker daemon. **CI is the first run**       |
| Webhook actually delivering      | ❌            | **[NOAH]** — needs a real URL                                |
| Sentry actually receiving        | ❌            | **[NOAH]** — needs a real DSN                                |
| An alert fired by a real failure | ❌            | **[NOAH]** / **[MANUAL]** — the phase-9 smoke pass           |

`npm run build` is the load-bearing one here. It is the only check in a cloud session that
exercises the Sentry wiring at all, and the specific thing it must prove is that a build with
every Sentry variable unset succeeds — because that is the state of CI, and a Sentry integration
that reddens the gate would be reverted within a day.

---

## 12. Deliberately not in this design

| Not doing                                           | Why                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Touching `src/server/odds/` or the sync cron routes | Noah's unpushed adapter. §3 explains why the derived reading is the better answer anyway                          |
| Wrapping `sync-odds` in `runJob`                    | Follows the adapter. A one-line task, recorded in the roadmap rather than dropped                                 |
| Hosted Postgres, Vercel env, `CRON_SECRET`          | **[NOAH]**. Out of scope by the brief                                                                             |
| Uncommenting the `schedule:` lines in `cron.yml`    | [repo-health outstanding 3](../repo-health.md#outstanding), still blocked on the Actions secrets                  |
| Adding `format:check` to `verify` and CI            | [repo-health outstanding 6](../repo-health.md#outstanding), still blocked on the adapter reconciliation           |
| Actions on the health page                          | §6. A money operation one click from a status screen                                                              |
| Ending a season from the admin screen               | §7. The most destructive control in the app, for a flow used once a year                                          |
| Alert history, an incident log, on-call rotation    | Four users. The webhook destination already keeps the history                                                     |
| A staging environment                               | The roadmap already declined it: a kill switch plus fast rollback covers what staging would, far cheaper          |
| Uptime / synthetic monitoring of the app itself     | Vercel reports its own deployment health, and the crons are the thing that breaks silently. Reconsider in phase 9 |

---

## 13. Documentation

Landing in the same commits as the work they describe:

- This spec, and the implementation plan, both listed in [`docs/README.md`](../README.md) in the
  commit that creates them — the convention that exists because 7a's three documents were invisible
  until 7b's session noticed.
- Five entries in [`decisions.md`](../decisions.md), D58 through D62.
- The phase-6 table in [`roadmap.md`](../roadmap.md#6--production-deployment): the four `[CLOUD]`
  rows move to complete with references, `sync-odds` instrumentation is added as a new row owned by
  the adapter, and the `[NOAH]` rows are left exactly as they are.
- `.env.example` and the environment list in `README.md` gain `ALERT_WEBHOOK_URL`, `SENTRY_DSN`,
  `NEXT_PUBLIC_SENTRY_DSN`, and `SENTRY_AUTH_TOKEN` — each marked optional, each stating what
  happens when it is absent, which for all four is "nothing, silently."
