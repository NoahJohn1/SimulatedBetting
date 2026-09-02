# Documentation status tracking and archive — design

*Written 2026-09-02.*

**The problem.** Two people are working this repo from different places — one in Claude Code
cloud sessions, one on a laptop with Docker and the credentials — and there is no single place
that answers "what can I pick up right now, and what is waiting on the other person." The
roadmap says what the phases are but not who can finish them. `docs/repo-health.md` has lanes
but they predate the split and are partly stale. And `docs/` has grown to 28,751 lines, 82% of
which is implementation plans for work that shipped months ago.

**The goal.** Make both documents answer three questions at a glance — what is done, what is
left, and who can do it — and cut the browsable documentation to the part that is still live.

---

## 1. The owner taxonomy

Four tags. The line between the last two is **credentials**, not difficulty.

| Tag | Means | Test |
|---|---|---|
| **[CLOUD]** | A Claude Code web session finishes it start to finish | Needs no database and no secrets. CI proves it on the pull request. |
| **[LOCAL]** | Claude on a desktop with Docker | Needs Postgres. A cloud session has the `docker` binary but no daemon — `/var/run/docker.sock` does not exist. |
| **[MANUAL]** | Human hands, either person | Clicking, reading, judging. No special account needed. |
| **[NOAH]** | An account or permission only Noah holds | GitHub repo settings, the Vercel dashboard, DNS records, paid signups. |

This **splits the existing `[MANUAL]` lane** in `docs/repo-health.md`. Every item currently
tagged `[MANUAL]` is re-sorted: the cron secrets and the manual workflow dispatch become
`[NOAH]`; the human test pass stays `[MANUAL]`.

An item may carry more than one tag when it has parts in different lanes — phase 8 is
`[CLOUD]` for the code and `[NOAH]` for the provider signup and DNS. Where that happens, the
detail table below the phase says which part is which.

### The recording rule

**The roadmap records what is in the repository, not what is on somebody's laptop.** Phase 5 is
the live case: Noah is working on the ESPN adapter, but as of 2026-09-02 there is no `espn`
reference anywhere in `src/`, and `origin` carries only `main` and the current working branch.
So phase 5 reads *"In progress — Noah, local only; nothing pushed as of 2026-09-02"* rather
than claiming a completion state the repo cannot show. When a status cannot be verified from
the repo, the doc says so and dates the observation.

---

## 2. `docs/roadmap.md` — restructure

### The master table

One table at the top of the document covering every item, old and current. It replaces both
the part-one subsystem table and the part-two phase table.

Columns: **# · Item · Status · Who finishes what's left · Reference**

Status is one of ✅ Complete, 🔄 In progress, or 🔲 Backlog.

The **Reference** column carries the links to the spec, plan, and audit for that item where
they exist — which is what allows a completed item to have no body section at all. Coverage
varies by row and that is informative: subsystem 1 has a spec but no plan, because plans only
start with the social layer.

| # | Item | Status | Who | Reference |
|---|---|---|---|---|
| 1 | Core betting engine | ✅ Complete | — | spec |
| 2 | Social layer | ✅ Complete | — | spec · plan |
| 3 | Custom events | ✅ Complete | — | spec · plan |
| 4 | Peer-to-peer bets | ✅ Complete | — | spec · plan |
| — | Human test pass — gates 5+ | 🔲 Backlog | [MANUAL] | — |
| 5 | ESPN adapter | 🔄 In progress — Noah, local only | [CLOUD] [LOCAL] | spec pending |
| 6 | Production deployment | 🔄 Partial | [NOAH] mostly | — |
| 7a | UI foundations | ✅ Complete | — | spec · plan · mobile audit |
| 7b | Design system | ✅ Complete | — | spec · plan · design-system audit |
| 7c | Screen-by-screen rebuild | 🔲 Backlog | [CLOUD] | — |
| 7d | Craft | 🔲 Backlog | [CLOUD] | — |
| 8 | Email notifications | 🔲 Backlog | [CLOUD] [NOAH] | — |
| 9 | Hardening | 🔲 Backlog | [CLOUD] [LOCAL] [MANUAL] | — |

Immediately under it, the one live sentence from the current part-one prose: every subsystem
passes `npm run verify` against fixture data, and none of it has been through a human test
pass — which is the gate on phase 5.

### What leaves the body

Completed items get no body section. Deleted outright rather than moved, because each is
already triplicated: the spec in `specs/` is the authority on what the subsystem does, and
`decisions.md` is the authority on why. The roadmap's third summary is the one that drifts.

Removed:

- Subsystems 1–4 detail sections, including the part-one "Sequencing" section (~110 lines)
- The 7a and 7b rung sections, including 7b's "What this section originally got wrong" and
  "What 7b defers" (~80 lines)
- The part-one and part-two tables the master table replaces
- The phase-7 rung status table, now redundant with the master table

**Kept, deliberately:** the 7c and 7d **inherited backlog tables**. `docs/README.md` conventions
require that "a phase that declines work records where the work went," and those backlogs are
forward-looking work, not history. This also resolves the one wrinkle in linking the two audits
from ✅ rows — the audits carry live findings, and the backlog tables restate every one of them
with a "Deferred by" column, so the live work stays visible in the body even though its audit is
referenced from a completed row.

### What gains detail

Phases 5, 6, 7c, 7d, 8, and 9 keep their prose and each gains a task-level table with **Status**
and **Owner** columns, so the master table's per-phase tag decomposes into per-task tags.

Phase 6 additionally gets its status corrected against what is actually in the repo. Verified
2026-09-02: no monitoring dependency in `package.json`; no admin health page (`src/app/admin`
holds only `page.tsx`, `events/`, `wagers/`); `createSeason` is reachable only from `seed.ts`
and `bootstrap-season.ts`, so there is no season-creation UI; and `reconcileBalances` /
`reconcileEscrow` are called only from the cron route, with no alerting path. The phase is
deployed but its observability half — which the phase text itself calls "the item that earns
the phase" — is absent.

**Expected result: 466 lines → roughly 200.**

---

## 3. `docs/repo-health.md` — refresh

The structure is sound and stays. Three categories of change.

### Stale facts, corrected

| Line | Currently claims | Reality |
|---|---|---|
| 77–90 | "`main` is not where the current UI work lives"; PR #10 open, carrying 7a and 7b | PR #10 merged at `584a4ac`, PR #11 merged on top at `2d8dc91`. `main` carries both rungs. |
| 82–86 | The 546-test and route-count lines "update themselves when it merges" | They did not. 76 test files confirmed on this branch; the root `README.md` already carries 76 files / 814 tests. |
| 106 | "`npm run verify` (typecheck, lint, 578 tests)" | Stale third count, in a third place. |
| 553–556 | The Prettier argument rests on PR #10 being a long-lived open branch | That branch is merged, so the conflict argument no longer holds. The conclusion may still stand, but it needs a current reason. |

### Owner column added

The Done and Outstanding tables gain an owner tag alongside the existing lane. Retagged per the
credentials rule, the Outstanding table becomes:

| # | Item | Owner |
|---|---|---|
| 1 | Add `APP_URL` and `CRON_SECRET` as Actions secrets | **[NOAH]** |
| 2 | Dispatch both cron jobs by hand, confirm 200 | **[NOAH]** |
| 3 | Uncomment `schedule:`, add the empty-secret guard | [CLOUD] |
| 4 | Ledger-funnel guard test | [CLOUD] |
| 5 | `session-start` hook | [LOCAL] |
| 6 | `.nvmrc` | [CLOUD] |
| 7 | CI: `build`, `concurrency`, `timeout-minutes` | [CLOUD] |
| 8 | Dependabot config | [CLOUD] to write · [MANUAL] to merge its PRs |
| 9 | `.env.test` note in the README | [CLOUD] |
| 10 | `db-migration` skill | [CLOUD] |
| 11 | The human test pass | **[MANUAL]** |

### Cross-reference to the roadmap

A short pointer from repo-health's status section to the roadmap's master table, and back, so
neither document has to restate the other's state.

---

## 4. `docs/README.md` — the working set

Two changes.

**The document table gains groupings** — Active, Reference, Archive — so the table itself says
what is live. Active: roadmap, repo-health, both audits, the repo-health plan. Reference: the
six specs and `decisions.md`. Archive: the five finished plans.

**The existing "What is left" section becomes the cross-cutting view** — one table listing every
open item drawn from both source documents, each with its phase and owner tag, linking into the
detail. This is the single place that answers "what can I pick up today" and "what is waiting on
Noah," and it is the reason no new tracker document is needed.

The convention list at the bottom gains one line: **completed roadmap items live in the master
table with their reference links, not as body sections.**

**This design and its plan must themselves be listed.** `docs/README.md` already states that "a
spec, plan, or audit that exists but is not listed is invisible — 7a's three were, until 7b's
session noticed." So the table gains rows for this spec and for the implementation plan that
follows it, under Active. Missing this would reproduce exactly the failure the convention was
written to prevent.

---

## 5. The archive

`git mv` five finished plans to `docs/archive/plans/`:

| Plan | Lines |
|---|---|
| `2026-08-17-social-layer-implementation-plan.md` | 5,038 |
| `2026-08-17-custom-events-implementation-plan.md` | 6,431 |
| `2026-08-19-peer-to-peer-bets-implementation-plan.md` | 7,235 |
| `2026-08-22-ui-foundations-implementation-plan.md` | 1,414 |
| `2026-08-24-design-system-implementation-plan.md` | 2,286 |

`2026-08-20-repo-health-implementation-plan.md` **stays in `docs/plans/`** — it is the only plan
with open tasks.

Specs stay where they are: they describe what the system *is*, and the master table's Reference
column links them constantly. Both audits stay: they carry live 7c/7d findings.

`git mv` rather than delete — the plans are the record of how each subsystem was built, and git
history is a poor interface for that.

### Inbound links to fix

Verified 2026-09-02, six references across two files:

- `docs/README.md` lines 12, 14, 16, 18, 21 — one per archived plan
- `docs/roadmap.md` lines 251, 252, 285 — the 7a and 7b rung rows and the 7b prose link

The roadmap references are largely moot, since those rows collapse into the master table's
Reference column, which will point at the new `archive/plans/` paths.

A seventh match exists at `docs/plans/2026-08-24-design-system-implementation-plan.md:2222`, but
it is inside a file being archived and is quoting the roadmap rather than linking it. Leave it.

**Result: browsable documentation drops from 28,751 lines to roughly 6,300.**

---

## 6. Verification

No source code changes, so no test impact. Three checks:

1. **The link checker.** `docs/plans/2026-08-20-repo-health-implementation-plan.md` Task 7
   Step 3 carries a Python script that validates every relative link and anchor across
   `README.md`, `docs/README.md`, `docs/roadmap.md`, and `docs/repo-health.md`. Extend its file
   list to cover the archive paths and run it. **Expected: `LINKS OK`.**
2. **Line counts**, confirming the reductions above rather than assuming them.
3. **`git status`** before committing, confirming the five plans show as renames (`R`) rather
   than as a delete plus an add — a rename keeps their history navigable.

`npm run verify` is not run: no code changes, and it needs a database this session cannot reach.
CI runs it on the pull request.

---

## 7. Deliberately not in this design

- **A new `docs/status.md` tracker.** Considered and rejected: it is a third place to update,
  and this repo already rejected a GitHub Projects board for exactly that drift reason.
  `docs/README.md`'s "What is left" section does the job without adding a document.
- **Archiving the specs.** They are reference material, not history, and the roadmap leans on
  them harder now that completed items have no body prose.
- **Archiving the audits.** Both carry live findings assigned to 7c and 7d.
- **Deleting anything.** Everything moves; nothing is removed from the repository.
- **Re-litigating the Prettier decision.** The refresh notes that its stated reason expired
  with PR #10's merge, and leaves the conclusion alone. That is a separate call.
- **Acting on any roadmap or repo-health item.** This design changes how the work is described
  and tracked, not the work itself. The cron secrets stay unfixed, the guard test stays
  unwritten.
