# Repo health and development tooling

What is worth adding to the repo, the CI gate, and the Claude Code setup — and what is
deliberately not, at this project's actual size.

**The yardstick.** Two developers, four users, one private group. Nearly every
"repo health" practice is designed for teams where people do not talk to each other daily.
Most of them cost more here than they return. Each recommendation below has to justify
itself against "we could just tell each other," and the ones that fail are listed in
[what is deliberately skipped](#what-is-deliberately-skipped) with the reason, so they do
not get re-proposed later.

## Status at a glance

_Last verified 2026-09-02._

Every item below carries a **lane** — who or what can actually finish it. The lane is decided by
what the work needs, not by who can type the file. Four lanes now, not three: `[MANUAL]` splits
into `[MANUAL]` and `[NOAH]` below, since not every human task needs Noah's specific credentials.

| Lane         | Means                                      | Why                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[MANUAL]** | Either of you, by hand                     | Clicking, reading, judging. No special account needed.                                                                                                                                                                                                                                                              |
| **[NOAH]**   | Noah specifically                          | An account or permission only he holds: GitHub repo settings, the Vercel dashboard, DNS, paid signups. No agent has these credentials, and none should.                                                                                                                                                             |
| **[CLOUD]**  | A Claude Code web session, start to finish | Measured 2026-08-25: `npm ci` (21s), `npm run typecheck`, `npm run lint`, `npx next build` and any test that only reads source all run clean in a cloud session. As of 2026-09-03, so does the full DB-backed suite — see [3.7](#37-postgres-without-docker-in-a-cloud-session).                                    |
| **[LOCAL]**  | Claude on your desktop                     | For work that has to exercise Docker itself — `docker compose up`, the session-start hook's Docker branch — not merely "needs Postgres." A cloud session has the `docker` binary but no daemon (`/var/run/docker.sock` does not exist), so nothing that specifically depends on Docker running can be proven there. |

This document covers repo mechanics. For the product phases — the ESPN adapter, deployment, the
UI ladder, email, hardening — see [the roadmap's status table](roadmap.md#roadmap).

**Correction, 2026-09-03: the [LOCAL] lane used to be much wider than this.** It previously read
"needs Postgres... so anything gated on `npm test` as a whole must run where Docker does" — true
of this repo's own `db:up` script, false of Postgres itself. A cloud session that installs and
starts a native Postgres server (no container runtime involved — see
[3.7](#37-postgres-without-docker-in-a-cloud-session)) runs the entire suite, migrations
included. What's left in [LOCAL] is narrower and more honest: only the things that test _Docker
specifically_, not everything that merely needs a database.

Two things soften the [LOCAL] lane further: **CI has Postgres**, so a cloud session that opens a
pull request gets the full suite run against a real database by the `verify` job regardless; and
now a cloud session can get its own Postgres directly, without waiting on CI at all.

These map onto the H / C / L lanes in the
[implementation plan](plans/2026-08-20-repo-health-implementation-plan.md) — H is [MANUAL], C is
[CLOUD], L was [LOCAL] — with one correction. The plan put the guard test in lane L on the
assumption that every test needs a database. It does not, and the table above moves it to
[CLOUD]; see [3.3](#33-money-invariants--all-three-layers) for the measurement.

### Done

| #   | Item                                                                                                                                                                      | Lane       | Landed                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| 1   | Branch protection on `main` requiring `verify` ([1.4](#14-cheap-improvements))                                                                                            | **[NOAH]** | Re-verified 2026-08-25 — `main` is protected                                                 |
| 2   | Five milestones, and the `bug` / `money` / `ui` / `from-test-pass` / `phase-5`–`phase-9` labels ([4](#4-issues-and-milestones))                                           | **[NOAH]** | Spot-checked present; GitHub settings, not files                                             |
| 3   | Bug issue template ([2](#2-hygiene))                                                                                                                                      | [CLOUD]    | [#7](https://github.com/NoahJohn1/SimulatedBetting/pull/7)                                   |
| 4   | `decision-log` skill ([3.4](#34-decision-log--a-skill))                                                                                                                   | [CLOUD]    | [#7](https://github.com/NoahJohn1/SimulatedBetting/pull/7)                                   |
| 5   | `money-invariants` skill ([3.3](#33-money-invariants--all-three-layers))                                                                                                  | [CLOUD]    | [#7](https://github.com/NoahJohn1/SimulatedBetting/pull/7)                                   |
| 6   | `engines.node: ">=22"` — half the Node-pinning item ([1.4](#14-cheap-improvements))                                                                                       | [CLOUD]    | [#8](https://github.com/NoahJohn1/SimulatedBetting/pull/8), incidentally, not from this plan |
| 7   | `cron.yml` restored to valid YAML, schedule off ([1.5](#15-the-cron-workflow--the-only-thing-actually-broken))                                                            | [CLOUD]    | [#9](https://github.com/NoahJohn1/SimulatedBetting/pull/9) — a holding position, not the fix |
| 8   | Cron empty-secret guards on both jobs ([1.5](#15-the-cron-workflow--the-only-thing-actually-broken))                                                                      | [CLOUD]    | [#13](https://github.com/NoahJohn1/SimulatedBetting/pull/13)                                 |
| 9   | Ledger-funnel guard test ([3.3](#33-money-invariants--all-three-layers))                                                                                                  | [CLOUD]    | [#13](https://github.com/NoahJohn1/SimulatedBetting/pull/13) — proven able to fail           |
| 10  | `.nvmrc`, CI `build` / `concurrency` / `timeout-minutes`, Dependabot ([1.1](#11-it-never-builds--worth-adding-but-narrower-than-it-looks), [1.4](#14-cheap-improvements)) | [CLOUD]    | [#13](https://github.com/NoahJohn1/SimulatedBetting/pull/13)                                 |
| 11  | `session-start` hook — written, cloud branches proven ([3.6](#36-session-start--a-hook))                                                                                  | [CLOUD]    | [#13](https://github.com/NoahJohn1/SimulatedBetting/pull/13); Docker path outstanding        |
| 12  | `money-touch` PostToolUse hook — layer 2 ([3.3](#33-money-invariants--all-three-layers))                                                                                  | [CLOUD]    | [#13](https://github.com/NoahJohn1/SimulatedBetting/pull/13)                                 |
| 13  | `.env.test` documented in the README ([3.6](#36-session-start--a-hook))                                                                                                   | [CLOUD]    | [#13](https://github.com/NoahJohn1/SimulatedBetting/pull/13)                                 |
| 14  | Prettier plus `eslint-config-prettier` ([2](#2-hygiene))                                                                                                                  | [CLOUD]    | [#13](https://github.com/NoahJohn1/SimulatedBetting/pull/13)                                 |
| 15  | Reconcile the ESPN adapter work against the Prettier reformat                                                                                                             | [CLOUD]    | Commit `2722534` on `espn-adapter`, ahead of this branch's own PR                            |

### Outstanding

Nothing here is `[CLOUD]` work that is not blocked on somebody else. Every row names its lane
and what it is waiting on.

| #   | Item                                                                            | Owner        | Blocked on                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Add `APP_URL` and `CRON_SECRET` as Actions secrets**                          | **[NOAH]**   | Nothing — this is the only thing stopping the deployed app from settling bets. [Step by step](#what-you-must-do--the-cron-fix-step-by-step)                                                                                                                                                                                                  |
| 2   | **Dispatch both cron jobs by hand and confirm 200**                             | **[NOAH]**   | Row 1. The jobs now name the missing secret instead of exiting 3, so a red run says which side is wrong                                                                                                                                                                                                                                      |
| 3   | Uncomment the three `schedule:` lines in `cron.yml`                             | [CLOUD]      | Rows 1 and 2. One line of work; the guard it needs already landed                                                                                                                                                                                                                                                                            |
| 4   | Verify the `session-start` hook's Docker path                                   | **[LOCAL]**  | A desktop. The other four branches are proven — see [3.6](#36-session-start--a-hook)                                                                                                                                                                                                                                                         |
| 5   | Add `format:check` to `verify` and CI                                           | [CLOUD]      | Nothing — [Done row 15](#done) landed, so this is no longer blocked on the ESPN adapter reconciliation it was waiting for                                                                                                                                                                                                                    |
| 6   | Merge Dependabot's monthly PR                                                   | **[MANUAL]** | Nothing — standing monthly task. First fire 2026-09-02: [#14](https://github.com/NoahJohn1/SimulatedBetting/pull/14) and [#15](https://github.com/NoahJohn1/SimulatedBetting/pull/15) merged, [#16](https://github.com/NoahJohn1/SimulatedBetting/pull/16) and [#17](https://github.com/NoahJohn1/SimulatedBetting/pull/17) closed per row 7 |
| 7   | ESLint 10 and TypeScript 7 majors                                               | **[MANUAL]** | Upstream. See [1.6](#16-the-dependency-majors-that-cannot-land-yet) — Dependabot re-proposes monthly, and a green run is the signal to merge                                                                                                                                                                                                 |
| 8   | `db-migration` skill ([3.5](#35-db-migration--a-skill))                         | [CLOUD]      | Deliberately deferred. The trigger is a migration going wrong; it has not fired                                                                                                                                                                                                                                                              |
| 9   | The human test pass, and the issues it produces ([4](#4-issues-and-milestones)) | **[MANUAL]** | Nothing — no longer gates phase 5 (2026-09-03), still useful for 6-9 and for whatever it turns up along the way                                                                                                                                                                                                                              |

### What changed underneath all of this

**New since this document was first written**, and the reason for this revision:

- **The app is deployed.** [#8](https://github.com/NoahJohn1/SimulatedBetting/pull/8) added
  error and not-found boundaries, a season bootstrap script, and a second workflow,
  [`cron.yml`](../.github/workflows/cron.yml), and the app now runs on Vercel. That raises the
  stakes on everything below: a bad commit now reaches a live app rather than a laptop, and a
  scheduled job that fails is an incident rather than a red X in a tab nobody opens.
- **That second workflow is the one thing in this repo that is actually broken.** It failed
  every scheduled fire for two days, and the fix applied on 2026-08-24 replaced that failure
  with a different one. Written up in [1.5](#15-the-cron-workflow--the-only-thing-actually-broken).
- **The UI work is on `main` now.** `claude/roadmap-7b-plan-il1opu` merged as
  [PR #10](https://github.com/NoahJohn1/SimulatedBetting/pull/10) at `584a4ac`, followed by
  [PR #11](https://github.com/NoahJohn1/SimulatedBetting/pull/11) at `2d8dc91`, so phases 7a and
  7b are both on the default branch and every count in this document now measures the post-7b
  app. An earlier revision left those counts to "update themselves when it merges"; they did
  not, and three different test totals had accumulated in three places by the time anyone
  looked. They are corrected below and the promise is not repeated. That branch also added
  [D51](decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness),
  _UI conventions are tested structurally, not with a component-test harness_ — which is
  [3.2](#32-the-layering-rule) applied without being asked: a convention that could have been a
  code-review habit was made a test instead.

**Where the outstanding work can land.** Every remaining item in this document is repo mechanics
— `.github/workflows/`, `.claude/`, `.nvmrc`, `package.json`, a test under
`src/server/money/__tests__/`, and a README paragraph. `roadmap-7` touches none of those except
`package-lock.json` and the docs. So the list below can be worked on `main` in parallel with the
UI ladder without either branch fighting the other, and nothing here is a reason to hold up phase
7b. The one item that is genuinely urgent —
[the cron secrets](#15-the-cron-workflow--the-only-thing-actually-broken) — is a GitHub settings
change plus one uncommented block, and is independent of both branches.

---

## 1. The CI gate

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `npm ci`, applies migrations,
and runs `npm run verify` (typecheck, lint, 866 tests across 81 files). That is a good gate
with one real hole and several cheap improvements.

### 1.1 It never builds — worth adding, but narrower than it looks

`npm run verify` does not include `npm run build`, so nothing in CI compiles the routes.

**Measure the gain honestly before spending effort here.** Two attempts on 2026-08-20 to make
the build catch something `verify` misses — a client component importing the server-side db
client, then an invalid `export const revalidate` — both compiled clean. The build output shows
why: only `/_not-found` prerenders, and all 26 application routes are `ƒ` (dynamic). `next
build` therefore never executes page code; it compiles, and `tsc --noEmit` (with `next typegen`
supplying route types) already type-checks the same source.

What is left is real but narrow: bundler-level module resolution can differ from TypeScript's,
and a build failure there would otherwise reach production. At 10.7 seconds it is cheap
insurance. It is not, as an earlier draft of this document claimed, the gate's one great hole.

Adding it is free. Verified 2026-08-20 by running the build with every auth variable
explicitly unset:

```
env -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET npx next build
→ EXIT=0 · Compiled successfully in 10.7s · 26/26 routes
```

Two findings from that run:

- **No auth credentials are needed.** Every route builds as `ƒ` (dynamic, server-rendered on
  demand), so nothing prerenders and nothing evaluates auth at build time. `next-auth` reads
  `AUTH_GOOGLE_*` lazily at request time.
- **`DATABASE_URL` must be set but not reachable.** [`src/db/client.ts:7`](../src/db/client.ts)
  throws at module import if it is missing, but Postgres was not listening during that build
  and it passed anyway. The CI job already exports the variable.

It landed as a workflow step on this branch, not as an addition to `verify`. Keep it out of
`verify` — `verify` is what a developer runs in a loop, and a 10-second build on every local
run is a tax for no local benefit.

**Re-measured 2026-08-25, in a Claude Code cloud session, and two things moved.** The build runs
there — `npm ci` in 21 seconds, then `next build` green with `DATABASE_URL` pointed at a host
that is not listening — which makes this item [CLOUD] rather than something that has to wait
for a laptop:

```
DATABASE_URL=postgres://x npx next build
→ EXIT=0 · 32 routes · 28 ƒ (dynamic) · 4 prerendered
```

Re-measured 2026-09-02: 32 routes, not 30, and four now settle at build time rather than two —
the icon routes became SSG. That widens the case above a little further: `next build` executes
page code for four routes, so a prerender-time throw in any of them is a failure CI catches and
`verify` does not. Still narrow, still cheap, and it landed on this branch.

### 1.2 Do not put real OAuth credentials in CI

CI never signs anyone in. Real Google credentials in Actions secrets buy zero capability and
add an exposure surface — anyone who can push a workflow file to a branch can print them.
Nothing in the gate needs them, as 1.1 proves.

Related, because it is easy to conflate: **Claude Code cloud-session environment variables are
not GitHub Actions secrets.** They are separate systems. Setting `AUTH_GOOGLE_ID` in a Claude
session does nothing for CI, and vice versa.

**This rule is about the `verify` job, and it did not survive contact with production
unchanged.** The repo now has a second workflow that legitimately needs two Actions secrets —
`APP_URL` and `CRON_SECRET` — because it calls the deployed app over HTTP. That is an
operational credential, not a build credential: it lets Actions invoke a route that is already
public, guarded by a token the app itself checks. The distinction worth keeping is that nothing
in the _gate_ needs a secret, so nothing in the gate should have one. See
[1.5](#15-the-cron-workflow--the-only-thing-actually-broken) for what happens when those two
secrets do not exist.

### 1.3 What CI structurally cannot cover

The gate can verify typecheck, lint, tests, and build with no secrets at all. It cannot
verify a real Google sign-in round trip — that needs a browser and a real OAuth client. That
check belongs in the phase 9 smoke checklist, not the pipeline. Worth writing down so nobody
later tries to automate it into CI and burns a weekend on it.

### 1.4 Cheap improvements

- **`concurrency` group with `cancel-in-progress`.** Work here lands in bursts of pushes;
  superseded runs currently run to completion for nothing.
- **`timeout-minutes: 15`.** The default is six hours. A Postgres service container that never
  reports healthy otherwise hangs that long.
- ~~**Pin Node everywhere.**~~ **Done.** `engines.node: ">=22"` landed with
  [#8](https://github.com/NoahJohn1/SimulatedBetting/pull/8); `.nvmrc` — the half that
  actually switches a version manager — landed on this branch. A laptop sitting on Node 20
  now gets a warning from both.
- ~~**Dependabot, monthly, grouped.**~~ **Done.** Weekly, ungrouped, on a two-person project
  is noise you will train yourself to ignore, which is worse than not having it. Monthly with
  minor and patch grouped into one PR is roughly one PR a month that CI can prove safe; it
  landed on this branch, and its first PR is [Outstanding row 6](#outstanding).
- ~~**Branch protection on `main`** requiring CI to pass.~~ **Done.** A settings change rather
  than a file: Settings → Branches → require status checks. This is what makes the gate a gate.

### 1.5 The cron workflow — the only thing actually broken

[#8](https://github.com/NoahJohn1/SimulatedBetting/pull/8) added a second workflow,
[`cron.yml`](../.github/workflows/cron.yml), for a good reason: Vercel Hobby only allows crons
that run daily or less, and `sync-odds` (every 15 minutes) and `settle` (every 10 minutes) need
to run far more often than that. So they moved to GitHub Actions, calling the same route
handlers over HTTP with the same bearer token Vercel Cron would have sent. `allowance` and
`reconcile` stayed native in [`vercel.json`](../vercel.json). That design is sound.

**What the two jobs actually do**, since it is not written down anywhere else:

| Job         | Cadence      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync-odds` | every 15 min | `syncOdds` pulls the slate and prices; `syncResults` applies reported scores and marks games `FINAL`; `suspendStaleMarkets` suspends anything whose price has gone stale so nobody can bet into a dead line. Both providers are still the **fixture** ones, so on the deployed app this moves fixture data, not real games — that is phase 5's job.                                                                                                                                                                                                                                                                                                                                                      |
| `settle`    | every 10 min | `settleFinalGames` grades every pending leg on a finished game from the line and price frozen at placement, settles the bets those legs belong to, and pays out — batched to fit the invocation limit, with the remainder picked up next run. Then `detectLeadChange` emits a feed event if the standings lead changed, `sweepOverdueEvents` flags custom events past their resolve-by time, and `sweepP2PWagers` makes three passes: expire unaccepted offers and refund their escrow, settle market-backed wagers whose game has finished, flag overdue ones for arbitration. Returns 207 rather than 200 if an individual game or wager errored, so one bad row is reported without failing the rest. |

`allowance` (weekly) and `reconcile` (daily) are unaffected by any of this — they are native Vercel
crons and run from [`vercel.json`](../vercel.json). But if `CRON_SECRET` is missing from the Vercel
environment rather than just from Actions, those two are failing as well, silently, for the same
fail-closed reason.

**Nothing is lost while the schedule is off, only late.** Both routes are resumable and every
ledger write is idempotent, so turning the schedule back on works through the backlog: pending
bets grade, expired offers refund, overdue wagers get flagged. What you cannot get back is the
timing — a bet that should have settled Sunday settles whenever the first successful run happens.

**It has never once succeeded.** Every scheduled fire from the merge on 2026-08-22 until it was
switched off on 2026-08-24 failed — roughly 130 runs over two days. The cause is not the app and
not the routes:

```
env:
  APP_URL:
  CRON_SECRET:
##[error]Process completed with exit code 3.
```

Both secrets resolve to empty, so `curl` is handed a bare `/api/cron/settle` with no host and
exits 3 — a malformed-URL failure, before any request leaves the runner. The two Actions
repository secrets the workflow reads simply do not exist. Nothing was ever called; nothing has
been syncing odds or settling bets on the deployed app through this path.

**The 2026-08-24 response traded one red X for another.** Commenting out the `on:` key stops the
schedule, but it leaves a file whose first mapping key is indented under a comment, which is not
valid YAML. GitHub now rejects the workflow at parse time and records a failed run on every push
to `main` instead — the run that followed that commit failed in the same second it was created,
with no jobs. Same red X in the Actions tab, new reason.

**What this branch changes.** `on:` is restored as valid YAML with `workflow_dispatch` only, and
the `schedule:` block sits directly under it as three commented lines. The file parses, nothing
fires on a timer, both jobs stay runnable by hand from the Actions tab, and pushes to `main` stop
going red. This is a holding position, not a fix.

**What the holding position costs.** `settleFinalGames`, `sweepOverdueEvents` and
`sweepP2PWagers` are called from exactly one place in the codebase —
[`src/app/api/cron/settle/route.ts`](../src/app/api/cron/settle/route.ts) — and nothing else
invokes them. With the schedule off, nothing on the deployed app grades a bet, sweeps an expired
offer, or flags an overdue wager. `allowance` and `reconcile` still run natively from
[`vercel.json`](../vercel.json), so the weekly allowance and the daily reconciliation are
unaffected.

### What you must do — the cron fix, step by step

Steps 1 through 4 are **[NOAH]**: they need the Vercel dashboard and GitHub repo settings, which
only Noah holds. Step 5 is **[CLOUD]** — hand it to a Claude session once the
secrets exist. Step 6 is **[MANUAL]** — either of you, and it is just looking.

1. **[NOAH] Get the `CRON_SECRET` value out of Vercel.** Vercel → the project → Settings →
   Environment Variables → `CRON_SECRET`. If it is not there, the deployed app is currently
   rejecting _every_ cron call with `500 CRON_SECRET is not configured`
   ([`src/server/cron/auth.ts`](../src/server/cron/auth.ts) fails closed on purpose), including
   the two native Vercel crons. In that case generate one — `openssl rand -hex 32` — add it to
   all environments, and redeploy so the running app picks it up.
2. **[NOAH] Write down `APP_URL`.** The production origin, no trailing slash and no path:
   `https://<project>.vercel.app`, or the custom domain if one is attached. A trailing slash
   produces `//api/cron/settle`, which will 404.
3. **[NOAH] Add both as Actions secrets.** GitHub → the repo → Settings → Secrets and variables
   → Actions → _New repository secret_. Add `APP_URL`, then `CRON_SECRET` with the **same value**
   Vercel holds. Repository secrets, not environment secrets — the workflow reads them as
   `secrets.APP_URL` and `secrets.CRON_SECRET` with no environment declared.
4. **[NOAH] Run both jobs by hand.** Actions → _Sportsbook cron jobs_ → Run workflow. Both
   `sync-odds` and `settle` fire on a manual dispatch. Green means the whole path works. If it is
   red, the exit code says which side is wrong:

   | Symptom                                   | What it means                                               |
   | ----------------------------------------- | ----------------------------------------------------------- |
   | exit 3, `APP_URL:` blank in the log       | The Actions secret is missing or misnamed — step 3          |
   | HTTP 500, `CRON_SECRET is not configured` | Vercel does not have the variable — step 1                  |
   | HTTP 401, `unauthorized`                  | Both sides have a secret and they do not match              |
   | HTTP 404                                  | `APP_URL` has a trailing slash or the wrong domain — step 2 |

5. **[CLOUD] Turn the schedule back on.** Uncomment the three `schedule:` lines in
   [`cron.yml`](../.github/workflows/cron.yml) and add a guard before each `curl` —
   `[ -n "$APP_URL" ] || { echo "APP_URL secret is not set"; exit 1; }` — so the next missing
   secret produces one legible failure instead of 130 illegible ones.
6. **[MANUAL] Watch one cycle.** `sync-odds` fires within 15 minutes, `settle` within 10. Two
   green runs and this is closed.

**Do not skip step 4 by uncommenting the schedule first.** That is how the last two days went:
the failure was real from the first fire, and nothing about a five-minute wait made it more
visible than a manual run would have.

One thing not to expect from re-enabling it:
[`sync-odds`](../src/app/api/cron/sync-odds/route.ts) still constructs `FixtureOddsProvider` and
`FixtureScoreProvider`, so a working schedule syncs fixture data on a timer, not real games. That
is phase 5's job, and the route comment is right that it is a two-line swap — but until then a
green cron run does not mean live odds.

**And the part that is not a workflow problem at all.** Two days of failing jobs produced no
signal anyone acted on until the noise itself became annoying. That is precisely the gap phase 6
names — _"a `settle` run that throws is invisible: no bet settles, no one is told, and the first
signal is a member asking why Sunday never graded"_
([roadmap](roadmap.md#6--production-deployment)). This incident is the argument for that item,
already paid for once.

### 1.6 The dependency majors that cannot land yet

**Lane: [MANUAL], blocked upstream.** Recorded 2026-09-02, after Dependabot's first fire.

Dependabot's monthly run opened four pull requests. The two grouped ones —
[#14](https://github.com/NoahJohn1/SimulatedBetting/pull/14) (GitHub Actions) and
[#15](https://github.com/NoahJohn1/SimulatedBetting/pull/15) (npm minor and patch) — went green
and merged. The two major bumps failed `verify` and were closed:

| PR                                                           | Bump                     | Failing step   | The actual error                                                                                            |
| ------------------------------------------------------------ | ------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------- |
| [#16](https://github.com/NoahJohn1/SimulatedBetting/pull/16) | `eslint` 9.39.5 → 10.9.1 | `npm run lint` | `TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function` |
| [#17](https://github.com/NoahJohn1/SimulatedBetting/pull/17) | `typescript` 5 → 7.0.2   | `npm ci`       | `Missing: typescript@5.9.3 from lock file`, under a peer conflict                                           |

**Neither is a defect in this repository, and neither should have passed.** Both are
`eslint-config-next` 16.3.3 not being ready:

- It bundles `eslint-plugin-react`, which uses the rule-context API ESLint 10 removed. A green
  run on #16 would have been a false statement about this project.
- It bundles `typescript-eslint`, which declares `peer typescript ">=4.8.4 <6.1.0"`. TypeScript 7
  is two majors outside that range.

**Why they are closed rather than ignored.** `@dependabot ignore this major version` would stop
the monthly re-proposal, and with it the only signal this project has that the block cleared.
Left un-ignored, Dependabot re-opens both each month and CI re-answers the question for free: the
month `eslint-config-next` ships support, the PR goes green on its own and that green is the cue
to merge. The cost is a glance at two red PRs a month, which is cheaper than a reminder nobody
set. See [D57](decisions.md#d57--dependency-majors-blocked-upstream-are-closed-not-ignored).

**Why they arrived separately.** `.github/dependabot.yml` groups only `minor` and `patch`. Had
majors been in that group, one un-landable bump would have made the entire monthly update
unmergeable instead of just itself — the grouping earned its keep on its first run.

---

## 2. Hygiene

### Worth adding

- **Prettier plus `eslint-config-prettier`.** Two developers and no formatter is a diff-noise
  generator — reformatting churn shows up in review as if it were real change. ESLint is
  configured but does not format.
- **One issue template**, for bugs found in the human test pass, with a project-specific field:
  _does `reconcileBalances` / `reconcileEscrow` still pass?_ For a money app that question
  separates "annoying" from "drop everything."

### Not worth adding

- **LICENSE** — `package.json` already sets `"private": true`. Nobody is redistributing this.
- **CODEOWNERS** — there are two of you, and you both own everything.
- **A PR template** — the PRs here are already descriptive. A template would add ceremony to
  something working.

---

## 3. Development tooling: three layers

The instinct is to want a check that fires automatically when sensitive code changes. That is
achievable, but not with one mechanism — and picking the wrong one gives the illusion of
enforcement without the substance.

### 3.1 The three mechanisms, and which is which

| Mechanism    | Lives in                         | How it fires                                                            | Guaranteed?                   |
| ------------ | -------------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| **Skill**    | `.claude/skills/<name>/SKILL.md` | Claude reads its `description` and decides it applies; or `/name`       | **No** — a judgment call      |
| **Subagent** | `.claude/agents/<name>.md`       | Claude spawns it, or you name it. Runs in its own context window        | **No** — a judgment call      |
| **Hook**     | `.claude/settings.json`          | The harness runs it on an event (`SessionStart`, `PostToolUse`, `Stop`) | **Yes** — not a judgment call |

The fourteen skills already in `.claude/skills/` are the first row. `test-driven-development`
loads because its description matched the task at hand, not because anything compelled it.
**Skills are instructions Claude chooses to load. They are good at procedure and bad at
enforcement.**

One mechanical detail: a hook's `matcher` field matches **tool names** (`Edit`, `Write`), not
file paths. Path filtering happens inside the hook script, which reads the tool input as JSON
on stdin. A matcher of `src/server/money/**` silently matches nothing.

### 3.2 The layering rule

For anything that actually matters, use the cheapest mechanism that can do the job:

1. **A test**, for properties that are mechanically checkable. Deterministic, runs in CI,
   cannot be reasoned out of its finding, costs nothing per run.
2. **A hook**, for detecting that a situation arose. Deterministic, but can only run a command
   — it cannot form a judgment.
3. **An agent or skill**, for the part that needs reading comprehension.

Most "AI should check this" instincts are really layer 1 in disguise.

### 3.3 Money invariants — all three layers

The ledger is the highest-stakes code in the repo and the easiest to break subtly. Four
invariants, from [D5](decisions.md#d5--balance-immutable-ledger-plus-a-cached-balance),
[D34](decisions.md#d34--currency-is-a-dimension-on-the-existing-ledger-not-a-second-ledger),
[D43](decisions.md#d43--escrow-needs-its-own-reconciliation-check-balance-reconciliation-cannot-see-it),
and the idempotency property in the root README:

1. The ledger is append-only; corrections write reversing entries rather than editing history
2. Every ledger write carries a deterministic idempotency key
3. The `balance_cents` cache is updated in the same transaction as its entry
4. Escrowed credits need `reconcileEscrow`, because `reconcileBalances` cannot see them

**Layer 1 — a guard test, landed in Task 2 of this branch.** The codebase already has the
property that makes this easy: **every ledger write funnels through `postEntry`** in
[`src/server/money/ledger.ts`](../src/server/money/ledger.ts). Re-verified 2026-09-02 and the
property still holds: exactly one `.insert(ledgerEntries)` in the repo outside tests — at
[`ledger.ts:64`](../src/server/money/ledger.ts), the one inside `postEntry` — zero updates or
deletes anywhere, and 28 files referencing `postEntry`. The schema tests in `src/db/__tests__/`
insert directly, which is legitimate: they exist to test the constraint itself.

So a test can assert, by scanning source:

- No file outside `src/server/money/ledger.ts` and `__tests__/` calls `.insert(ledgerEntries)`
- No file anywhere calls `.update(ledgerEntries)` or `.delete(ledgerEntries)`

**This is [CLOUD] work, which the original plan got wrong.** It was filed under the lane that
needs Docker, on the assumption that every test needs Postgres. It does not: a test that only
reads files touches no database, and `src/test/setup.ts` just loads `.env.test` — it opens no
connection. Proven 2026-08-25 by running a throwaway version of exactly this test in a cloud
session with no Postgres anywhere: `1 passed`, 381ms. Only the surrounding `npm run verify` needs
a database, and CI supplies one on the pull request.

That is invariant 1 plus the funnel, enforced deterministically, in CI, forever. It passes
today, so it locks in a property rather than asking anyone to fix anything. It is a test now,
not another round of hand verification:
[`ledger-funnel.test.ts`](../src/server/money/__tests__/ledger-funnel.test.ts) fails the build
the day anyone writes a direct insert, rather than depending on nobody having done so yet.

**Layer 2 — a `PostToolUse` hook, landed in Task 5 of this branch.**
[`money-touch.sh`](../.claude/hooks/money-touch.sh) fires on `Edit`/`Write`, reads the path
from stdin, and if it falls under `src/server/money/`, `src/server/bets/`, `src/server/p2p/`,
`src/server/events/resolve.ts`, or the ledger schema, prints one line flagging that money code
was touched. Kept cheap on purpose — a flag, not a review. A hook that spawns a full agent
review on every save of a money file is slow and interrupts mid-edit, and the reliable outcome
of that is that someone disables it —
[D56](decisions.md#d56--the-money-path-hook-is-a-flag-not-a-review).

**Layer 3 — a `money-invariants` skill, landed since
[#7](https://github.com/NoahJohn1/SimulatedBetting/pull/7).** Deliberately a skill rather than a dedicated
subagent: the built-in `/code-review` and `/security-review` already supply the reviewing
machinery, and what they lack is this project's specific knowledge. Packaging that knowledge as
a skill those reviews can pull in gets the value without maintaining a parallel review path. It
covers what a test cannot read: _is this idempotency key actually
deterministic, or does it close over a timestamp?_ _Does this new balance write share the
entry's transaction?_ _Does this credits path stay non-convertible under
[D31](decisions.md#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency)?_
Run it before committing money-path work, or invoke it directly as `/money-invariants`.

### 3.4 `decision-log` — a skill

The D-number convention is this project's most distinctive habit and its most fiddly: find the
next number, match the house format (`### D<n> — <title>`, an `*Added <date> during the <x>
session.*` line, body, then `*Rejected:*` paragraphs), and cross-link with GitHub's anchor
slugs, which drop punctuation and apostrophes in ways that are easy to get wrong by hand.
The convention also includes a rule worth encoding: when a decision turns out to be wrong,
**add a superseding entry rather than editing the old one** — D49 supersedes D2 that way.

A skill, because this is a procedure Claude follows when it is already writing up a decision.
Also `/decision-log` when invoked directly.

### 3.5 `db-migration` — a skill

Codifies: edit schema → `db:generate` → **read the generated SQL** → `db:migrate` →
`db:migrate:test` → `npm test`. Two steps in that chain are the ones that get skipped. Reading
the generated SQL matters because Drizzle will happily generate a destructive migration for a
rename. `db:migrate:test` matters because forgetting it produces a test failure that looks like
a code bug and is not.

### 3.6 `session-start` — a hook

**Lane: [CLOUD] to write and mostly prove, [LOCAL] to finish.** The original `[LOCAL]` tag was
broader than the work. A cloud session is the _better_ place to prove four of the hook's five
branches, because a cloud session is the degraded environment the hook exists to handle.

| Branch                                                   | Proven where | Status                                                         |
| -------------------------------------------------------- | ------------ | -------------------------------------------------------------- |
| `npm ci` when `node_modules` is absent                   | [CLOUD]      | ✅                                                             |
| Re-running is a no-op                                    | [CLOUD]      | ✅                                                             |
| No daemon → prints instructions, exits 0                 | [CLOUD]      | ✅                                                             |
| A `docker` binary on `PATH` is not mistaken for a daemon | [CLOUD]      | ✅                                                             |
| `docker compose up -d --wait` and both migrations        | **[LOCAL]**  | 🔲 Outstanding — row 4                                         |
| Native Postgres fallback and both migrations, no Docker  | [CLOUD]      | ✅ — see [3.7](#37-postgres-without-docker-in-a-cloud-session) |

A Claude Code web session starts with no `node_modules` and no Postgres reachable on port 5433
(docker-compose's mapping), so it cannot bring up _that_ database. Re-confirmed 2026-08-25:
`node_modules` absent, port 5433 closed.

**One correction to the original writeup, and a second correction on top of it.** The original
recorded `docker` as "available" in a web session; the binary is on `PATH`, but there is no
daemon (`/var/run/docker.sock` does not exist, `docker info` fails). That correction still
holds — `docker compose up` genuinely cannot work in a cloud session. What no longer holds is
the conclusion drawn from it: that a `SessionStart` hook therefore "cannot bring Postgres up in
a cloud session at all." As of 2026-09-03 it can, just not through Docker — see
[3.7](#37-postgres-without-docker-in-a-cloud-session). The hook now tries the Docker path first
and falls back to a native Postgres server running directly in the container, which this specific
environment's image ships pre-installed. A web session is no longer read-only with respect to
the tests. This also means the [three-lane
plan](plans/2026-08-20-repo-health-implementation-plan.md)'s split of _this specific item_ is
narrower than it was — see 3.7 for what's still genuinely [LOCAL] versus what moved to [CLOUD].

A `SessionStart` hook fixes it: `npm ci` when `node_modules` is missing, `docker compose up -d
--wait` (or the native fallback below), create and migrate the test database. Five
requirements:

- **Idempotent** — re-running must be a no-op when everything is already up.
- **Never fails the session** — if neither Postgres path is available it prints what to run by
  hand and exits zero. A hook that blocks a session start is worse than no hook.
- **Tests the daemon, not the binary** — `command -v docker` succeeds in a cloud session where
  `docker compose up` cannot work. The check that matters is `docker info`.
- **Honest about cost** — a cold `npm ci` is not instant, and the hook should say what it is
  doing rather than appearing to hang.
- **Docker first, native second** — the hook never installs packages itself (that needs
  network and is worth a session seeing, not doing silently on every start); it only starts and
  configures a Postgres server that is already present.

The `session-start-hook` skill in the Claude Code environment covers the mechanics.

### 3.7 Postgres without Docker in a cloud session

**Lane: [CLOUD], proven 2026-09-03.** The `[LOCAL]` tag on "needs Postgres" items always meant
"needs this repo's own `db:up`," which needs Docker. It was never actually a claim about
Postgres itself — that assumption just went unchallenged until a cloud session tried apt
directly instead of accepting the Docker daemon's absence as final.

**What was tried and worked.** This environment's container image ships `postgresql-16` (server,
not just the `psql` client) pre-installed but uninitialized-into-service — a `pg_lsclusters`
cluster exists, just not started, and `policy-rc.d` blocks it from auto-starting on package
install or upgrade. Running as root with passwordless `sudo` (both already true of this
environment), starting it needs no network at all:

```bash
pg_ctlcluster 16 main start   # or: sudo apt-get install -y postgresql, if no cluster exists yet
sudo -u postgres psql -c "CREATE ROLE simbet LOGIN PASSWORD 'simbet'"
sudo -u postgres createdb -O simbet simbet
sudo -u postgres createdb -O simbet simbet_test
```

Pointed at that (`DATABASE_URL=postgres://simbet:simbet@127.0.0.1:5432/simbet_test` in
`.env.test`, migrated with `npx tsx src/db/migrate.ts`): `npm run verify` passes in full —
typecheck, lint, and all 866 tests across 81 files, including the DB-backed
`sync.test.ts`/`results.test.ts` that this document previously called uncloud-able. The
`session-start` hook (3.6) now does exactly this automatically as its fallback when no Docker
daemon is running, including a `pg_isready` retry loop for the gap between `pg_ctlcluster`
returning and Postgres actually accepting connections.

**What this does and doesn't change.** Every roadmap or repo-health item tagged `[LOCAL]` purely
because "it needs a database" should be re-read as `[CLOUD]` — this environment's image already
carries what that needs. What's still genuinely `[LOCAL]` is anything that tests _Docker itself_
— row 4 above (`docker compose up -d --wait`), and this repo's `db:up`/`docker-compose.yml`
path specifically — since a cloud session still has no daemon to exercise. A production
database (Vercel's hosted Postgres) is a separate concern entirely; this is a disposable,
session-local database good for running the suite, not a stand-in for production access.

**A safety note that came out of proving this.** Some cloud environments carry a real
`DATABASE_URL`/`TEST_DATABASE_URL` already set (a hosted database's credentials, injected as
container environment variables) — this one does, pointing at a Supabase project. `src/test/setup.ts`
loads `.env.test` with `override: true`, so the test suite always ignores that ambient value in
favor of the local target — but `src/db/migrate.ts` did not do the same for `.env.local`/
`$ENV_FILE` until this was found and fixed (see the plan's status note in
[the ESPN adapter plan](plans/2026-08-22-espn-adapter-implementation.md) for how). Any script
that loads env with plain `dotenv` and no `override: true` is one ambient variable away from
silently targeting whatever database this container's environment happens to carry — worth
checking before adding another one.

---

## 4. Issues and milestones

Chosen over a project board: two people do not need a kanban to know who is doing what, but
they do need shared state that does not conflict. A markdown checklist in git conflicts the
moment both people tick a box.

- **Five milestones**, one per roadmap phase, named to match
  [part two of the roadmap](roadmap.md#part-two--production-readiness).
- **Labels**: one per phase, plus `bug`, `money`, `ui`, and `from-test-pass`. `money` earns its
  place — it is the label that means "this one is not just annoying."
- **Do not pre-create thirty issues from the roadmap.** They rot into a second, contradictory
  roadmap that has to be reconciled with the first. Create a phase's issues when that phase
  starts. The roadmap stays the plan; issues are the working set.
- **The human test pass gets its own burst**, tagged `from-test-pass`. That is the immediate
  reason to have issues at all — it will produce more findings than a conversation can hold.

**Status 2026-08-25: the containers exist and are empty.** Milestones and labels are in place;
the repo has zero issues, open or closed. That is the expected state — the human test pass has
not happened, and "do not pre-create issues from the roadmap" is working as intended. Worth
recording only so that an empty issue list is not later read as evidence that this section never
landed. The one thing that has changed is that the app is deployed, so the first issues may well
arrive from production behavior rather than from the test pass; `from-test-pass` should stay
reserved for the pass itself.

---

## What is deliberately skipped

Recorded so these do not get re-proposed in six months:

- **A GitHub Projects board** — a second place to update, which drifts from the issue list.
  Revisit if a third developer appears.
- **Parallel CI jobs** — splitting typecheck/lint/test/build across jobs duplicates `npm ci`
  time to save wall-clock on a gate that already finishes quickly. Revisit if the suite gets
  slow enough to interrupt flow.
- **A staging environment** — phase 6 chose a kill switch plus fast rollback instead, for the
  same reasons.
- **Changelog or release automation** — there are no releases; there is a deployed `main`.
- **`npm audit` as a gate** — for a private four-person app with no untrusted input, it mostly
  produces unactionable transitive advisories. Dependabot covers the part that matters.
- **Coverage thresholds** — 81 test files against a larger codebase now, written test-first. A percentage
  gate would measure something already being done, and would eventually be gamed.

---

## Suggested order

The ordered list is the [outstanding table](#outstanding) at the top; this is the reasoning
behind the order, kept because the reasoning is the part that goes stale slowly.

1. **The cron workflow first, because it is the only item that is costing anything right now.**
   Everything else on the list makes future work safer. This one is a deployed app that does not
   grade bets. It is also the cheapest: two secrets and a manual run.
2. **Then the `session-start` hook**, because it is the item that makes every _other_ item easier
   to finish — and it is the one thing on the list that a cloud session cannot close for you, so
   it is worth spending desktop time on rather than saving desktop time for things a cloud
   session could have done.
3. **Then the guard test**, before phase 5 starts touching settlement paths. It also puts a real
   layer 1 under the `money-invariants` skill, which today rests on nothing mechanical.
4. **Then the CI chore commit** — `.nvmrc`, `build`, `concurrency`, `timeout-minutes`,
   Dependabot. One commit, individually small, and every piece of it is now [CLOUD].
5. **The `.env.test` README note** rides along with the hook.
6. **`db-migration` stays last and may never happen.** Still marginal; the README already
   documents the sequence.

**Not on this list:** the human test pass. It no longer gates phase 5 as of 2026-09-03 — see
[roadmap 5](roadmap.md#5--real-data-the-espn-adapter) for what replaced it there — but the
`from-test-pass` label still exists for 6-9 and for whatever a person finds along the way.

**Prettier is adopted, on this branch.** The stated reason for staying dropped — that adopting
it means one reformat commit touching nearly every file, and that commit would have landed on
one side of the long-lived `claude/roadmap-7b-plan-il1opu` branch
([PR #10](https://github.com/NoahJohn1/SimulatedBetting/pull/10)), guaranteeing a conflict in
every file it touched — expired once that branch merged. `.prettierrc` is configured to match
the existing code rather than Prettier's defaults: 86 files needed reformatting under it, not
230, because it picked up conventions already in use rather than imposing a property nobody
had chosen ([D55](decisions.md#d55--prettier-adopted-with-a-config-matched-to-the-existing-code)).
The reformat itself is isolated as its own commit, so it can be dropped whole with
one revert if it turns out to be in someone's way. `format:check` is deliberately **not** wired
into `verify` or CI yet — Noah's ESPN adapter work is unpushed, and a formatting gate today
would turn his eventual merge conflict into a red build instead of an ordinary one. See
[Outstanding rows 5 and 6](#outstanding): tell him before this merges, and wire the gate once
his branch lands.
