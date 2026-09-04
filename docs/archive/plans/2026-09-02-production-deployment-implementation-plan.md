# Production deployment — the cloud half — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app able to tell you it is broken before a member does, and make starting a
season a screen rather than a shell.

**Architecture:** Eleven tasks. One new server directory, `src/server/ops/`, holding four small modules — a pure
alert-suppression rule, an alert transport, a `runJob` wrapper the three touchable cron routes call,
and the health reads. One new table, `job_runs`. Two new admin screens. Sentry wired through
`instrumentation.ts` and inert without a DSN.

**Tech Stack:** Next.js 16.3.3 (App Router), TypeScript, Drizzle ORM + Postgres, Vitest,
`@sentry/nextjs` 10.x, Tailwind v4 with this repo's semantic token layer.

**Spec:** [`docs/specs/2026-09-02-production-deployment-design.md`](../../specs/2026-09-02-production-deployment-design.md).
Read it before Task 1. Decisions [D58](../../decisions.md#d58--cron-health-is-a-job_runs-table-and-sync-odds-is-derived-from-market-freshness)
through [D62](../../decisions.md#d62--sentry-is-inert-without-a-dsn) are already recorded.

---

## Global Constraints

These apply to every task. They are not repeated per task.

- **Lane tags are mandatory.** Every task below carries `[CLOUD]`, `[LOCAL]`, `[MANUAL]`, or
  `[NOAH]`. Do not start a task whose lane you are not in.
- **Do not touch `src/server/odds/` or `src/app/api/cron/sync-odds/route.ts`.** Noah has unpushed
  ESPN adapter work there. A conflict is expensive and this plan is designed to avoid one entirely.
  If a task seems to need an edit there, you have misread the task.
- **`npm ci` first.** `node_modules` is absent at the start of a cloud session.
- **`npm test` cannot run in a cloud session.** There is no Postgres and no Docker daemon. Tests
  marked **DB** in this plan are written but not executed until CI. Tests marked **pure** run here
  and must be run here. Never report a DB test as passing.
- **`npm run verify` cannot run in full either** — it ends in `npm test`. Run
  `npm run typecheck && npm run lint` as the cloud-session stand-in, then `npm run build`.
- **Run `npm run format` before every commit.** Prettier is adopted
  ([D55](../../decisions.md#d55--prettier-adopted-with-a-config-matched-to-the-existing-code)).
  `format:check` is deliberately **not** in `verify` or CI — do not add it, that is
  [repo-health outstanding 6](../../repo-health.md#outstanding) and it is blocked on Noah.
- **Money is `bigint` cents everywhere.** Never `Number` an amount. `JSON.stringify` throws on
  bigint — route through `jsonSafe` in `src/server/cron/auth.ts`.
- **No raw colour classes in `.tsx`.** `src/app/__tests__/token-lint.test.ts` fails the build on a
  raw palette class, a hex value, or a `dark:` variant outside a four-entry allowlist. Use the
  semantic tokens the existing components use (`text-ink-muted`, `bg-surface-raised`,
  `border-line`, …).
- **Every admin page calls `requireAdmin()` server-side.** Hiding a link is never the control.
- **Alerting can never be the outage.** No code path added by this plan may let a logging,
  recording, or alerting failure change what a cron route returns.
- **Commit after every task.** Message style: imperative subject, a body explaining why, and the
  attribution footer this repo uses.

---

## File Structure

| File                                      | New?      | Responsibility                                          |
| ----------------------------------------- | --------- | ------------------------------------------------------- |
| `src/db/schema/ops.ts`                    | new       | The `job_name` enum and the `job_runs` table            |
| `src/db/schema/index.ts`                  | modify    | Re-export `./ops`                                       |
| `src/test/db.ts`                          | modify    | Add `job_runs` to the `TRUNCATE` list                   |
| `drizzle/0014_*.sql`                      | generated | The `job_runs` migration                                |
| `src/sentry.server.config.ts`             | new       | Node-runtime `Sentry.init`, guarded on a DSN            |
| `src/sentry.edge.config.ts`               | new       | Edge-runtime `Sentry.init`, guarded on a DSN            |
| `src/instrumentation.ts`                  | new       | `register()` and `onRequestError`                       |
| `src/instrumentation-client.ts`           | new       | Browser `Sentry.init` and router-transition hook        |
| `next.config.ts`                          | modify    | Wrap in `withSentryConfig`                              |
| `src/app/global-error.tsx`                | modify    | Report the caught error to Sentry                       |
| `src/server/ops/alert-policy.ts`          | new       | `shouldAlert` — the pure suppression rule, zero imports |
| `src/server/ops/alerts.ts`                | new       | `raiseAlert`, `formatAlert` — the transports            |
| `src/server/ops/job-runs.ts`              | new       | `runJob`, `pruneJobRuns`                                |
| `src/server/ops/health.ts`                | new       | `cronStaleness`, `formatAge`, `readHealth`              |
| `src/app/api/cron/settle/route.ts`        | modify    | Wrap the body in `runJob`                               |
| `src/app/api/cron/allowance/route.ts`     | modify    | Wrap the body in `runJob`                               |
| `src/app/api/cron/reconcile/route.ts`     | modify    | Wrap in `runJob`, raise drift alerts, prune             |
| `src/app/admin/health/page.tsx`           | new       | The health screen                                       |
| `src/app/admin/seasons/page.tsx`          | new       | The season list and create form                         |
| `src/app/admin/seasons/parse.ts`          | new       | `parseAmountToCents` — dollars in, `bigint` cents out   |
| `src/app/admin/seasons/actions.ts`        | new       | `createSeasonAction`, `activateSeasonAction`            |
| `src/app/admin/seasons/season-form.tsx`   | new       | Client form, `useState` + `useTransition`               |
| `src/app/admin/seasons/activate-form.tsx` | new       | Client activate control                                 |
| `src/app/admin/page.tsx`                  | modify    | Two links                                               |
| `.env.example`, `README.md`               | modify    | Four optional variables                                 |
| `docs/README.md`, `docs/roadmap.md`       | modify    | Rows and statuses                                       |

`alert-policy.ts` is split out of `job-runs.ts` rather than living inside it, for the reason the
spec's §2 gives: it is the piece most likely to be wrong and the piece a cloud session can prove,
and a file with zero imports can be tested with no database anywhere in its import graph.

---

## Before you start

- [ ] `npm ci`
- [ ] `git switch -c claude/phase-6-production-deployment-ea16n1` (or stay on it if already there)
- [ ] Read the spec: `docs/specs/2026-09-02-production-deployment-design.md`
- [ ] Confirm the environment: `node -v` (expect v22.x), `docker info` (expect failure — this is
      normal and is why `npm test` is off the table)

---

### Task 1 [CLOUD]: The `job_runs` table

**Files:**

- Create: `src/db/schema/ops.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/db.ts`
- Generated: `drizzle/0014_<name>.sql` and `drizzle/meta/*`

**Interfaces:**

- Produces: `jobRuns` (Drizzle table), `jobName` (pgEnum), `type JobName = 'SETTLE' | 'ALLOWANCE' | 'RECONCILE'`.
  Every later task imports these from `@/db/schema`.

There is no test in this task. A schema declaration has no behaviour of its own, and the first
thing that asserts against it is Task 5's `runJob` test. The verification here is that the
migration generates and the types compile.

- [ ] **Step 1: Write the schema module**

Create `src/db/schema/ops.ts`:

```ts
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const jobName = pgEnum('job_name', ['SETTLE', 'ALLOWANCE', 'RECONCILE']);

export type JobName = (typeof jobName.enumValues)[number];

/**
 * One row per scheduled-job invocation, written by `runJob` (D58).
 *
 * It exists because `reconcile` leaves no other trace: a passing run writes no ledger entry,
 * changes no status and touches no timestamp, so its silence is indistinguishable from its
 * absence. `sync-odds` is deliberately not in the `job_name` enum — its health is read from
 * `max(markets.last_synced_at)`, which proves the sync wrote rows rather than that a handler
 * returned 200.
 *
 * `ok` means the run was CLEAN: it completed without throwing *and* reported no per-item
 * failures. A settle pass that could not grade one game is not a successful settle pass.
 *
 * `error` is `"Name: message"` and never a stack — this table is read by a web page, and the
 * stack belongs in Sentry.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    job: jobName('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok').notNull().default(false),
    /** The object the route already returns, through `jsonSafe` so bigint cents survive. */
    summary: jsonb('summary'),
    error: text('error'),
    /** Whether this run raised an alert. The suppression rule in `alert-policy.ts` reads it. */
    alerted: boolean('alerted').notNull().default(false),
  },
  (t) => [index('job_runs_job_started_idx').on(t.job, t.startedAt.desc())],
);
```

If `t.startedAt.desc()` fails to typecheck on this Drizzle version, use
`index('job_runs_job_started_idx').on(t.job, t.startedAt)` instead and move on — the ordering is an
optimisation, not a correctness property, and every query in this plan is bounded by `limit 1` or a
`group by`.

- [ ] **Step 2: Re-export it**

In `src/db/schema/index.ts`, append after the existing exports:

```ts
export * from './ops';
```

- [ ] **Step 3: Add the table to the test reset**

In `src/test/db.ts`, add `job_runs` to the front of the `TRUNCATE` list. Without this, a run row
from one test file leaks into the next and Task 5's assertions become order-dependent:

```ts
export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE job_runs, feed_reactions, feed_comments, feed_events, feed_preferences, ledger_entries, p2p_wagers, bet_legs, bets, odds_snapshots, selections, markets, games, custom_event_disputes, custom_events, events, teams, season_memberships, seasons, users RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate`

Expected: a new `drizzle/0014_<random-name>.sql` plus updated `drizzle/meta/`. This needs **no
database** — it diffs the schema files against the meta snapshot.

Open the generated SQL and confirm it contains `CREATE TYPE "public"."job_name"`, `CREATE TABLE
"job_runs"`, and `CREATE INDEX "job_runs_job_started_idx"`, and that it contains **no** `ALTER` or
`DROP` against any existing table. If it does, the schema module has an unintended edit — fix that
rather than editing the generated SQL.

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0.

- [ ] **Step 6: Format and commit**

```bash
npm run format
git add src/db/schema/ops.ts src/db/schema/index.ts src/test/db.ts drizzle/
git commit -m "feat(ops): add the job_runs table

Scheduled jobs record nothing today, and reconcile in particular leaves no
trace at all when it passes — no ledger entry, no status change, no timestamp.
This is the table the health page and the alerting rule both read (D58).

sync-odds is deliberately absent from the job_name enum; its health comes from
max(markets.last_synced_at), which says the sync wrote rows rather than that a
handler returned 200."
```

---

### Task 2 [CLOUD]: Sentry, inert without a DSN

**Files:**

- Modify: `package.json`, `package-lock.json`
- Create: `src/sentry.server.config.ts`, `src/sentry.edge.config.ts`, `src/instrumentation.ts`,
  `src/instrumentation-client.ts`
- Modify: `next.config.ts`, `src/app/global-error.tsx`

**Interfaces:**

- Produces: nothing importable. Task 4 relies on `Sentry.captureMessage` being a safe no-op when
  `init` was never called, which is what this task's DSN guard guarantees.

This task comes before the alerting modules because `alerts.ts` imports `@sentry/nextjs` directly.

**This is the task with the plan's one genuine unknown**, called out in Step 5: whether
`withSentryConfig` builds clean with no Sentry environment variables set at all. Step 5 tests it and
Step 6 is the documented fallback.

- [ ] **Step 1: Install**

```bash
npm install --save-exact @sentry/nextjs@10.73.0
```

Pinned exact because the roadmap's monthly Dependabot run is what moves dependencies here
([D57](../../decisions.md#d57--dependency-majors-blocked-upstream-are-closed-not-ignored)), and a
caret on a monitoring SDK is a floating build input for no benefit.

- [ ] **Step 2: The two server-side init modules**

Create `src/sentry.server.config.ts`:

```ts
import * as Sentry from '@sentry/nextjs';

/**
 * Guarded on a DSN being present, deliberately (D62). Absent, `init` is never called, every
 * `Sentry.capture*` is a no-op, and CI, the test suite and local development report nothing
 * with no configuration at all. That is what lets this wiring merge before the signup exists.
 */
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Four users generate no performance question worth the free tier's quota.
    tracesSampleRate: 0,
  });
}
```

Create `src/sentry.edge.config.ts` with the identical body. It is a duplicate of six lines rather
than a shared import because Next bundles the two runtimes separately and a shared module is a
bundling problem traded for nothing.

- [ ] **Step 3: The instrumentation hooks**

Create `src/instrumentation.ts`:

```ts
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * The one hook that covers server components, route handlers AND server actions. This app's
 * dangerous code is almost entirely server actions — placeBet, resolveEvent, the arbitration
 * forms — so a wiring that missed them would miss the point.
 */
export const onRequestError = Sentry.captureRequestError;
```

Create `src/instrumentation-client.ts`:

```ts
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0 });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

- [ ] **Step 4: Wrap the Next config**

Replace `next.config.ts` with:

```ts
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {/* config options here */};

// Source-map upload needs SENTRY_AUTH_TOKEN. Without it the plugin warns and skips, which is
// the state of CI and of every cloud session — see the spec's §11.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  disableLogger: true,
});
```

- [ ] **Step 5: Prove the build survives with no Sentry environment at all**

This is the load-bearing check. Run it with every Sentry variable explicitly unset, the way CI
sees it:

```bash
env -u SENTRY_DSN -u NEXT_PUBLIC_SENTRY_DSN -u SENTRY_AUTH_TOKEN -u SENTRY_ORG -u SENTRY_PROJECT \
  DATABASE_URL=postgres://x npm run build
```

Expected: exit 0, ~32 routes compiled. Warnings from the Sentry plugin about a missing auth token
or missing org/project are **expected and fine** — a warning is not a failure.

- [ ] **Step 6: Fallback, only if Step 5 fails**

If and only if `withSentryConfig` _errors_ rather than warns, make the wrapping conditional and
record why in the commit message:

```ts
const withSentry = process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: !process.env.CI,
      disableLogger: true,
    })
  : nextConfig;

export default withSentry;
```

Then re-run Step 5 and confirm exit 0. Note the consequence in the commit body: with this fallback,
CI never exercises the wrapped config, so the first time the plugin runs for real is Noah's first
deploy with a DSN set.

- [ ] **Step 7: Report the global error boundary to Sentry**

`src/app/global-error.tsx` catches errors thrown by the root layout itself. It is the one place
where an exception currently reaches a user with nothing recording it, so it is worth the capture.

Two things about that file to preserve, both deliberate and both commented in it:

- It renders its own inline-styled markup rather than delegating to `StatusScreen`, because the
  app's own CSS may be what failed to load. `route-conventions.test.ts` does **not** cover it —
  its regex requires `error.tsx` to follow a `/`, and `global-error.tsx` does not match. Do not
  "fix" it to use a shared component.
- It currently destructures only `retry`; `error` is declared in the props type but unused. You
  need to start destructuring `error` for this change.

Add to the top of the file, after `'use client';`:

```tsx
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
```

Change the signature to take `error`:

```tsx
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
```

And add, as the first statement in the body:

```tsx
// A root-layout throw is the one failure a user sees with nothing recording it. No-op
// without a DSN, like every other Sentry call in this app (D62).
useEffect(() => {
  Sentry.captureException(error);
}, [error]);
```

Do not touch the returned JSX.

- [ ] **Step 8: Verify**

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0.

- [ ] **Step 9: Format and commit**

```bash
npm run format
git add package.json package-lock.json next.config.ts src/sentry.*.config.ts src/instrumentation*.ts src/app/global-error.tsx
git commit -m "feat(ops): wire Sentry, inert without a DSN

onRequestError is the one hook covering server components, route handlers and
server actions, which is where this app's dangerous code actually lives.

Every init is guarded on a DSN, so CI, the test suite and local development
report nothing with no configuration at all (D62). That is what lets this
merge and deploy before Noah has opened an account — verified by building with
every Sentry variable unset."
```

---

### Task 3 [CLOUD]: `shouldAlert` — the suppression rule

**Files:**

- Create: `src/server/ops/alert-policy.ts`
- Test: `src/server/ops/__tests__/alert-policy.test.ts`

**Interfaces:**

- Produces: `shouldAlert(input: AlertDecision): boolean`, `REALERT_AFTER_MS: number`,
  `interface AlertDecision { previousOk: boolean | null; lastAlertedAt: Date | null; ok: boolean; now: Date }`.
  Task 5's `runJob` calls it.

Tests here are **pure** — they run in a cloud session, and they must be run.

- [ ] **Step 1: Write the failing tests**

Create `src/server/ops/__tests__/alert-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REALERT_AFTER_MS, shouldAlert } from '@/server/ops/alert-policy';

const now = new Date('2026-09-02T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('shouldAlert', () => {
  it('alerts on the first recorded failure', () => {
    expect(shouldAlert({ previousOk: null, lastAlertedAt: null, ok: false, now })).toBe(true);
  });

  it('alerts when a healthy job starts failing', () => {
    expect(shouldAlert({ previousOk: true, lastAlertedAt: null, ok: false, now })).toBe(true);
  });

  it('stays quiet while a job keeps failing', () => {
    expect(
      shouldAlert({ previousOk: false, lastAlertedAt: ago(10 * 60_000), ok: false, now }),
    ).toBe(false);
  });

  it('re-alerts once the quiet period has elapsed', () => {
    expect(
      shouldAlert({ previousOk: false, lastAlertedAt: ago(REALERT_AFTER_MS), ok: false, now }),
    ).toBe(true);
  });

  it('stays quiet one millisecond before the quiet period elapses', () => {
    expect(
      shouldAlert({ previousOk: false, lastAlertedAt: ago(REALERT_AFTER_MS - 1), ok: false, now }),
    ).toBe(false);
  });

  it('alerts if it is failing and has somehow never alerted', () => {
    expect(shouldAlert({ previousOk: false, lastAlertedAt: null, ok: false, now })).toBe(true);
  });

  it('sends one recovery notice on the first success after a failure', () => {
    expect(shouldAlert({ previousOk: false, lastAlertedAt: ago(60_000), ok: true, now })).toBe(
      true,
    );
  });

  it('says nothing about a success that follows a success', () => {
    expect(shouldAlert({ previousOk: true, lastAlertedAt: null, ok: true, now })).toBe(false);
  });

  it('says nothing about the very first run when it succeeds', () => {
    expect(shouldAlert({ previousOk: null, lastAlertedAt: null, ok: true, now })).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/server/ops/__tests__/alert-policy.test.ts`

Expected: FAIL — `Failed to resolve import "@/server/ops/alert-policy"`.

(Use `npx vitest run <path>` rather than `npm test` throughout this plan. `npm test` runs the whole
suite, most of which needs Postgres and will fail here for reasons unrelated to your change.)

- [ ] **Step 3: Write the implementation**

Create `src/server/ops/alert-policy.ts`:

```ts
/**
 * When a job outcome is worth announcing (D60).
 *
 * `settle` runs every ten minutes. Alerting on every failing run is 144 identical messages a
 * day, and the reliable outcome of an alarm that cries constantly is that somebody mutes the
 * channel — at which point the money alarm is off and nobody decided to turn it off.
 *
 * Deliberately a pure function with no imports at all. It is the piece of this subsystem most
 * likely to be wrong and the only piece a cloud session can prove, and nothing in its import
 * graph should need a database.
 */

export const REALERT_AFTER_MS = 6 * 60 * 60 * 1_000;

export interface AlertDecision {
  /** Whether the previous *finished* run of this job was clean. `null` if there wasn't one. */
  previousOk: boolean | null;
  /** When this job last raised an alert. `null` if it never has. */
  lastAlertedAt: Date | null;
  /** Whether the run being recorded right now is clean. */
  ok: boolean;
  now: Date;
}

export function shouldAlert({ previousOk, lastAlertedAt, ok, now }: AlertDecision): boolean {
  // A success is worth announcing only as a recovery — the first one after a failure.
  if (ok) return previousOk === false;

  // A failure that follows a success, or the first run on record, is the transition.
  if (previousOk === null || previousOk) return true;

  // Still failing. Quiet, unless it has been quiet long enough that a reminder is warranted.
  if (lastAlertedAt === null) return true;
  return now.getTime() - lastAlertedAt.getTime() >= REALERT_AFTER_MS;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/server/ops/__tests__/alert-policy.test.ts`

Expected: PASS, 9 tests.

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add src/server/ops/alert-policy.ts src/server/ops/__tests__/alert-policy.test.ts
git commit -m "feat(ops): add the alert suppression rule

Alerts fire on transition, with a six-hour reminder floor and one recovery
notice (D60). settle runs every ten minutes, so alerting per failing run is
144 messages a day and a muted channel.

Pure, with no imports, so it is testable in a cloud session where nothing that
touches Postgres is."
```

---

### Task 4 [CLOUD]: `raiseAlert` — the transports

**Files:**

- Create: `src/server/ops/alerts.ts`
- Test: `src/server/ops/__tests__/alerts.test.ts`

**Interfaces:**

- Consumes: `@sentry/nextjs` from Task 2.
- Produces: `raiseAlert(alert: Alert): Promise<void>`, `formatAlert(alert: Alert): string`,
  `type AlertKind = 'CRON_FAILED' | 'CRON_ERRORS' | 'CRON_RECOVERED' | 'BALANCE_DRIFT' | 'ESCROW_DRIFT'`,
  `interface Alert { kind: AlertKind; message: string; context?: Record<string, string | number> }`.
  Tasks 5 and 6 call `raiseAlert`.

Tests here are **pure** — they run in a cloud session and must be run.

- [ ] **Step 1: Write the failing tests**

Create `src/server/ops/__tests__/alerts.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAlert, raiseAlert } from '@/server/ops/alerts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('formatAlert', () => {
  it('leads with the kind and appends each context line', () => {
    const body = formatAlert({
      kind: 'BALANCE_DRIFT',
      message: 'Two memberships disagree with the ledger.',
      context: { pairs: 2, totalDriftCents: '1500' },
    });

    expect(body).toBe(
      '[BALANCE_DRIFT] Two memberships disagree with the ledger.\npairs: 2\ntotalDriftCents: 1500',
    );
  });

  it('is just the line when there is no context', () => {
    expect(formatAlert({ kind: 'CRON_RECOVERED', message: 'settle is green again.' })).toBe(
      '[CRON_RECOVERED] settle is green again.',
    );
  });
});

describe('raiseAlert', () => {
  it('posts a body carrying both content and text, so Discord and Slack both accept it', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await raiseAlert({ kind: 'CRON_FAILED', message: 'settle threw.' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example/abc');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body);
    expect(body.content).toBe('[CRON_FAILED] settle threw.');
    expect(body.text).toBe(body.content);
  });

  it('posts nothing when no webhook is configured', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      raiseAlert({ kind: 'CRON_FAILED', message: 'settle threw.' }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves when the webhook rejects — the alarm can never be the outage', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(raiseAlert({ kind: 'ESCROW_DRIFT', message: 'drift.' })).resolves.toBeUndefined();
  });

  it('resolves when the webhook answers non-2xx', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(raiseAlert({ kind: 'ESCROW_DRIFT', message: 'drift.' })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('carries a timeout, so a webhook that never answers cannot eat a settle budget', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await raiseAlert({ kind: 'CRON_FAILED', message: 'settle threw.' });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/server/ops/__tests__/alerts.test.ts`

Expected: FAIL — `Failed to resolve import "@/server/ops/alerts"`.

- [ ] **Step 3: Write the implementation**

Create `src/server/ops/alerts.ts`:

```ts
import * as Sentry from '@sentry/nextjs';

export type AlertKind =
  'CRON_FAILED' | 'CRON_ERRORS' | 'CRON_RECOVERED' | 'BALANCE_DRIFT' | 'ESCROW_DRIFT';

export interface Alert {
  kind: AlertKind;
  /** One line. This is what lands in the chat channel. */
  message: string;
  /** Counts and ids only. The alert's job is to make someone open /admin/health. */
  context?: Record<string, string | number>;
}

const WEBHOOK_TIMEOUT_MS = 5_000;

export function formatAlert(alert: Alert): string {
  const lines = [`[${alert.kind}] ${alert.message}`];
  for (const [key, value] of Object.entries(alert.context ?? {})) {
    lines.push(`${key}: ${value}`);
  }
  return lines.join('\n');
}

/**
 * Raise an alert on both transports (D59). Cannot reject, ever.
 *
 * A dead webhook must not be able to fail a settle run — that would make the alarm the outage.
 * Both transports fire every time and neither is the other's fallback: Sentry hitting its
 * free-tier rate limit must not silence the money alarm, and a rotated webhook URL must not
 * lose the error history.
 */
export async function raiseAlert(alert: Alert): Promise<void> {
  const body = formatAlert(alert);
  sendToSentry(alert, body);
  await sendToWebhook(body);
}

async function sendToWebhook(body: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;

  if (!url) {
    // Inert until Noah supplies a destination. Not an error — this is the expected state in
    // CI, in the test suite, and in local development.
    console.warn(`[alert] ALERT_WEBHOOK_URL is not set, so this was not sent:\n${body}`);
    return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Discord's incoming webhooks read `content`, Slack's read `text`, and each ignores
      // unknown keys — so one body works for either without a second config value naming
      // which service it is (D59).
      body: JSON.stringify({ content: body, text: body }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[alert] webhook answered ${response.status}; alert not delivered:\n${body}`);
    }
  } catch (err) {
    console.error(`[alert] webhook POST failed; alert not delivered:\n${body}`, err);
  }
}

function sendToSentry(alert: Alert, body: string): void {
  try {
    // A no-op when Sentry.init was never called, which is the state without a DSN (D62).
    Sentry.captureMessage(body, {
      level: 'error',
      // One issue per alert kind rather than one per occurrence.
      fingerprint: ['simbet-alert', alert.kind],
      tags: { alert_kind: alert.kind },
    });
  } catch (err) {
    console.error('[alert] Sentry capture failed', err);
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/server/ops/__tests__/alerts.test.ts`

Expected: PASS, 6 tests.

If importing `@sentry/nextjs` misbehaves under Vitest's node environment, replace the static import
with a guarded dynamic one inside `sendToSentry` and make it `async`, awaited alongside the webhook:

```ts
async function sendToSentry(alert: Alert, body: string): Promise<void> {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureMessage(body, {/* as above */});
  } catch (err) {
    console.error('[alert] Sentry capture failed', err);
  }
}
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/server/ops/alerts.ts src/server/ops/__tests__/alerts.test.ts
git commit -m "feat(ops): add raiseAlert, on a webhook and Sentry

One ALERT_WEBHOOK_URL, POSTing a body that carries both content and text —
Discord reads one, Slack reads the other, and each ignores the rest, so either
kind of URL works with no second config value naming the service (D59).

raiseAlert cannot reject and times out at five seconds. A dead webhook must
not be able to fail a settle run; that would make the alarm the outage."
```

---

### Task 5 [CLOUD]: `runJob`, and the settle and allowance routes

**Files:**

- Create: `src/server/ops/job-runs.ts`
- Test: `src/server/ops/__tests__/job-runs.test.ts` (**DB** — written here, first run in CI)
- Modify: `src/app/api/cron/settle/route.ts`
- Modify: `src/app/api/cron/allowance/route.ts`

**Interfaces:**

- Consumes: `jobRuns`, `JobName` (Task 1); `shouldAlert`, `AlertDecision` (Task 3);
  `raiseAlert`, `AlertKind` (Task 4); `jsonSafe` from `@/server/cron/auth`.
- Produces: `runJob<T>(job: JobName, fn: () => Promise<T>, options?: RunJobOptions<T>): Promise<T>`,
  `pruneJobRuns(olderThanDays?: number): Promise<number>`,
  `interface RunJobOptions<T> { partialErrors?: (result: T) => string[]; partialAlertKind?: AlertKind | null }`.
  Task 6 calls both.

**`ok` means clean**, which the schema comment in Task 1 already states: the run completed _and_
reported no per-item failures. A settle pass that could not grade one game is not a successful
settle pass, and the health page saying so is the point.

- [ ] **Step 1: Write the failing tests**

Create `src/server/ops/__tests__/job-runs.test.ts`. These need Postgres — they will not run in a
cloud session:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobRuns } from '@/db/schema';
import { pruneJobRuns, runJob } from '@/server/ops/job-runs';
import { resetDb } from '@/test/db';

vi.mock('@/server/ops/alerts', () => ({
  raiseAlert: vi.fn().mockResolvedValue(undefined),
  formatAlert: (a: { kind: string; message: string }) => `[${a.kind}] ${a.message}`,
}));

import { raiseAlert } from '@/server/ops/alerts';

const alerts = vi.mocked(raiseAlert);

async function runsFor(job: 'SETTLE' | 'ALLOWANCE' | 'RECONCILE') {
  return db.select().from(jobRuns).where(eq(jobRuns.job, job)).orderBy(desc(jobRuns.startedAt));
}

beforeEach(async () => {
  await resetDb();
  alerts.mockClear();
});

describe('runJob', () => {
  it('records a clean run and returns the job’s own value', async () => {
    const result = await runJob('ALLOWANCE', async () => ({ credited: 3, skipped: 0 }));

    expect(result).toEqual({ credited: 3, skipped: 0 });

    const [row] = await runsFor('ALLOWANCE');
    expect(row.ok).toBe(true);
    expect(row.finishedAt).not.toBeNull();
    expect(row.error).toBeNull();
    expect(row.summary).toEqual({ credited: 3, skipped: 0 });
    expect(row.alerted).toBe(false);
    expect(alerts).not.toHaveBeenCalled();
  });

  it('records bigint amounts as decimal strings rather than throwing', async () => {
    await runJob('SETTLE', async () => ({ centsPaid: 12_345n }));

    const [row] = await runsFor('SETTLE');
    expect(row.summary).toEqual({ centsPaid: '12345' });
  });

  it('records a throw, alerts, and re-throws unchanged', async () => {
    const boom = new TypeError('cannot read properties of undefined');

    await expect(
      runJob('SETTLE', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const [row] = await runsFor('SETTLE');
    expect(row.ok).toBe(false);
    expect(row.error).toBe('TypeError: cannot read properties of undefined');
    expect(row.alerted).toBe(true);
    expect(alerts).toHaveBeenCalledTimes(1);
    expect(alerts.mock.calls[0][0].kind).toBe('CRON_FAILED');
  });

  it('treats a run that reported per-item failures as not clean', async () => {
    await runJob(
      'SETTLE',
      async () => ({ errors: [{ gameId: 'g1', message: 'no final score' }] }),
      {
        partialErrors: (r) => r.errors.map((e) => `game ${e.gameId}: ${e.message}`),
      },
    );

    const [row] = await runsFor('SETTLE');
    expect(row.ok).toBe(false);
    expect(row.error).toContain('game g1: no final score');
    expect(alerts.mock.calls[0][0].kind).toBe('CRON_ERRORS');
  });

  it('stays quiet on a second consecutive failure', async () => {
    const fail = () =>
      runJob('SETTLE', async () => {
        throw new Error('down');
      });

    await expect(fail()).rejects.toThrow('down');
    await expect(fail()).rejects.toThrow('down');

    expect(alerts).toHaveBeenCalledTimes(1);
    const rows = await runsFor('SETTLE');
    expect(rows.map((r) => r.alerted)).toEqual([false, true]);
  });

  it('sends one recovery notice on the first success after a failure', async () => {
    await expect(
      runJob('SETTLE', async () => {
        throw new Error('down');
      }),
    ).rejects.toThrow('down');
    alerts.mockClear();

    await runJob('SETTLE', async () => ({ gamesSettled: 1 }));

    expect(alerts).toHaveBeenCalledTimes(1);
    expect(alerts.mock.calls[0][0].kind).toBe('CRON_RECOVERED');
  });

  it('does not alert on a partial failure when the caller says it raises its own', async () => {
    await runJob('RECONCILE', async () => ({ drift: 2 }), {
      partialErrors: (r) => (r.drift > 0 ? [`${r.drift} discrepancies`] : []),
      partialAlertKind: null,
    });

    const [row] = await runsFor('RECONCILE');
    expect(row.ok).toBe(false);
    expect(alerts).not.toHaveBeenCalled();
  });

  it('keeps the job’s result when recording fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Stands in for the table not existing yet — the state of a deploy that lands ahead of
    // the migration. The job must still do its job.
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('relation "job_runs" does not exist');
    });

    await expect(runJob('ALLOWANCE', async () => ({ credited: 1 }))).resolves.toEqual({
      credited: 1,
    });
  });
});

describe('pruneJobRuns', () => {
  it('deletes rows past the window and keeps the rest', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    await db.insert(jobRuns).values([
      { job: 'SETTLE', startedAt: old, finishedAt: old, ok: true },
      { job: 'SETTLE', ok: true },
    ]);

    expect(await pruneJobRuns(30)).toBe(1);
    expect(await runsFor('SETTLE')).toHaveLength(1);
  });
});
```

Add `import { afterEach } from 'vitest';` and an `afterEach(() => vi.restoreAllMocks());` so the
`db.insert` spy in the last test does not leak into the `pruneJobRuns` block. Do not simulate the
missing table by dropping or renaming it — the test database is shared across the whole suite and
`fileParallelism` is off, but a failed restore would poison every later file.

- [ ] **Step 2: Confirm the tests cannot run here, and say so**

Run: `npx vitest run src/server/ops/__tests__/job-runs.test.ts`

Expected: FAIL, with a Postgres connection error (`ECONNREFUSED 127.0.0.1:5433`) — **not** an
assertion failure. That error is the expected outcome in a cloud session and is not something to
fix. Record it in the commit message rather than claiming the tests pass.

- [ ] **Step 3: Write the implementation**

Create `src/server/ops/job-runs.ts`:

```ts
import { and, desc, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobRuns, type JobName } from '@/db/schema';
import { jsonSafe } from '@/server/cron/auth';
import { shouldAlert } from './alert-policy';
import { raiseAlert, type Alert, type AlertKind } from './alerts';

export interface RunJobOptions<T> {
  /**
   * Per-item failures the job reports without throwing — settle's 207 case. A run that
   * reports any is recorded as not clean.
   */
  partialErrors?: (result: T) => string[];
  /**
   * What kind of alert a partial failure raises. `null` means the job raises its own more
   * specific alert and this wrapper should stay quiet — reconcile does that.
   */
  partialAlertKind?: AlertKind | null;
}

/**
 * Time a scheduled job, record what it did, and decide whether to shout (D58, D60).
 *
 * It observes; it does not handle. A throw is recorded, alerted and re-thrown unchanged, so the
 * route still returns whatever it returned before. Recording failure is never job failure —
 * every write here is wrapped, because a settle run that moved money correctly must not be
 * reported as a 500 because a bookkeeping row would not insert. That is also what makes this
 * safe to deploy before the migration is applied.
 *
 * Always called around a job, never inside one: job_runs is not money and must never be able to
 * roll a money transaction back.
 */
export async function runJob<T>(
  job: JobName,
  fn: () => Promise<T>,
  options: RunJobOptions<T> = {},
): Promise<T> {
  const runId = await openRun(job);

  try {
    const result = await fn();
    const errors = options.partialErrors?.(result) ?? [];
    const clean = errors.length === 0;

    await closeRun(job, runId, {
      ok: clean,
      summary: jsonSafe(result),
      error: clean ? null : summarizeErrors(errors),
      alert: clean
        ? recoveryAlert(job)
        : options.partialAlertKind === null
          ? null
          : {
              kind: options.partialAlertKind ?? 'CRON_ERRORS',
              message: `${job} completed with ${errors.length} item failure(s).`,
              context: { failures: errors.length, first: errors.slice(0, 3).join(' | ') },
            },
    });

    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    await closeRun(job, runId, {
      ok: false,
      summary: null,
      error: `${error.name}: ${error.message}`,
      alert: {
        kind: 'CRON_FAILED',
        message: `${job} threw and did not complete.`,
        context: { error: `${error.name}: ${error.message}` },
      },
    });

    throw err;
  }
}

/** The recovery notice is only sent when the previous run failed; `decide` enforces that. */
function recoveryAlert(job: JobName): Alert {
  return { kind: 'CRON_RECOVERED', message: `${job} completed cleanly again.` };
}

function summarizeErrors(errors: string[]): string {
  const head = errors.slice(0, 3).join(' | ');
  return errors.length > 3
    ? `${errors.length} item failures: ${head} (+${errors.length - 3} more)`
    : `${errors.length} item failure(s): ${head}`;
}

async function openRun(job: JobName): Promise<string | null> {
  try {
    const [row] = await db.insert(jobRuns).values({ job }).returning({ id: jobRuns.id });
    return row.id;
  } catch (err) {
    console.error(`[job-runs] could not open a run row for ${job}`, err);
    return null;
  }
}

interface Outcome {
  ok: boolean;
  summary: unknown;
  error: string | null;
  alert: Alert | null;
}

async function closeRun(job: JobName, runId: string | null, outcome: Outcome): Promise<void> {
  const alert = await decideAlert(job, outcome);

  try {
    if (runId) {
      await db
        .update(jobRuns)
        .set({
          finishedAt: new Date(),
          ok: outcome.ok,
          summary: outcome.summary,
          error: outcome.error,
          alerted: alert !== null,
        })
        .where(eq(jobRuns.id, runId));
    }
  } catch (err) {
    console.error(`[job-runs] could not record the ${job} run`, err);
  }

  // Outside the try above on purpose: a failed bookkeeping write must not swallow the alarm.
  if (alert) await raiseAlert(alert);
}

async function decideAlert(job: JobName, outcome: Outcome): Promise<Alert | null> {
  if (!outcome.alert) return null;

  try {
    const [previous] = await db
      .select({ ok: jobRuns.ok })
      .from(jobRuns)
      .where(and(eq(jobRuns.job, job), isNotNull(jobRuns.finishedAt)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);

    const [alerted] = await db
      .select({ startedAt: jobRuns.startedAt })
      .from(jobRuns)
      .where(and(eq(jobRuns.job, job), eq(jobRuns.alerted, true)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);

    return shouldAlert({
      previousOk: previous?.ok ?? null,
      lastAlertedAt: alerted?.startedAt ?? null,
      ok: outcome.ok,
      now: new Date(),
    })
      ? outcome.alert
      : null;
  } catch (err) {
    // The history is unreadable — the table may not exist yet. Fail loud rather than silent:
    // a missed alert about money is worse than a duplicate one. Never send a recovery notice
    // on this path, since "recovered" is a claim about a history we just failed to read.
    console.error(`[job-runs] could not read alert history for ${job}`, err);
    return outcome.ok ? null : outcome.alert;
  }
}

/**
 * Retention. Rides the daily reconcile run rather than earning a schedule of its own, the same
 * way the overdue-event sweep rides settle (D37). At 144 settle runs a day, 30 days is roughly
 * 4,400 rows.
 */
export async function pruneJobRuns(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const deleted = await db
    .delete(jobRuns)
    .where(lt(jobRuns.startedAt, cutoff))
    .returning({ id: jobRuns.id });
  return deleted.length;
}
```

- [ ] **Step 4: Wire the settle route**

Rewrite `src/app/api/cron/settle/route.ts`. The whole body goes inside `runJob`, so the run record
covers everything the route does rather than only the settlement pass:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { settleFinalGames } from '@/server/bets/settle';
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { detectLeadChange } from '@/server/feed/leaders';
import { sweepOverdueEvents } from '@/server/events/overdue';
import { sweepP2PWagers } from '@/server/p2p/sweep';
import { runJob } from '@/server/ops/job-runs';

async function settlePass() {
  const summary = await settleFinalGames();

  let leadChanged = false;
  const [activeSeason] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, 'ACTIVE'));

  if (activeSeason) {
    leadChanged = (await detectLeadChange(activeSeason.id)).emitted;
  }

  const overdue = await sweepOverdueEvents();
  const wagers = await sweepP2PWagers();

  return {
    ...summary,
    leadChanged,
    overdueFlagged: overdue.flagged,
    wagersExpired: wagers.expired,
    wagersSettled: wagers.settled,
    wagersOverdue: wagers.overdueFlagged,
    wagerErrors: wagers.errors,
  };
}

/**
 * Every 10 minutes. Settles finished games in batches sized to fit the invocation limit;
 * whatever it does not reach is picked up by the next run.
 *
 * Lead-change detection, overdue-event sweeping and the peer-to-peer wager sweep all ride
 * along here rather than in their own cron entries: settlement is what moves standings, and
 * folding them in means no new schedules to keep in sync.
 *
 * `runJob` wraps the whole pass so the run record covers all of it (D58). It observes only —
 * the 207 below is unchanged, and it is still what `curl -sf` in cron.yml reacts to.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const payload = await runJob('SETTLE', settlePass, {
    partialErrors: (p) => [
      ...p.errors.map((e) => `game ${e.gameId}: ${e.message}`),
      ...p.wagerErrors.map((e) => `wager ${e.wagerId}: ${e.message}`),
    ],
  });

  // A game or wager that failed is reported, not swallowed — the run still succeeded for
  // everyone else, but a persistent failure needs to be visible in the cron logs.
  const status = payload.errors.length > 0 || payload.wagerErrors.length > 0 ? 207 : 200;
  return Response.json(jsonSafe(payload), { status });
}
```

- [ ] **Step 5: Wire the allowance route**

Rewrite `src/app/api/cron/allowance/route.ts`:

```ts
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { payWeeklyAllowance } from '@/server/seasons/allowance';
import { runJob } from '@/server/ops/job-runs';

/** Weekly. The idempotency key is the ISO week, so a double run is harmless. */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  return Response.json(jsonSafe(await runJob('ALLOWANCE', () => payWeeklyAllowance())));
}
```

- [ ] **Step 6: Verify what can be verified**

```bash
npm run typecheck && npm run lint
DATABASE_URL=postgres://x npm run build
```

Expected: all three exit 0.

Then re-run the pure suites from Tasks 3 and 4 to confirm nothing regressed:

```bash
npx vitest run src/server/ops/__tests__/alert-policy.test.ts src/server/ops/__tests__/alerts.test.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 7: Format and commit**

```bash
npm run format
git add src/server/ops/job-runs.ts src/server/ops/__tests__/job-runs.test.ts src/app/api/cron/settle/route.ts src/app/api/cron/allowance/route.ts
git commit -m "feat(ops): record settle and allowance runs, and alert on failure

runJob wraps each route's whole body, so the run record covers everything the
route does. It observes only: the 207 and the 500 are unchanged, and they are
still what curl -sf in cron.yml reacts to.

'ok' means clean — completed without throwing and with no per-item failures. A
settle pass that could not grade one game is not a successful settle pass.

Recording failure is never job failure. Every write here is wrapped, so a
job_runs insert against a table that does not exist yet logs and is swallowed
while the settle still settles. That is what makes this safe to deploy before
the migration is applied.

The tests in this commit need Postgres and were NOT run — there is no Docker
daemon in a cloud session. CI is their first execution."
```

---

### Task 6 [CLOUD]: The reconcile route — drift alerts and pruning

**Files:**

- Modify: `src/app/api/cron/reconcile/route.ts`

**Interfaces:**

- Consumes: `runJob`, `pruneJobRuns` (Task 5); `raiseAlert` (Task 4);
  `reconcileBalances`, `reconcileEscrow` from `@/server/money/reconcile`.
- Produces: a `RECONCILE` `job_runs` row whose `summary` carries `discrepancies` and
  `escrowDiscrepancies` arrays. Task 7's health read parses exactly those two keys.

There is no new test file here. The reconcilers have their own suites already
(`src/server/money/__tests__/reconcile*.test.ts`) and this task adds no logic to them — it adds
two alert calls and a prune, both of which are covered by Task 4's and Task 5's tests.

- [ ] **Step 1: Rewrite the route**

```ts
import { authorizeCronRequest, jsonSafe } from '@/server/cron/auth';
import { reconcileBalances, reconcileEscrow } from '@/server/money/reconcile';
import { raiseAlert } from '@/server/ops/alerts';
import { pruneJobRuns, runJob } from '@/server/ops/job-runs';

const abs = (n: bigint) => (n < 0n ? -n : n);

/**
 * Daily. Asserts every cached balance still equals the sum of its ledger entries, and that
 * every wager's pot holds exactly what its status says it should (D43).
 *
 * A discrepancy in either returns 500 on purpose: this is the alarm that says money drifted,
 * and it should be impossible to miss in the cron logs. Since 2026-09 it also shouts — the
 * status code was never going to be read by anyone at 08:00 on a Sunday.
 *
 * Drift alerts are not suppressed the way cron-failure alerts are (D60). This runs daily, and
 * one message a day about money that does not add up is the correct volume rather than noise.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const payload = await runJob(
    'RECONCILE',
    async () => {
      const discrepancies = await reconcileBalances();
      const escrowDiscrepancies = await reconcileEscrow();

      if (discrepancies.length > 0) {
        await raiseAlert({
          kind: 'BALANCE_DRIFT',
          message: `${discrepancies.length} cached balance(s) disagree with the ledger.`,
          context: {
            pairs: discrepancies.length,
            totalDriftCents: discrepancies
              .reduce((sum, d) => sum + abs(d.cachedCents - d.ledgerCents), 0n)
              .toString(),
          },
        });
      }

      if (escrowDiscrepancies.length > 0) {
        await raiseAlert({
          kind: 'ESCROW_DRIFT',
          message: `${escrowDiscrepancies.length} wager pot(s) hold the wrong amount.`,
          context: {
            wagers: escrowDiscrepancies.length,
            firstIds: escrowDiscrepancies
              .slice(0, 5)
              .map((d) => d.wagerId)
              .join(', '),
          },
        });
      }

      // Retention rides this job rather than earning a schedule of its own. Its own try/catch:
      // a failed prune is housekeeping and must not fail a reconciliation run.
      try {
        await pruneJobRuns();
      } catch (err) {
        console.error('[reconcile] pruning job_runs failed', err);
      }

      const ok = discrepancies.length === 0 && escrowDiscrepancies.length === 0;
      return { ok, discrepancies, escrowDiscrepancies };
    },
    {
      // Drift makes the run not clean, so the health page reports it — but the two alerts above
      // are more specific than CRON_ERRORS would be, so the wrapper stays quiet.
      partialErrors: (p) =>
        p.ok ? [] : [`${p.discrepancies.length} balance, ${p.escrowDiscrepancies.length} escrow`],
      partialAlertKind: null,
    },
  );

  return Response.json(jsonSafe(payload), { status: payload.ok ? 200 : 500 });
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck && npm run lint
DATABASE_URL=postgres://x npm run build
```

Expected: all exit 0.

- [ ] **Step 3: Format and commit**

```bash
npm run format
git add src/app/api/cron/reconcile/route.ts
git commit -m "feat(ops): make reconciliation drift shout

reconcileBalances and reconcileEscrow already computed the answer; a 500 into a
log nobody has open at 08:00 on a Sunday was the whole alarm. Now drift raises
BALANCE_DRIFT and ESCROW_DRIFT with counts and totals.

Drift alerts are not suppressed the way cron-failure alerts are — this runs
daily, and one message a day about money that does not add up is the right
volume (D60). The 500 is unchanged.

Retention for job_runs rides this job, in its own try/catch: a failed prune is
housekeeping and must never fail a reconciliation run."
```

---

### Task 7 [CLOUD]: The health reads

**Files:**

- Create: `src/server/ops/health.ts`
- Test: `src/server/ops/__tests__/health.test.ts` (**pure** — `cronStaleness` and `formatAge`)
- Test: `src/server/ops/__tests__/health-reads.test.ts` (**DB**)

**Interfaces:**

- Consumes: `jobRuns`, `JobName` (Task 1).
- Produces: `cronStaleness(job, lastSuccessAt, now): Freshness`, `formatAge(ms): string`,
  `readHealth(now?: Date): Promise<HealthSnapshot>`, `STALE_AFTER_MS`, and the types
  `Freshness`, `HealthJob`, `JobHealth`, `ReconcileHealth`, `HealthSnapshot` exactly as written in
  Step 3. Task 8's page imports `readHealth`, `formatAge`, and the types.

- [ ] **Step 1: Write the pure failing tests**

Create `src/server/ops/__tests__/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cronStaleness, formatAge, STALE_AFTER_MS } from '@/server/ops/health';

const now = new Date('2026-09-02T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('cronStaleness', () => {
  it('is never-run when nothing has succeeded', () => {
    expect(cronStaleness('SETTLE', null, now)).toBe('never-run');
  });

  it.each([
    ['SYNC_ODDS', 45 * 60_000],
    ['SETTLE', 30 * 60_000],
    ['RECONCILE', 26 * 60 * 60_000],
    ['ALLOWANCE', 8 * 24 * 60 * 60_000],
  ] as const)('%s goes stale after %i ms', (job, threshold) => {
    expect(STALE_AFTER_MS[job]).toBe(threshold);
    expect(cronStaleness(job, ago(threshold), now)).toBe('fresh');
    expect(cronStaleness(job, ago(threshold + 1), now)).toBe('stale');
  });

  it('treats a future timestamp as fresh rather than as an error', () => {
    expect(cronStaleness('SETTLE', new Date(now.getTime() + 60_000), now)).toBe('fresh');
  });
});

describe('formatAge', () => {
  it.each([
    [0, 'just now'],
    [45_000, 'just now'],
    [60_000, '1 min ago'],
    [17 * 60_000, '17 min ago'],
    [60 * 60_000, '1 hr ago'],
    [5 * 60 * 60_000 + 30 * 60_000, '5 hr ago'],
    [26 * 60 * 60_000, '1 day ago'],
    [9 * 24 * 60 * 60_000, '9 days ago'],
  ])('renders %i ms as "%s"', (ms, expected) => {
    expect(formatAge(ms)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/server/ops/__tests__/health.test.ts`

Expected: FAIL — `Failed to resolve import "@/server/ops/health"`.

- [ ] **Step 3: Write the module**

Create `src/server/ops/health.ts`:

```ts
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobRuns, type JobName } from '@/db/schema';

export type Freshness = 'fresh' | 'stale' | 'never-run';

/** The three recorded jobs, plus sync-odds, whose health is derived rather than recorded (D58). */
export type HealthJob = JobName | 'SYNC_ODDS';

/**
 * Roughly three times each job's own interval, so one missed fire is not an alarm and two are.
 */
export const STALE_AFTER_MS: Record<HealthJob, number> = {
  SYNC_ODDS: 45 * 60_000, // every 15 min
  SETTLE: 30 * 60_000, // every 10 min
  RECONCILE: 26 * 60 * 60_000, // daily at 08:00
  ALLOWANCE: 8 * 24 * 60 * 60_000, // weekly, Tuesday
};

/**
 * Pure on purpose. It is the one part of this screen a cloud session can prove, and pushing the
 * judgement out of the query and into a function is what makes that possible.
 */
export function cronStaleness(job: HealthJob, lastSuccessAt: Date | null, now: Date): Freshness {
  if (lastSuccessAt === null) return 'never-run';
  return now.getTime() - lastSuccessAt.getTime() > STALE_AFTER_MS[job] ? 'stale' : 'fresh';
}

/** Coarse by design: the question this screen answers is "recently?", never "exactly when?". */
export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export interface JobHealth {
  job: HealthJob;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  freshness: Freshness;
  /** True for sync-odds, whose reading comes from market freshness rather than a run record. */
  derived: boolean;
}

export interface ReconcileHealth {
  observedAt: Date | null;
  balanceDiscrepancies: number | null;
  escrowDiscrepancies: number | null;
}

export interface HealthSnapshot {
  jobs: JobHealth[];
  reconcile: ReconcileHealth;
  suspendedMarkets: number;
  escrowHeldCents: bigint;
  readAt: Date;
  /** True when job_runs could not be read at all — the migration has not been applied yet. */
  runRecordUnavailable: boolean;
}

const RECORDED_JOBS: JobName[] = ['SETTLE', 'ALLOWANCE', 'RECONCILE'];

interface RunRow {
  job: JobName;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

/**
 * One snapshot for /admin/health.
 *
 * Reconciliation drift is read from the last recorded run rather than recomputed: recomputing
 * means two cross-join queries over every membership and every wager on each page load, and the
 * page is refreshed by whoever is worried. Reading the record also lets the screen state its
 * observation time honestly instead of implying a number is live.
 */
export async function readHealth(now: Date = new Date()): Promise<HealthSnapshot> {
  const [runs, reconcile] = await Promise.all([readRunRows(), readLastReconcile()]);

  const jobs: JobHealth[] = RECORDED_JOBS.map((job) => {
    const row = runs?.find((r) => r.job === job);
    const lastSuccessAt = row?.last_success_at ? new Date(row.last_success_at) : null;
    return {
      job,
      lastRunAt: row?.last_run_at ? new Date(row.last_run_at) : null,
      lastSuccessAt,
      lastError: row?.last_error ?? null,
      freshness: cronStaleness(job, lastSuccessAt, now),
      derived: false,
    };
  });

  const syncedAt = await readLastMarketSync();
  jobs.unshift({
    job: 'SYNC_ODDS',
    lastRunAt: syncedAt,
    lastSuccessAt: syncedAt,
    lastError: null,
    freshness: cronStaleness('SYNC_ODDS', syncedAt, now),
    derived: true,
  });

  return {
    jobs,
    reconcile,
    suspendedMarkets: await countSuspendedMarkets(),
    escrowHeldCents: await readEscrowHeld(),
    readAt: now,
    runRecordUnavailable: runs === null,
  };
}

/** Returns null rather than throwing when job_runs does not exist — see the spec's §9. */
async function readRunRows(): Promise<RunRow[] | null> {
  try {
    const rows = await db.execute<RunRow>(sql`
      SELECT job,
             MAX(started_at) AS last_run_at,
             MAX(started_at) FILTER (WHERE ok) AS last_success_at,
             (ARRAY_AGG(error ORDER BY started_at DESC)
                FILTER (WHERE error IS NOT NULL))[1] AS last_error
      FROM job_runs
      WHERE finished_at IS NOT NULL
      GROUP BY job
    `);
    return Array.from(rows);
  } catch (err) {
    console.error('[health] job_runs is unreadable; reporting every job as never-run', err);
    return null;
  }
}

async function readLastReconcile(): Promise<ReconcileHealth> {
  const empty: ReconcileHealth = {
    observedAt: null,
    balanceDiscrepancies: null,
    escrowDiscrepancies: null,
  };

  try {
    const [row] = await db
      .select({ finishedAt: jobRuns.finishedAt, summary: jobRuns.summary })
      .from(jobRuns)
      .where(and(eq(jobRuns.job, 'RECONCILE'), isNotNull(jobRuns.finishedAt)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);

    if (!row?.summary) return empty;

    const summary = row.summary as {
      discrepancies?: unknown[];
      escrowDiscrepancies?: unknown[];
    };

    return {
      observedAt: row.finishedAt,
      balanceDiscrepancies: summary.discrepancies?.length ?? null,
      escrowDiscrepancies: summary.escrowDiscrepancies?.length ?? null,
    };
  } catch (err) {
    console.error('[health] could not read the last reconcile run', err);
    return empty;
  }
}

/**
 * sync-odds is not instrumented (D58). The freshest market timestamp is the better evidence
 * anyway: it says the sync wrote rows, not that a handler returned 200.
 */
async function readLastMarketSync(): Promise<Date | null> {
  const rows = await db.execute<{ last_synced_at: string | null }>(
    sql`SELECT MAX(last_synced_at) AS last_synced_at FROM markets`,
  );
  const value = Array.from(rows)[0]?.last_synced_at;
  return value ? new Date(value) : null;
}

async function countSuspendedMarkets(): Promise<number> {
  const rows = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM markets WHERE status = 'SUSPENDED'`,
  );
  return Array.from(rows)[0]?.count ?? 0;
}

/**
 * From the ledger, not from the wagers' stake columns. The stakes say what should be held; the
 * ledger says what is. reconcileEscrow already exists to compare the two (D43), so this shows
 * the real number and lets the reconciler own the comparison.
 */
async function readEscrowHeld(): Promise<bigint> {
  const rows = await db.execute<{ held: string }>(
    sql`SELECT COALESCE(-SUM(amount_cents), 0) AS held
        FROM ledger_entries
        WHERE p2p_wager_id IS NOT NULL`,
  );
  return BigInt(Array.from(rows)[0]?.held ?? '0');
}
```

- [ ] **Step 4: Run the pure tests and confirm they pass**

Run: `npx vitest run src/server/ops/__tests__/health.test.ts`

Expected: PASS, 11 tests.

- [ ] **Step 5: Write the DB tests**

Create `src/server/ops/__tests__/health-reads.test.ts`. These need Postgres and will not run here:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { jobRuns, markets } from '@/db/schema';
import { readHealth } from '@/server/ops/health';
import { resetDb } from '@/test/db';
import { makeGameWithMarkets } from '@/test/factories';

beforeEach(async () => {
  await resetDb();
});

describe('readHealth', () => {
  it('reports every job as never-run on an empty database', async () => {
    const snapshot = await readHealth(new Date('2026-09-02T12:00:00Z'));

    expect(snapshot.jobs.map((j) => j.job)).toEqual([
      'SYNC_ODDS',
      'SETTLE',
      'ALLOWANCE',
      'RECONCILE',
    ]);
    expect(snapshot.jobs.every((j) => j.freshness === 'never-run')).toBe(true);
    expect(snapshot.reconcile.observedAt).toBeNull();
    expect(snapshot.suspendedMarkets).toBe(0);
    expect(snapshot.escrowHeldCents).toBe(0n);
    expect(snapshot.runRecordUnavailable).toBe(false);
  });

  it('reads the last successful run separately from the last run', async () => {
    const now = new Date('2026-09-02T12:00:00Z');
    const at = (min: number) => new Date(now.getTime() - min * 60_000);

    await db.insert(jobRuns).values([
      { job: 'SETTLE', startedAt: at(20), finishedAt: at(20), ok: true },
      { job: 'SETTLE', startedAt: at(5), finishedAt: at(5), ok: false, error: 'Error: down' },
    ]);

    const settle = (await readHealth(now)).jobs.find((j) => j.job === 'SETTLE')!;

    expect(settle.lastRunAt).toEqual(at(5));
    expect(settle.lastSuccessAt).toEqual(at(20));
    expect(settle.lastError).toBe('Error: down');
    expect(settle.freshness).toBe('fresh');
  });

  it('reads reconcile drift out of the last run’s summary', async () => {
    const observedAt = new Date('2026-09-02T08:00:00Z');
    await db.insert(jobRuns).values({
      job: 'RECONCILE',
      startedAt: observedAt,
      finishedAt: observedAt,
      ok: false,
      summary: {
        ok: false,
        discrepancies: [{ membershipId: 'a' }, { membershipId: 'b' }],
        escrowDiscrepancies: [{ wagerId: 'w' }],
      },
    });

    const { reconcile } = await readHealth(new Date('2026-09-02T12:00:00Z'));

    expect(reconcile.observedAt).toEqual(observedAt);
    expect(reconcile.balanceDiscrepancies).toBe(2);
    expect(reconcile.escrowDiscrepancies).toBe(1);
  });

  it('derives sync-odds freshness from the newest market timestamp', async () => {
    const now = new Date('2026-09-02T12:00:00Z');
    await makeGameWithMarkets();
    await db.update(markets).set({ lastSyncedAt: new Date(now.getTime() - 10 * 60_000) });

    const sync = (await readHealth(now)).jobs.find((j) => j.job === 'SYNC_ODDS')!;

    expect(sync.derived).toBe(true);
    expect(sync.freshness).toBe('fresh');
  });

  it('counts suspended markets', async () => {
    await makeGameWithMarkets();
    await db.update(markets).set({ status: 'SUSPENDED' });

    expect((await readHealth()).suspendedMarkets).toBeGreaterThan(0);
  });
});
```

Before writing this file, open `src/test/factories.ts` and use whatever the real game/market
factory is called. `makeGameWithMarkets` is the name assumed here; if the factory has a different
name or signature, use the real one rather than adding a new factory.

- [ ] **Step 6: Confirm the DB tests cannot run here**

Run: `npx vitest run src/server/ops/__tests__/health-reads.test.ts`

Expected: FAIL with a Postgres connection error, not an assertion failure. Do not claim these pass.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/server/ops/health.ts src/server/ops/__tests__/health.test.ts src/server/ops/__tests__/health-reads.test.ts
git commit -m "feat(ops): add the health reads

Four numbers: last successful run per job, the last reconcile result, the
suspended-market count, and the credits actually locked in escrow.

Drift is read from the last recorded run rather than recomputed. Recomputing
is two cross-join queries per page load on a page refreshed by whoever is
worried, and reading the record lets the screen state its observation time
honestly instead of implying a number is live.

Escrow comes from the ledger, not from the wagers' stake columns: the stakes
say what should be held, the ledger says what is, and reconcileEscrow already
owns the comparison (D43).

cronStaleness and formatAge are pure and were run here. health-reads.test.ts
needs Postgres and was NOT run."
```

---

### Task 8 [CLOUD]: `/admin/health`

**Files:**

- Create: `src/app/admin/health/page.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**

- Consumes: `readHealth`, `formatAge`, `JobHealth`, `HealthSnapshot`, `Freshness` (Task 7);
  `requireAdmin` from `@/server/auth/session`; `Card`, `Badge`, `Callout`, `Money` from
  `@/components/ui/*`.

No new boundary files: `/admin/health` nests under `admin/`, which already has `error.tsx` and
`loading.tsx`, so `route-conventions.test.ts` is satisfied as-is. Do not add
`src/app/admin/health/loading.tsx` — a second boundary in the same section is one of the twelve
identical files that test's comment exists to prevent.

- [ ] **Step 1: Write the page**

Create `src/app/admin/health/page.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { requireAdmin } from '@/server/auth/session';
import { formatAge, readHealth, type Freshness, type JobHealth } from '@/server/ops/health';

export const metadata: Metadata = { title: 'Health' };

const JOB_LABELS: Record<JobHealth['job'], string> = {
  SYNC_ODDS: 'Odds sync',
  SETTLE: 'Settlement',
  ALLOWANCE: 'Weekly allowance',
  RECONCILE: 'Reconciliation',
};

const FRESHNESS: Record<Freshness, { tone: BadgeTone; label: string }> = {
  fresh: { tone: 'positive', label: 'Running' },
  stale: { tone: 'negative', label: 'Overdue' },
  'never-run': { tone: 'caution', label: 'Never run' },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </span>
  );
}

/**
 * One screen that answers "is it working." Read-only, deliberately: a re-run control is a money
 * operation one click from a status page opened by someone already anxious, and what it adds
 * over waiting for tomorrow's 08:00 run is small.
 */
export default async function HealthPage() {
  await requireAdmin();

  const health = await readHealth();
  const now = health.readAt;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Health</h1>
        <Link href="/admin" className="text-sm text-ink-muted underline">
          Back to admin
        </Link>
      </div>

      {health.runRecordUnavailable ? (
        <Callout tone="caution">
          The <code>job_runs</code> table could not be read, so no job below can report a run. Apply
          the outstanding migration.
        </Callout>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Scheduled jobs
        </h2>

        {health.jobs.map((job) => (
          <Card key={job.job} className="flex flex-col gap-2 p-3">
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{JOB_LABELS[job.job]}</span>
              <Badge tone={FRESHNESS[job.freshness].tone}>{FRESHNESS[job.freshness].label}</Badge>
            </span>

            <Row label="Last clean run">
              {job.lastSuccessAt ? formatAge(now.getTime() - job.lastSuccessAt.getTime()) : 'never'}
            </Row>

            {/* Compared by value: two Date objects for the same instant are never `!==`-equal. */}
            {!job.derived &&
            job.lastRunAt &&
            job.lastRunAt.getTime() !== job.lastSuccessAt?.getTime() ? (
              <Row label="Last attempt">{formatAge(now.getTime() - job.lastRunAt.getTime())}</Row>
            ) : null}

            {job.lastError ? (
              <p className="break-words text-xs text-negative">{job.lastError}</p>
            ) : null}

            {job.derived ? (
              <p className="text-xs text-ink-muted">
                Derived from the newest market timestamp rather than a run record — it says the sync
                wrote rows, not that it returned 200.
              </p>
            ) : null}
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Reconciliation
        </h2>

        <Card className="flex flex-col gap-2 p-3">
          {health.reconcile.observedAt ? (
            <>
              <Row label="Balances disagreeing with the ledger">
                {health.reconcile.balanceDiscrepancies ?? 0}
              </Row>
              <Row label="Wager pots holding the wrong amount">
                {health.reconcile.escrowDiscrepancies ?? 0}
              </Row>
              <p className="text-xs text-ink-muted">
                As of {formatAge(now.getTime() - health.reconcile.observedAt.getTime())}, from the
                last reconcile run. Not recomputed on this page.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Reconciliation has not run yet.</p>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Markets and escrow
        </h2>

        <Card className="flex flex-col gap-2 p-3">
          <Row label="Markets suspended for stale data">{health.suspendedMarkets}</Row>
          <Row label="Credits locked in wager pots">
            <Money cents={health.escrowHeldCents} currency="CREDITS" />
          </Row>
        </Card>
      </section>
    </div>
  );
}
```

Check `src/components/ui/badge.tsx` exports `BadgeTone` before importing it; if the export name
differs, use the real one.

- [ ] **Step 2: Link it from the admin index**

In `src/app/admin/page.tsx`, add above the existing "Overdue & disputed events" link:

```tsx
<Link href="/admin/health" className="text-sm text-ink-muted underline">
  Health — is it working
</Link>
```

- [ ] **Step 3: Verify, including the token lint**

```bash
npm run typecheck && npm run lint
npx vitest run src/app/__tests__/token-lint.test.ts src/app/__tests__/route-conventions.test.ts
DATABASE_URL=postgres://x npm run build
```

Expected: typecheck and lint exit 0; both structural test files PASS (they read the filesystem and
need no database); the build exits 0 with one more route than before.

If token-lint fails, you used a raw colour class. Replace it with the semantic token the existing
components use — read `src/components/ui/card.tsx` and `badge.tsx` for the vocabulary.

- [ ] **Step 4: Format and commit**

```bash
npm run format
git add src/app/admin/health/page.tsx src/app/admin/page.tsx
git commit -m "feat(admin): add the health screen

Last clean run per job, the last reconcile result and its observation time,
suspended-stale markets, and the credits actually locked in wager pots. One
screen that answers 'is it working'.

Read-only on purpose: a re-run control is a money operation one click from a
status page opened by someone already anxious, on a screen with no other
dangerous buttons.

No new boundary files — /admin/health nests under admin/, which already has
error.tsx and loading.tsx."
```

---

### Task 9 [CLOUD]: `/admin/seasons`

**Files:**

- Create: `src/app/admin/seasons/page.tsx`, `src/app/admin/seasons/parse.ts`,
  `src/app/admin/seasons/actions.ts`, `src/app/admin/seasons/season-form.tsx`,
  `src/app/admin/seasons/activate-form.tsx`
- Test: `src/app/admin/seasons/__tests__/parse.test.ts` (**pure**)
- Test: `src/server/seasons/__tests__/activate.test.ts` (**DB**)
- Create: `src/server/seasons/activate.ts`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**

- Consumes: `createSeason`, `CreateSeasonInput` from `@/server/seasons/service`; the `DEFAULT_*`
  constants from `@/server/seasons/defaults`; `requireAdmin`.
- Produces: `parseAmountToCents(raw: string, label: string): bigint` in
  `src/app/admin/seasons/parse.ts`, `activateSeason(seasonId: string): Promise<ActivateResult>` in
  `src/server/seasons/activate.ts`, where
  `type ActivateResult = { ok: true } | { ok: false; code: 'ALREADY_ACTIVE'; blockingSeasonName: string } | { ok: false; code: 'NOT_FOUND' }`.

The activation guard lives in `src/server/seasons/activate.ts` rather than in the action so it can
be tested without rendering anything, matching how `src/server/events/resolve.ts` sits behind
`src/app/admin/events/actions.ts`.

- [ ] **Step 1: Write the pure amount-parsing tests**

Create `src/app/admin/seasons/__tests__/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAmountToCents } from '@/app/admin/seasons/parse';

describe('parseAmountToCents', () => {
  it.each([
    ['10000', 1_000_000n],
    ['10000.00', 1_000_000n],
    ['500.5', 50_050n],
    ['500.55', 50_055n],
    ['0', 0n],
  ])('reads %s as %s cents', (input, expected) => {
    expect(parseAmountToCents(input, 'Starting bankroll')).toBe(expected);
  });

  it.each(['', ' ', 'abc', '-5', '1.234', '1,000'])('rejects %s', (input) => {
    expect(() => parseAmountToCents(input, 'Starting bankroll')).toThrow('Starting bankroll');
  });
});
```

Amounts are entered in whole units and converted at the boundary. `defaults.ts` is emphatic that
its constants are cents and must not be "fixed" to look like the numbers they render as; a form
that took cents directly is a form that eventually creates a season with a $100.00 bankroll
because someone typed the number they saw.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/admin/seasons/__tests__/parse.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the amount parser**

It lives in its own module rather than in `actions.ts`, for one hard reason: every export from a
`'use server'` module must be `async`, and an `async` `parseAmountToCents` would return
`Promise<bigint>`, which makes the synchronous `expect(() => ...).toThrow()` assertions in Step 1
impossible to write.

Create `src/app/admin/seasons/parse.ts`:

```ts
/**
 * Amounts are entered in whole units and converted here. defaults.ts is emphatic that its
 * constants are cents and are not to be "fixed" to look like the numbers they render as; a form
 * taking cents directly is a form that creates a season with a $100.00 bankroll one day.
 *
 * Never routes through Number: the string is split and each half becomes a bigint directly.
 */
export function parseAmountToCents(raw: string, label: string): bigint {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label} must be a whole number of dollars, like 10000 or 10000.50`);
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
```

- [ ] **Step 4: Run the parse test and confirm it passes**

Run: `npx vitest run src/app/admin/seasons/__tests__/parse.test.ts`

Expected: PASS, 11 cases.

- [ ] **Step 5: Write the activation guard**

Create `src/server/seasons/activate.ts`:

```ts
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';

export type ActivateResult =
  | { ok: true }
  | { ok: false; code: 'ALREADY_ACTIVE'; blockingSeasonName: string }
  | { ok: false; code: 'NOT_FOUND' };

/**
 * Activation is the half that changes what every member sees, which is why it is a separate,
 * guarded act rather than part of creation (D61).
 *
 * `seasons_one_active_idx` is a partial unique index on status = 'ACTIVE', so a careless second
 * activation would otherwise surface as a raw constraint error through admin/error.tsx. Checking
 * explicitly lets the screen name the season in the way instead.
 */
export async function activateSeason(seasonId: string): Promise<ActivateResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(seasons).where(eq(seasons.id, seasonId));
    if (!target) return { ok: false, code: 'NOT_FOUND' };
    if (target.status === 'ACTIVE') return { ok: true };

    const [blocking] = await tx
      .select({ name: seasons.name })
      .from(seasons)
      .where(and(eq(seasons.status, 'ACTIVE'), ne(seasons.id, seasonId)));

    if (blocking) {
      return { ok: false, code: 'ALREADY_ACTIVE', blockingSeasonName: blocking.name };
    }

    await tx.update(seasons).set({ status: 'ACTIVE' }).where(eq(seasons.id, seasonId));
    return { ok: true };
  });
}
```

- [ ] **Step 6: Write the DB test for it**

Create `src/server/seasons/__tests__/activate.test.ts`. Needs Postgres:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { activateSeason } from '@/server/seasons/activate';
import { resetDb } from '@/test/db';
import { makeSeason } from '@/test/factories';

beforeEach(async () => {
  await resetDb();
});

describe('activateSeason', () => {
  it('activates an upcoming season when nothing else is active', async () => {
    const season = await makeSeason();

    expect(await activateSeason(season.id)).toEqual({ ok: true });

    const [after] = await db.select().from(seasons).where(eq(seasons.id, season.id));
    expect(after.status).toBe('ACTIVE');
  });

  it('refuses while another season is active, and names it', async () => {
    await makeSeason({ name: 'Last year', status: 'ACTIVE' });
    const next = await makeSeason({ name: 'This year' });

    expect(await activateSeason(next.id)).toEqual({
      ok: false,
      code: 'ALREADY_ACTIVE',
      blockingSeasonName: 'Last year',
    });

    const [after] = await db.select().from(seasons).where(eq(seasons.id, next.id));
    expect(after.status).toBe('UPCOMING');
  });

  it('is a no-op on a season that is already active', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    expect(await activateSeason(season.id)).toEqual({ ok: true });
  });

  it('reports a season that does not exist', async () => {
    expect(await activateSeason('00000000-0000-0000-0000-000000000000')).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});
```

- [ ] **Step 7: Write the actions**

Create `src/app/admin/seasons/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/auth/session';
import { activateSeason, type ActivateResult } from '@/server/seasons/activate';
import { createSeason } from '@/server/seasons/service';
import { parseAmountToCents } from './parse';

export interface CreateSeasonFields {
  name: string;
  startsAt: string;
  endsAt: string;
  startingBankroll: string;
  weeklyAllowance: string;
  startingCredits: string;
  weeklyCreditAllowance: string;
  allowanceWeekday: string;
}

export async function createSeasonAction(
  fields: CreateSeasonFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();

  const name = fields.name.trim();
  if (!name) return { ok: false, error: 'A season needs a name.' };

  const startsAt = new Date(fields.startsAt);
  const endsAt = new Date(fields.endsAt);
  if (Number.isNaN(startsAt.getTime()))
    return { ok: false, error: 'The start date is not a date.' };
  if (Number.isNaN(endsAt.getTime())) return { ok: false, error: 'The end date is not a date.' };
  if (endsAt <= startsAt) return { ok: false, error: 'The season has to end after it starts.' };

  const weekday = Number(fields.allowanceWeekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: 'The allowance weekday has to be 0 (Sunday) through 6.' };
  }

  try {
    await createSeason({
      name,
      startsAt,
      endsAt,
      startingBankrollCents: parseAmountToCents(fields.startingBankroll, 'Starting bankroll'),
      weeklyAllowanceCents: parseAmountToCents(fields.weeklyAllowance, 'Weekly allowance'),
      startingCreditsCents: parseAmountToCents(fields.startingCredits, 'Starting credits'),
      weeklyCreditAllowanceCents: parseAmountToCents(
        fields.weeklyCreditAllowance,
        'Weekly credit allowance',
      ),
      allowanceWeekday: weekday,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not create the season.',
    };
  }

  revalidatePath('/admin/seasons');
  return { ok: true };
}

/** The real gate is requireAdmin here, never the page hiding the control. */
export async function activateSeasonAction(seasonId: string): Promise<ActivateResult> {
  await requireAdmin();
  const result = await activateSeason(seasonId);
  if (result.ok) revalidatePath('/admin/seasons');
  return result;
}
```

- [ ] **Step 8: Write the two client forms**

Create `src/app/admin/seasons/season-form.tsx`, matching the `useState` + `useTransition` shape
`src/app/admin/events/void-form.tsx` uses — this repo does not use `useActionState` anywhere:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormField } from '@/components/ui/form-field';
import { createSeasonAction, type CreateSeasonFields } from './actions';

const INPUT =
  'h-11 w-full rounded-control border border-line-strong bg-surface-sunken px-3 text-sm';

export function SeasonForm({ defaults }: { defaults: CreateSeasonFields }) {
  const [fields, setFields] = useState<CreateSeasonFields>(defaults);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof CreateSeasonFields) => (value: string) =>
    setFields((f) => ({ ...f, [key]: value }));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createSeasonAction(fields);
      if (result.ok) setFields(defaults);
      else setError(result.error);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <FormField label="Name" htmlFor="season-name">
        <input
          id="season-name"
          value={fields.name}
          onChange={(e) => set('name')(e.target.value)}
          required
          className={INPUT}
        />
      </FormField>

      <FormField label="Starts" htmlFor="season-starts">
        <input
          id="season-starts"
          type="date"
          value={fields.startsAt}
          onChange={(e) => set('startsAt')(e.target.value)}
          required
          className={INPUT}
        />
      </FormField>

      <FormField label="Ends" htmlFor="season-ends">
        <input
          id="season-ends"
          type="date"
          value={fields.endsAt}
          onChange={(e) => set('endsAt')(e.target.value)}
          required
          className={INPUT}
        />
      </FormField>

      <FormField
        label="Starting bankroll"
        htmlFor="season-bankroll"
        hint="In dollars, not cents. 10000 is a $10,000 bankroll."
      >
        <input
          id="season-bankroll"
          inputMode="decimal"
          value={fields.startingBankroll}
          onChange={(e) => set('startingBankroll')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      <FormField label="Weekly allowance" htmlFor="season-allowance" hint="In dollars.">
        <input
          id="season-allowance"
          inputMode="decimal"
          value={fields.weeklyAllowance}
          onChange={(e) => set('weeklyAllowance')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      <FormField label="Starting credits" htmlFor="season-credits" hint="In whole credits.">
        <input
          id="season-credits"
          inputMode="decimal"
          value={fields.startingCredits}
          onChange={(e) => set('startingCredits')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      <FormField
        label="Weekly credit allowance"
        htmlFor="season-credit-allowance"
        hint="In whole credits."
      >
        <input
          id="season-credit-allowance"
          inputMode="decimal"
          value={fields.weeklyCreditAllowance}
          onChange={(e) => set('weeklyCreditAllowance')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      <FormField
        label="Allowance weekday"
        htmlFor="season-weekday"
        hint="0 is Sunday. 2 is Tuesday, which matches the NFL week rollover."
      >
        <input
          id="season-weekday"
          inputMode="numeric"
          value={fields.allowanceWeekday}
          onChange={(e) => set('allowanceWeekday')(e.target.value)}
          className={INPUT}
        />
      </FormField>

      {error ? <Callout tone="negative">{error}</Callout> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Creating…' : 'Create season'}
      </Button>
    </form>
  );
}
```

Create `src/app/admin/seasons/activate-form.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { activateSeasonAction } from './actions';

/**
 * The second, deliberate act (D61). The refusal names the season in the way rather than saying
 * "conflict", because the next question is always "which one".
 */
export function ActivateForm({ seasonId }: { seasonId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function activate() {
    setError(null);
    startTransition(async () => {
      const result = await activateSeasonAction(seasonId);
      if (result.ok) return;
      setError(
        result.code === 'ALREADY_ACTIVE'
          ? `“${result.blockingSeasonName}” is still active. End it before starting this one.`
          : 'That season could not be found.',
      );
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" onClick={activate} disabled={pending}>
        {pending ? 'Activating…' : 'Activate'}
      </Button>
      {error ? <span className="text-xs text-negative">{error}</span> : null}
    </span>
  );
}
```

- [ ] **Step 9: Write the page**

Create `src/app/admin/seasons/page.tsx`:

```tsx
import { desc } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { requireAdmin } from '@/server/auth/session';
import {
  DEFAULT_ALLOWANCE_WEEKDAY,
  DEFAULT_STARTING_BANKROLL_CENTS,
  DEFAULT_STARTING_CREDITS_CENTS,
  DEFAULT_WEEKLY_ALLOWANCE_CENTS,
  DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS,
} from '@/server/seasons/defaults';
import { ActivateForm } from './activate-form';
import { SeasonForm } from './season-form';

export const metadata: Metadata = { title: 'Seasons' };

const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: 'positive',
  UPCOMING: 'caution',
  COMPLETED: 'neutral',
};

/** Cents to the whole-unit string the form edits. The form converts back on submit. */
function toUnits(cents: bigint): string {
  return (Number(cents) / 100).toFixed(2);
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Starting a season used to require shell access to the production database, which is not a
 * thing you want to discover in September. createSeason is unchanged — this screen and
 * bootstrap-season.ts are the same operation, not two implementations that can diverge.
 */
export default async function SeasonsPage() {
  await requireAdmin();

  const rows = await db.select().from(seasons).orderBy(desc(seasons.createdAt));

  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Seasons</h1>
        <Link href="/admin" className="text-sm text-ink-muted underline">
          Back to admin
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Every season
        </h2>

        {rows.length === 0 ? (
          <EmptyState title="No seasons yet" />
        ) : (
          rows.map((season) => (
            <Card key={season.id} className="flex items-center justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{season.name}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {toDateInput(season.startsAt)} → {toDateInput(season.endsAt)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONES[season.status] ?? 'neutral'}>{season.status}</Badge>
                {season.status === 'UPCOMING' ? <ActivateForm seasonId={season.id} /> : null}
              </span>
            </Card>
          ))
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Create a season
        </h2>
        <p className="text-xs text-ink-muted">
          A new season is created upcoming — nobody can join it and nothing changes until you
          activate it.
        </p>

        <Card className="p-3">
          <SeasonForm
            defaults={{
              name: '',
              startsAt: toDateInput(new Date()),
              endsAt: toDateInput(nextYear),
              startingBankroll: toUnits(DEFAULT_STARTING_BANKROLL_CENTS),
              weeklyAllowance: toUnits(DEFAULT_WEEKLY_ALLOWANCE_CENTS),
              startingCredits: toUnits(DEFAULT_STARTING_CREDITS_CENTS),
              weeklyCreditAllowance: toUnits(DEFAULT_WEEKLY_CREDIT_ALLOWANCE_CENTS),
              allowanceWeekday: String(DEFAULT_ALLOWANCE_WEEKDAY),
            }}
          />
        </Card>
      </section>
    </div>
  );
}
```

`toUnits` routes a `bigint` through `Number`, which every other part of this codebase forbids. It
is safe here and only here: these are five fixed configuration constants under 2^53, rendered into
a form's initial value, and the value the user submits is parsed back to `bigint` by
`parseAmountToCents` without passing through a float. Leave the comment in the code saying so, or
the next reviewer will correctly flag it.

- [ ] **Step 10: Link it from the admin index**

In `src/app/admin/page.tsx`, add beside the health link:

```tsx
<Link href="/admin/seasons" className="text-sm text-ink-muted underline">
  Seasons
</Link>
```

- [ ] **Step 11: Verify**

```bash
npx vitest run src/app/admin/seasons/__tests__/parse.test.ts
npm run typecheck && npm run lint
npx vitest run src/app/__tests__/token-lint.test.ts src/app/__tests__/route-conventions.test.ts
DATABASE_URL=postgres://x npm run build
```

Expected: the parse test PASSES (11 cases); typecheck, lint and build exit 0; both structural
tests PASS. `activate.test.ts` needs Postgres — confirm it errors on connection rather than on an
assertion, and do not claim it passes.

- [ ] **Step 12: Format and commit**

```bash
npm run format
git add src/app/admin/seasons src/server/seasons/activate.ts src/server/seasons/__tests__/activate.test.ts src/app/admin/page.tsx
git commit -m "feat(admin): add the season creation and activation screen

createSeason existed but was reachable only from seed.ts and
bootstrap-season.ts, so starting next season needed shell access to the
production database.

Creating writes UPCOMING — harmless, joinable by nobody. Activating is a second
control that refuses while another season is ACTIVE and names the one in the
way, because seasons_one_active_idx would otherwise surface as a raw constraint
error through admin/error.tsx (D61). Ending a season is deliberately not here.

Amounts are entered in dollars and converted at the boundary. A form that took
cents directly is a form that creates a \$100.00 bankroll one day.

activate.test.ts needs Postgres and was NOT run."
```

---

### Task 10 [CLOUD]: Documentation

**Files:**

- Modify: `.env.example`, `README.md`, `docs/README.md`, `docs/roadmap.md`

The spec, this plan, and D58–D62 already exist and are already listed in
[`docs/README.md`](../../README.md) — they landed with the two design-session commits, before any code
did. This task records what shipped.

- [ ] **Step 1: Document the four new variables**

Append to `.env.example`:

```
# Optional. Where cron failures and reconciliation drift are announced. A Discord or Slack
# incoming-webhook URL — the payload carries both `content` and `text`, so either works (D59).
# Unset, alerts are logged and not sent, which is the expected state in CI and locally.
ALERT_WEBHOOK_URL=

# Optional. Sentry. Unset, Sentry.init is never called and nothing reports (D62).
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
# Optional. Only for source-map upload at build time. Without it the build warns and succeeds.
SENTRY_AUTH_TOKEN=
```

Add the matching bullets to the `.env.local` list in `README.md`, after the `CRON_SECRET` bullet,
each stating what happens when it is absent.

- [ ] **Step 2: Update the roadmap's phase-6 table**

In `docs/roadmap.md`, in the `## 6 — Production deployment` table:

- Error monitoring → `✅ Complete` for the `[CLOUD]` half, evidence
  `@sentry/nextjs` wired via `src/instrumentation.ts`; `[NOAH]` signup still outstanding.
- Alerting on cron failure and reconciliation drift → `✅ Complete` for the `[CLOUD]` half,
  evidence `src/server/ops/alerts.ts`; `[NOAH]` destination still outstanding.
- Admin health page → `✅ Complete`, evidence `src/app/admin/health/page.tsx`.
- Admin season-creation screen → `✅ Complete`, evidence `src/app/admin/seasons/page.tsx`.

Leave every `[NOAH]` row exactly as it is. Then add one new row:

```
| Instrument `sync-odds` with `runJob`                                  | 🔲 Backlog | [CLOUD], after the ESPN adapter        | Deferred by [D58](../../decisions.md#d58--cron-health-is-a-job_runs-table-and-sync-odds-is-derived-from-market-freshness) — a one-line addition, not a correction |
```

And add a line under the table recording the deploy-order fact, so it is not rediscovered:

> **Applying the `job_runs` migration is the only thing this work needs before it is useful.**
> Every other `[NOAH]` item here is inert when absent — no webhook URL, no DSN, no auth token, all
> no-ops. A `job_runs` write that fails is logged and swallowed, so a deploy that lands ahead of
> the migration degrades `/admin/health` to "never run" rather than stopping settlement. See the
> spec's §9.

The plan and spec stay where they are for now — Task 11 still edits documents alongside them, and
archiving is its last step.

- [ ] **Step 3: Verify the documentation**

```bash
npm run format
grep -c '^### D' docs/decisions.md          # expect 62
grep -rn "production-deployment" docs/README.md docs/roadmap.md
```

Confirm every path in those links resolves after the `git mv`.

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md docs/
git commit -m "docs: record what phase 6's cloud half shipped

The four [CLOUD] rows close. Every [NOAH] row is untouched, and the table now
says plainly that applying the job_runs migration is the only thing this work
needs before it is useful — everything else Noah owns is inert when absent.

Adds the sync-odds instrumentation row so D58's deferral is tracked rather than
dropped, and moves the plan to archive/plans/ per the convention."
```

---

### Task 11 [CLOUD]: The post-merge handoff

**Files:**

- Modify: `docs/roadmap.md`, `docs/repo-health.md`, `docs/README.md`

Task 10 recorded what shipped. This task records **what is still owed once the pull request
merges**, in the three documents that are the project's canonical by-lane lists. It is separate
because it is a different claim: Task 10 says "this is built," and this says "this is built and
still does nothing until somebody does these seven things."

This has to live in the repo's own documents rather than only in this plan, because this plan moves
to `archive/plans/` the moment the work ships, and a handoff nobody will re-open is not a handoff.

- [ ] **Step 1: Add the handoff section to the roadmap**

In `docs/roadmap.md`, immediately after the `## 6 — Production deployment` task table and before
the "Deliberately skipped" paragraph, add:

````markdown
### After this merges — what is still owed

The `[CLOUD]` half is code on `main`. **None of it does anything until the rows below happen.**
They can be done in any order, at any time, against the running app — none needs a redeploy of
code, and only row 1 gates anything at all.

| #   | Do this                                                                                                                                          | Lane         | Until it is done                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Apply the `job_runs` migration** to the production database                                                                                    | **[NOAH]**   | `/admin/health` shows every job as never-run and says so in a banner, and no alert can fire. Nothing else changes: a failed `job_runs` write is logged and swallowed, so settlement, allowance and reconciliation are unaffected |
| 2   | Create a Discord or Slack incoming webhook and set **`ALERT_WEBHOOK_URL`** in Vercel                                                             | **[NOAH]**   | Every alert is written to the Vercel function log and sent nowhere. The webhook is what makes the alarm audible                                                                                                                  |
| 3   | Sign up for Sentry's free tier and set **`SENTRY_DSN`** and **`NEXT_PUBLIC_SENTRY_DSN`**                                                         | **[NOAH]**   | `Sentry.init` is never called and nothing reports ([D62](../../decisions.md#d62--sentry-is-inert-without-a-dsn))                                                                                                                 |
| 4   | Optionally set **`SENTRY_AUTH_TOKEN`**, `SENTRY_ORG`, `SENTRY_PROJECT`                                                                           | **[NOAH]**   | Sentry works, but its stack traces point at minified bundle lines because no source maps were uploaded at build time                                                                                                             |
| 5   | **Break a cron on purpose and confirm the alert arrives** — e.g. dispatch `settle` with a wrong `CRON_SECRET`, or watch the first real reconcile | **[MANUAL]** | The alarm is untested, which for practical purposes is the same as not having one. Belongs in the [phase 9](#9--hardening) smoke checklist                                                                                       |
| 6   | Run the full suite once on a desktop with Docker                                                                                                 | **[LOCAL]**  | CI is the only thing that has ever executed `job-runs.test.ts`, `health-reads.test.ts` and `activate.test.ts` — they were written in a cloud session with no Postgres                                                            |
| 7   | Create and activate the real season from `/admin/seasons`                                                                                        | **[MANUAL]** | `src/db/bootstrap-season.ts` remains the only way to start a season, which is the problem this screen was built to remove                                                                                                        |

**How to do row 1.** Migrations are applied by hand until the migrations-on-deploy row above
lands. From a machine with the production connection string:

```bash
ENV_FILE=.env.production npm run db:migrate
```
````

`src/db/migrate.ts` applies one file per transaction and is idempotent — re-running it after the
fact is safe and applies nothing twice.

**Rows 2 through 4 are environment variables only.** Vercel re-reads them on the next invocation;
there is nothing to rebuild and nothing in the repository to change.

````

- [ ] **Step 2: Add the rows to repo-health's Outstanding table**

`docs/repo-health.md`'s Outstanding table is the by-lane list people actually check, and its
opening sentence promises that nothing in it is unblocked `[CLOUD]` work. These three rows keep
that promise — all three are `[NOAH]` or `[LOCAL]`. Append after row 10:

```markdown
| 11  | **Apply the `job_runs` migration to production**                                | **[NOAH]**  | Nothing. Until it lands, `/admin/health` reports every job as never-run and no alert can fire — see [roadmap 6](../../roadmap.md#still-owed-now-that-the-cloud-half-has-merged)                                |
| 12  | Set `ALERT_WEBHOOK_URL`, and the two Sentry DSNs                                | **[NOAH]**  | Nothing. Vercel environment variables only; the code is inert without them by design ([D59](../../decisions.md#d59--one-generic-webhook-carrying-both-content-and-text), [D62](../../decisions.md#d62--sentry-is-inert-without-a-dsn)) |
| 13  | Run the phase-6 DB-backed tests on a desktop                                    | **[LOCAL]** | A desktop with Docker. `job-runs.test.ts`, `health-reads.test.ts` and `activate.test.ts` were written in a cloud session and have only ever run in CI                                            |
````

Also update that section's `_Last verified_` date to today.

- [ ] **Step 3: Update the by-lane tables in docs/README.md**

In the **What is left** section of `docs/README.md`:

- Under **What needs Noah**, add:
  `| Apply the `job_runs`migration; set`ALERT_WEBHOOK_URL` and the Sentry DSNs — **phase 6's alerting does nothing until this lands** | roadmap 6 |`
- Under **What needs a desktop with Docker**, add:
  `| Run phase 6's DB-backed tests — they have only ever run in CI | roadmap 6 |`
- Under **What needs a person, either of you**, add:
  `| Break a cron on purpose once and confirm the alert arrives | roadmap 6 |`
- In **What a cloud session can pick up now**, remove the phase-6 row Task 10's predecessor added —
  it is no longer work anyone can pick up, it is shipped.

Then add a short paragraph to the **Where things stand** section recording what phase 6's cloud
half added, in the same voice as the four subsystem summaries above it: the `job_runs` record, the
two-transport alerting with its transition rule, the Sentry wiring, and the two admin screens —
each with its decision reference.

- [ ] **Step 4: Verify every link and every claim**

```bash
npm run format
npm run format:check
```

Then check by hand:

- Every `decisions.md#dNN--...` anchor added in this task resolves. GitHub lowercases the heading,
  deletes punctuation, and turns each space into a hyphen — so the em dash with spaces around it
  becomes a double hyphen.
- The roadmap's new `#still-owed-now-that-the-cloud-half-has-merged` anchor matches its heading.
- No row in repo-health's Outstanding table is unblocked `[CLOUD]` work, which is what that
  table's opening sentence promises.

- [ ] **Step 5: Move the plan to the archive**

Last, because everything above edits documents that reference it. Per this repo's convention that
a plan whose work has shipped moves to `archive/plans/` and stays listed:

```bash
git mv docs/plans/2026-09-02-production-deployment-implementation-plan.md docs/archive/plans/
```

Then in `docs/README.md`: move its row from **Active** to the **Archive** table, described as
"Phase 6 cloud half — shipped", with the path updated. Move the spec's row from **Active** to
**Reference**, since it becomes the authority on what the subsystem does rather than a live plan.
Re-check the roadmap's two links to both documents and update the plan's path there too.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: record what is still owed after phase 6's cloud half merges

Seven rows, in the three documents that are this project's by-lane lists
rather than only in the plan — the plan moves to archive/plans/ when the work
ships, and a handoff nobody will re-open is not a handoff.

The distinction worth keeping: this code is merged and inert. Only applying the
job_runs migration gates anything, and even that degrades /admin/health rather
than stopping settlement. Everything else Noah owns is a Vercel environment
variable read on the next invocation, with nothing to rebuild."
```

---

## Lanes this plan does not close

Nothing below is executable by a cloud session. They are listed so they are not mistaken for
oversights, and so whoever picks them up has the context.

This table is for whoever executes the plan. **Task 11 is what writes the same handoff into the
repository's own documents**, where it survives this plan being archived — do not treat the two as
duplicates and skip one.

| Item                                                     | Lane                   | What it needs                                                                                                                                       |
| -------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apply the `job_runs` migration to production             | **[NOAH]**             | `npm run db:migrate` against the production `DATABASE_URL`, or the migrations-on-deploy row                                                         |
| Create the alert destination and set `ALERT_WEBHOOK_URL` | **[NOAH]**             | A Discord or Slack incoming webhook, then the Vercel env var. No redeploy of code needed                                                            |
| Sentry signup, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`    | **[NOAH]**             | The free tier. Optionally `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` for source maps                                                       |
| Confirm an alert actually arrives                        | **[MANUAL]**           | Fire a failure on purpose once the webhook is set — the phase-9 smoke pass                                                                          |
| Run this plan's DB tests                                 | **CI**, or **[LOCAL]** | CI runs them on the first push. On a desktop: `npm run db:up && npm run verify`                                                                     |
| Instrument `sync-odds` with `runJob`                     | **[CLOUD]**, later     | Noah's ESPN adapter must land first ([D58](../../decisions.md#d58--cron-health-is-a-job_runs-table-and-sync-odds-is-derived-from-market-freshness)) |
| Hosted Postgres, Vercel env wiring, `CRON_SECRET`        | **[NOAH]**             | Out of this plan's scope by the brief                                                                                                               |
| Uncomment the `schedule:` lines in `cron.yml`            | **[CLOUD]**, blocked   | [repo-health outstanding 3](../../repo-health.md#outstanding) — needs the Actions secrets first                                                     |
| Add `format:check` to `verify` and CI                    | **[CLOUD]**, blocked   | [repo-health outstanding 6](../../repo-health.md#outstanding) — needs the adapter reconciled first                                                  |

---

## Final verification, before opening a pull request

Run all of it, and report the results honestly — including the one that cannot run:

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
DATABASE_URL=postgres://x npm run build
npx vitest run src/server/ops/__tests__/alert-policy.test.ts \
               src/server/ops/__tests__/alerts.test.ts \
               src/server/ops/__tests__/health.test.ts \
               src/app/admin/seasons/__tests__/parse.test.ts \
               src/app/__tests__/token-lint.test.ts \
               src/app/__tests__/route-conventions.test.ts
```

Expected: everything above exits 0.

`format:check` is run here as a one-off check on your own work. Do **not** add it to `verify` or
to CI — that is repo-health outstanding 6, and it is blocked.

Then state, in the pull request body and in your summary:

> `npm test` was not run. There is no Postgres and no Docker daemon in a cloud session, so the
> DB-backed tests in this branch — `job-runs.test.ts`, `health-reads.test.ts`,
> `activate.test.ts` — are written but unexecuted. CI is their first run.

If CI comes back red on any of those three files, that is the expected place for this work to find
its bugs. Fix them there; do not weaken the assertions to get green.
