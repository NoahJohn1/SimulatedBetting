# Closing the cloud lane in repo health — design

*Written 2026-09-02.*

**The problem.** [`docs/repo-health.md`](../repo-health.md) sorts its outstanding work into four
lanes, and seven of the eleven rows sit in `[CLOUD]` — work a Claude Code web session can finish
start to finish, needing no database and no credentials. None of it has been done. Meanwhile the
document carries three live items that are not in its own outstanding table at all: Prettier,
whose stated reason for deferral expired when PR #10 merged; the §3.3 layer-2 hook, designed in
detail and never built; and a `[LOCAL]` tag on the session-start hook that is broader than the
work actually requires.

**The goal.** After this work, **the Outstanding table in `repo-health.md` contains no `[CLOUD]`
rows that are not explicitly blocked on someone else.** Every remaining row names its lane and
what it is waiting on. The document stops being a list of things nobody has done and becomes a
list of things only Noah, a desktop, or a person can do.

---

## 1. Scope

Nine items land. Each is independently useful and independently revertible.

| # | Item | Repo-health row | Files |
|---|---|---|---|
| 1 | Empty-secret guards on both cron jobs | Outstanding 3 (partial) | `.github/workflows/cron.yml` |
| 2 | Ledger-funnel guard test | Outstanding 4 | `src/server/money/__tests__/ledger-funnel.test.ts` |
| 3 | `.nvmrc` | Outstanding 6 | `.nvmrc` |
| 4 | CI `build`, `concurrency`, `timeout-minutes` | Outstanding 7 | `.github/workflows/ci.yml` |
| 5 | Dependabot — monthly, grouped | Outstanding 8 | `.github/dependabot.yml` |
| 6 | `.env.test` note | Outstanding 9 | `README.md` |
| 7 | `session-start` hook | Outstanding 5 (retagged) | `.claude/hooks/session-start.sh`, `.claude/settings.json` |
| 8 | `PostToolUse` money-path hook | §3.3 layer 2 — not previously tracked | `.claude/hooks/money-touch.sh`, `.claude/settings.json` |
| 9 | Prettier | §2, re-opened in the closing section | `.prettierrc`, `.prettierignore`, `package.json`, `eslint.config.mjs`, then every source file |

Item 10 is the documentation reconciliation that records all of the above, described in §7.

### Measurements this design rests on

Taken 2026-09-02 in the cloud session that wrote this document, not carried over from an earlier
revision:

| Claim | Measured |
|---|---|
| Node in a cloud session | v22.22.2, npm 10.9.7 |
| `node_modules` on session start | Absent |
| Docker | Binary at `/usr/bin/docker`; `docker info` fails; `/var/run/docker.sock` does not exist |
| `npm ci` | Runs clean |
| `DATABASE_URL=postgres://x npx next build` | Exit 0 — **32 routes, 28 ƒ dynamic, 4 prerendered** |
| The ledger funnel | Exactly one `.insert(ledgerEntries)` outside tests, at `src/server/money/ledger.ts:69`; direct inserts only in `src/db/__tests__/`; zero `.update(` or `.delete(` against `ledgerEntries` anywhere; 28 files reference `postEntry` |

**Two corrections fall out of this.** The route count in
[§1.1](../repo-health.md#11-it-never-builds--worth-adding-but-narrower-than-it-looks) says 30
routes with 2 prerendered; it is now 32 with 4, because the icon routes became SSG. And the
funnel property described in [§3.3](../repo-health.md#33-money-invariants--all-three-layers)
still holds, which is what makes item 2 a lock rather than a fix.

---

## 2. The cron guard, and why the schedule stays off

Repo-health's outstanding row 3 bundles two things: add a guard, and uncomment the `schedule:`
block. **They split.**

The guard lands now. Before each `curl`, both jobs get:

```
[ -n "$APP_URL" ] || { echo "APP_URL secret is not set"; exit 1; }
[ -n "$CRON_SECRET" ] || { echo "CRON_SECRET secret is not set"; exit 1; }
```

This is safe with the schedule off because both jobs remain dispatchable by hand, and a manual
dispatch is exactly step 4 of
[the cron fix](../repo-health.md#what-you-must-do--the-cron-fix-step-by-step). Today that
dispatch fails with `curl` exit 3 and no explanation. After this it fails with a line naming the
missing secret — which makes Noah's step 4 diagnostic instead of cryptic, and turns the
[symptom table](../repo-health.md#what-you-must-do--the-cron-fix-step-by-step)'s first row from
"read the blank value in the log" into "read the error."

**The `schedule:` block stays commented.** Uncommenting it before the secrets exist recreates the
exact failure the document was written about — a timer firing every ten minutes into a guard that
exits 1. The document's own instruction is *"Do not skip step 4 by uncommenting the schedule
first,"* and this design obeys it. Uncommenting becomes a one-line `[CLOUD]` follow-up whose
blocker is named in the Outstanding table.

---

## 3. The ledger-funnel guard test

A test that reads source files and asserts two properties:

1. No file outside `src/server/money/ledger.ts` calls `.insert(ledgerEntries)`, except files
   under a `__tests__/` directory
2. No file anywhere calls `.update(ledgerEntries)` or `.delete(ledgerEntries)`

**The `__tests__/` exemption is deliberate and narrow.** `src/db/__tests__/ledger-schema.test.ts`
and `currency-schema.test.ts` insert directly, which is legitimate — they exist to test the
database constraint itself, and routing them through `postEntry` would test the wrong thing.

**It needs no database.** A test that only reads files opens no connection, and `src/test/setup.ts`
just loads `.env.test`. This is the correction repo-health §3.3 already records: the item was
originally filed in the lane that needs Docker on the assumption that every test needs Postgres.

**It must be proven able to fail.** Landing a guard test that passes because it asserts nothing is
worse than not having one — it reads as enforcement while enforcing nothing. So the
implementation temporarily introduces a direct `.insert(ledgerEntries)` in a non-exempt file,
confirms the test goes red, and reverts. The commit records that observation.

---

## 4. The two hooks

Both register in `.claude/settings.json`, which **does not exist yet** — this creates it. Today
`.claude/` holds only `launch.json` and `skills/`.

### 4.1 `session-start` — the retag

Repo-health tags this `[LOCAL]`. The tag is right about one branch and wrong about the rest.

The hook has four documented requirements: idempotent, never fails the session, tests the daemon
rather than the binary, honest about cost. **A cloud session is the better place to prove three
of them**, because a cloud session *is* the degraded environment: binary on `PATH`, no daemon, no
socket, no `node_modules`. What a cloud session cannot prove is `docker compose up -d --wait`
succeeding and the test database migrating.

So the split is:

| Branch | Proven where |
|---|---|
| `npm ci` runs when `node_modules` is absent | [CLOUD] |
| Re-running is a no-op when everything is up | [CLOUD] |
| `docker info` failing prints instructions and exits 0 | [CLOUD] — this is the cloud session's own state |
| `command -v docker` succeeding is not mistaken for a working daemon | [CLOUD] |
| `docker compose up -d --wait` brings Postgres up and migrations apply | **[LOCAL]** |

Item 5 moves from `[LOCAL]` to `[CLOUD]` *written and three-quarters proven*, with one `[LOCAL]`
verification row remaining. That row is real and stays on the table until a desktop session
signs it off — this design does not claim the hook works end to end.

The script exits 0 on every path. A `SessionStart` hook that blocks a session start is worse than
no hook, and the failure mode of a hook people find obstructive is that someone disables it.

### 4.2 `money-touch` — layer 2, finally built

[§3.3](../repo-health.md#33-money-invariants--all-three-layers) designs a three-layer defense and
argues each layer's case. Layers 1 and 3 exist after this work — the guard test and the
`money-invariants` skill. Layer 2 has never been built and, unlike the deliberately-skipped items,
was never decided against. It is an omission.

A `PostToolUse` hook matching `Edit|Write`, reading the tool input as JSON on stdin, extracting
the file path, and printing one line if it falls under `src/server/money/`, `src/server/bets/`,
`src/server/p2p/`, `src/server/events/resolve.ts`, or `src/db/schema/money.ts`.

**A flag, not a review.** The document is explicit: *"A hook that spawns a full agent review on
every save of a money file is slow and interrupts mid-edit, and the reliable outcome of that is
that someone disables it."* The output is one line pointing at `/money-invariants`. It never
blocks, never fails a tool call, and exits 0 always.

One mechanical constraint the document already records and the implementation must respect: **a
hook's `matcher` matches tool names, not paths.** Path filtering happens inside the script. A
matcher of `src/server/money/**` silently matches nothing.

---

## 5. Prettier

### The decision

Adopt. `eslint-config-prettier` disables the ESLint rules that would fight it; a `format` and a
`format:check` script go in `package.json`; `format:check` is **not** added to `verify` or to CI
in this batch (see below).

### Configuration matches the existing code, not Prettier's defaults

The codebase is single-quote, semicolon-terminated, 2-space, trailing-comma, and runs to roughly
85–97 columns. Prettier's defaults are double quotes at 80 columns, which would reformat
essentially every line of every file for no reason anyone chose. So:

```
singleQuote: true
printWidth: 100
semi: true
trailingComma: all
```

**Measured 2026-09-02, and the gap is the whole argument.** Against 231 TypeScript files:

| Config | Files reformatted |
|---|---|
| Matched to existing style, above | **86** |
| Prettier defaults (double quotes, 80 columns) | **230** |

A config picked without looking at the code would rewrite essentially every file in the
repository. The point of adopting a formatter is to stop diff noise; defaults here would
generate one enormous burst of exactly that, and it is Noah who pays for it in rebase
conflicts. Matching the config to the code cuts the reformat by 63%.

### The coordination cost, which the document does not account for

Repo-health retired its own objection to Prettier on the grounds that the conflict argument died
with PR #10's merge. That reasoning is about a *branch*. It misses a laptop:
[the roadmap](../roadmap.md#roadmap) records that Noah's ESPN adapter work "exists only on his
machine" and nothing is pushed. **A repo-wide reformat landing on `main` means Noah rebases into
a conflict in every file he has touched.**

This does not change the decision, but it changes the packaging:

- The reformat is **its own commit**, containing nothing but formatting, placed second-to-last in
  the branch. Dropping it is one `git rebase --onto` or one revert, with nothing else to unpick.
- It produces a tagged handoff row: **[NOAH] commit or stash the ESPN adapter work before this
  merges.** That row is coordination, not code, and it belongs to him.
- `format:check` stays out of CI in this batch. Adding a gate that fails on unformatted code
  while an unmerged laptop branch exists converts a merge conflict into a red build. It becomes a
  `[CLOUD]` follow-up row, blocked on the adapter landing.

---

## 6. Deliberately not in this design

- **Uncommenting the cron `schedule:`.** §2. Blocked on Noah's steps 1–4, recorded as a row.
- **The `db-migration` skill.** Repo-health sets an explicit trigger — *"add it if a migration
  goes wrong, not before"* — and it has not fired. Recorded with its trigger condition so the
  next reader does not have to re-derive why a `[CLOUD]` item was left undone.
- **`format:check` in CI.** §5.
- **Anything `[NOAH]`, `[MANUAL]`, or requiring a Docker daemon to execute.** The cron secrets
  stay unset; the human test pass stays undone. This design closes a lane, not the list.
- **Re-deciding what is deliberately skipped.** The six items in
  [that section](../repo-health.md#what-is-deliberately-skipped) stay skipped. Prettier is treated
  here only because the document itself re-opened it.
- **Changing any application code.** Nothing under `src/app/`, and nothing in `src/server/`
  besides a new test file. Prettier reformats source but changes no behavior — that is the
  property that makes it safe to isolate in one commit.

---

## 7. Documentation

The rule this repo already follows: every document is listed in `docs/README.md`, and a status
that cannot be verified from the repository says so and is dated.

**`docs/repo-health.md`** — the Outstanding table is rewritten. Landed rows move to Done with the
branch reference. The remaining rows keep their lane and gain an explicit blocker. Handoff rows
created by this batch live **in the Outstanding table**, not in a separate section, so there
stays exactly one place to look. §1.1's route count is corrected; §3.3 gains the guard test as
its layer 1; §3.6 records the retag and what each lane proved; the Prettier paragraph in the
closing section is replaced by the decision.

**`docs/README.md`** — the three "What is left" tables re-sort. The cloud table shrinks to blocked
items and the 7c/7d/9 roadmap work; the Noah and desktop tables gain this batch's handoffs. New
spec and plan get their rows.

**`docs/roadmap.md`** — repo-health rows referenced from the roadmap pick up the retag.

**`docs/decisions.md`** — two entries: adopting Prettier with a config matched to existing style,
and building the layer-2 hook as a flag rather than a review. Both are decisions a later reader
would otherwise have to reconstruct from a diff.

Counts get corrected in the same pass rather than left to update themselves. The document already
records what happens otherwise: *"An earlier revision left those counts to update themselves when
it merges; they did not, and three different test totals had accumulated in three places by the
time anyone looked."*

---

## 8. Verification

| Level | What |
|---|---|
| Per commit | `npm run typecheck` and `npm run lint` clean |
| Item 1, 4, 5 | Both workflow files and the Dependabot file parse as YAML before commit |
| Item 2 | The test passes; and it is proven able to fail by temporarily violating the property |
| Item 4 | `DATABASE_URL=postgres://x npx next build` exits 0 locally before the step is added to CI |
| Item 7 | Run the script directly; run it twice for idempotency; confirm exit 0 with the daemon down |
| Item 8 | Feed the script a money path and a non-money path on stdin; confirm one fires and one does not |
| Item 9 | `npm run format:check` clean after the reformat; `npm run lint` still clean with `eslint-config-prettier` in place |
| Item 10 | The link-and-anchor checker from [the docs-status plan](../plans/2026-09-02-docs-status-and-archive-implementation-plan.md) reports `LINKS OK` |
| The whole branch | CI's `verify` job on the pull request — the full suite against a real Postgres |

**`npm test` is not run to completion in the authoring session.** The suite needs Postgres, which
a cloud session cannot reach. This is the documented split: cloud writes it, CI proves it. The
one test this batch adds is the exception — it reads files and runs standalone.
