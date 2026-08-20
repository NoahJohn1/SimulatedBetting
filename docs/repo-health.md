# Repo health and development tooling

What is worth adding to the repo, the CI gate, and the Claude Code setup — and what is
deliberately not, at this project's actual size.

**The yardstick.** Two developers, four users, one private group. Nearly every
"repo health" practice is designed for teams where people do not talk to each other daily.
Most of them cost more here than they return. Each recommendation below has to justify
itself against "we could just tell each other," and the ones that fail are listed in
[what is deliberately skipped](#what-is-deliberately-skipped) with the reason, so they do
not get re-proposed later.

**Status (2026-08-20).** Landed: branch protection on `main` requiring the `verify` check
([1.4](#14-cheap-improvements)); the five milestones and the `bug`, `money`, `ui`,
`from-test-pass`, and `phase-5`–`phase-9` labels ([4](#4-issues-and-milestones)) — all done
directly in GitHub settings, not as files in this repo; the `decision-log` skill
([3.4](#34-decision-log--a-skill)); the `money-invariants` skill
([3.3](#33-money-invariants--all-three-layers)); and the bug issue template ([2](#2-hygiene)).

Not yet landed: the ledger-funnel guard test ([3.3](#33-money-invariants--all-three-layers)),
the `session-start` hook ([3.6](#36-session-start--a-hook)), the CI build/concurrency/timeout/
Node-pinning/Dependabot changes ([1](#1-the-ci-gate)), and the `db-migration` skill
([3.5](#35-db-migration--a-skill)) — still marginal per that section; add it if a migration goes
wrong, not before.

---

## 1. The CI gate

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `npm ci`, applies migrations,
and runs `npm run verify` (typecheck, lint, 546 tests). That is a good gate with one real
hole and several cheap improvements.

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

So the change is one line in the workflow, or adding `build` to the `verify` script. Keep it
in the workflow rather than in `verify` — `verify` is what a developer runs in a loop, and a
10-second build on every local run is a tax for no local benefit.

### 1.2 Do not put real OAuth credentials in CI

CI never signs anyone in. Real Google credentials in Actions secrets buy zero capability and
add an exposure surface — anyone who can push a workflow file to a branch can print them.
Nothing in the gate needs them, as 1.1 proves.

Related, because it is easy to conflate: **Claude Code cloud-session environment variables are
not GitHub Actions secrets.** They are separate systems. Setting `AUTH_GOOGLE_ID` in a Claude
session does nothing for CI, and vice versa.

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
- **Pin Node everywhere.** CI pins 22 via `setup-node`; nothing else does. Add `.nvmrc` and an
  `engines.node` field so a local machine on Node 20 fails loudly instead of mysteriously.
- **Dependabot, monthly, grouped.** Weekly, ungrouped, on a two-person project is noise you
  will train yourself to ignore, which is worse than not having it. Monthly with minor and
  patch grouped into one PR is roughly one PR a month that CI can prove safe.
- **Branch protection on `main`** requiring CI to pass. A settings change rather than a file:
  Settings → Branches → require status checks. This is what makes the gate a gate.

---

## 2. Hygiene

### Worth adding

- **Prettier plus `eslint-config-prettier`.** Two developers and no formatter is a diff-noise
  generator — reformatting churn shows up in review as if it were real change. ESLint is
  configured but does not format.
- **One issue template**, for bugs found in the human test pass, with a project-specific field:
  *does `reconcileBalances` / `reconcileEscrow` still pass?* For a money app that question
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

| Mechanism | Lives in | How it fires | Guaranteed? |
|---|---|---|---|
| **Skill** | `.claude/skills/<name>/SKILL.md` | Claude reads its `description` and decides it applies; or `/name` | **No** — a judgment call |
| **Subagent** | `.claude/agents/<name>.md` | Claude spawns it, or you name it. Runs in its own context window | **No** — a judgment call |
| **Hook** | `.claude/settings.json` | The harness runs it on an event (`SessionStart`, `PostToolUse`, `Stop`) | **Yes** — not a judgment call |

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

**Layer 1 — a guard test.** The codebase already has the property that makes this easy:
**every ledger write funnels through `postEntry`** in
[`src/server/money/ledger.ts`](../src/server/money/ledger.ts). Verified 2026-08-20 — eleven
production call sites, zero direct inserts into `ledgerEntries` outside that file, zero updates
or deletes anywhere in the repo. The schema tests in `src/db/__tests__/` insert directly, which
is legitimate: they exist to test the constraint itself.

So a test can assert, by scanning source:

- No file outside `src/server/money/ledger.ts` and `__tests__/` calls `.insert(ledgerEntries)`
- No file anywhere calls `.update(ledgerEntries)` or `.delete(ledgerEntries)`

That is invariant 1 plus the funnel, enforced deterministically, in CI, forever. It passes
today, so it locks in a property rather than asking anyone to fix anything.

**Layer 2 — a `PostToolUse` hook.** Fires on `Edit`/`Write`, reads the path from stdin, and if
it falls under `src/server/money/`, `src/server/bets/`, `src/server/p2p/`,
`src/server/events/resolve.ts`, or the ledger schema, raises a flag that money code was
touched. Keep it cheap — a flag, not a review. A hook that spawns a full agent review on every
save of a money file is slow and interrupts mid-edit, and the reliable outcome of that is that
someone disables it.

**Layer 3 — a `money-invariants` skill.** Deliberately a skill rather than a dedicated
subagent: the built-in `/code-review` and `/security-review` already supply the reviewing
machinery, and what they lack is this project's specific knowledge. Packaging that knowledge as
a skill those reviews can pull in gets the value without maintaining a parallel review path. It
covers what a test cannot read: *is this idempotency key actually
deterministic, or does it close over a timestamp?* *Does this new balance write share the
entry's transaction?* *Does this credits path stay non-convertible under
[D31](decisions.md#d31--custom-events-are-bet-in-credits-a-second-non-convertible-currency)?*
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

A Claude Code web session starts with no `node_modules` and no Postgres, so it cannot run the
suite. Confirmed in the session that produced this document: `node_modules` absent, port 5433
closed, `docker` available. Every web session is currently read-only with respect to the tests,
which is a bad position from which to trust any change.

A `SessionStart` hook fixes it: `npm ci` when `node_modules` is missing, `docker compose up -d
--wait`, create and migrate the test database. Three requirements:

- **Idempotent** — re-running must be a no-op when everything is already up.
- **Never fails the session** — if Docker is unavailable it prints what to run by hand and
  exits zero. A hook that blocks a session start is worse than no hook.
- **Honest about cost** — a cold `npm ci` is not instant, and the hook should say what it is
  doing rather than appearing to hang.

The `session-start-hook` skill in the Claude Code environment covers the mechanics.

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
- **Coverage thresholds** — 73 test files against 25k lines, written test-first. A percentage
  gate would measure something already being done, and would eventually be gamed.

---

## Suggested order

1. **Branch protection on `main`** — CI is advisory until this exists; a red pull request can be
   merged today. Two minutes, and it is what makes every other CI improvement matter.
2. **`session-start` hook** — everything else is easier once a session can run the suite
3. **Milestones, labels, and the bug issue template** — before the human test pass, not during.
   Findings arrive faster than somewhere to put them can be set up.
4. **The money guard test** — locks in a property that holds today, before phase 5 starts
   touching settlement paths
5. **`decision-log` skill** — while the conventions are fresh
6. **CI: `build`, `concurrency`, `timeout-minutes`, `.nvmrc`, `engines`, Dependabot** — one
   chore commit; individually small, collectively tidy
7. **`money-invariants` skill** — wants the guard test underneath it first
8. **`db-migration` skill** — marginal; the README already documents the sequence

**Prettier is dropped.** Adopting it means one reformat commit touching nearly every file, and
doing that mid-roadmap immediately before the phase 7 UI rewrite trades real diff churn for a
cosmetic gain. Revisit after phase 7, if at all.
