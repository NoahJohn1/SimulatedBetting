# Docs Status Tracking and Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docs/roadmap.md` and `docs/repo-health.md` answer "what is done, what is left, and who can do it" at a glance, and cut browsable documentation from 28,751 lines to roughly 6,300 by archiving five finished implementation plans.

**Architecture:** Five sequential tasks, each ending in a commit whose link checker passes. The archive move comes first so that every later document can reference the new paths without a broken-link window. No source code changes anywhere — this is documentation only.

**Tech Stack:** Markdown, `git mv`, a Python 3 link-and-anchor checker.

## Global Constraints

Copied verbatim from [the design](../specs/2026-09-02-docs-status-and-archive-design.md):

- **Four owner tags, credentials draw the line.** `[CLOUD]` = a Claude Code web session finishes it, needs no database and no secrets. `[LOCAL]` = needs Docker/Postgres on a desktop. `[MANUAL]` = human hands, either person, no special account. `[NOAH]` = an account or permission only Noah holds — GitHub repo settings, the Vercel dashboard, DNS, paid signups.
- **An item may carry more than one tag** when its parts sit in different lanes. Where that happens the task table says which part is which.
- **The roadmap records what is in the repository, not what is on somebody's laptop.** Where a status cannot be verified from the repo, say so and date the observation.
- **Status vocabulary is exactly three values:** ✅ Complete, 🔄 In progress, 🔲 Backlog.
- **Nothing is deleted from the repository.** Plans move via `git mv`; only roadmap _prose_ about completed work is removed, and only because its spec and `decisions.md` already carry it.
- **Every document must be listed in `docs/README.md`.** A spec, plan, or audit that exists but is not listed is invisible.
- **No source files change.** If any step would edit something outside `docs/` or the root `README.md`, stop — it is out of scope.

## The link checker

Every task ends by running this. It is the repo's existing checker from the repo-health plan, with `docs/archive/` added to the file list. **Save it once at the start** to `/tmp/claude-0/-home-user-SimulatedBetting/1eaf57c7-5dc0-5725-910f-b21d1385e56d/scratchpad/linkcheck.py` and re-run it by path in later tasks.

```python
import re, os
def slug(t):
    t=re.sub(r'[`*_\[\]()]','',t.strip().lower())
    return re.sub(r'[^\w\s-]','',t,flags=re.UNICODE).replace(' ','-')
def anchors(p):
    return {slug(m.group(2)) for m in (re.match(r'^(#{1,6})\s+(.*)$',l) for l in open(p)) if m}
bad=[]
targets=[('docs/repo-health.md','docs'),('docs/README.md','docs'),('README.md','.'),('docs/roadmap.md','docs')]
for root,_,files in os.walk('docs/archive'):
    for f in files:
        if f.endswith('.md'): targets.append((os.path.join(root,f), root))
for f,base in targets:
    if not os.path.exists(f): continue
    for m in re.finditer(r'\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)', open(f).read()):
        link=m.group(1).strip('<>')
        if link.startswith('http'): continue
        tgt,_,anc=link.partition('#')
        p=os.path.normpath(os.path.join(base,tgt)) if tgt else f
        if tgt and not os.path.exists(p.split(':')[0]): bad.append(f'{f}: missing {link}'); continue
        if anc and p.endswith('.md') and anc not in anchors(p): bad.append(f'{f}: bad anchor {link}')
print('\n'.join(bad) if bad else 'LINKS OK')
```

**Expected on every run: `LINKS OK`.**

Archived plans are checked too, but they were written against the old layout and may carry
links that were already stale before this work. If the checker reports a failure _inside_
`docs/archive/`, note it and leave it — an archived document is a historical record, and
rewriting its links falsifies it. Only failures in the four live documents block a commit.

---

## Task 1: Archive the five finished plans

Moves the plans whose work has shipped and repoints every inbound link, so no later task has to work around a broken path.

**Files:**

- Move: `docs/plans/2026-08-17-social-layer-implementation-plan.md` → `docs/archive/plans/`
- Move: `docs/plans/2026-08-17-custom-events-implementation-plan.md` → `docs/archive/plans/`
- Move: `docs/plans/2026-08-19-peer-to-peer-bets-implementation-plan.md` → `docs/archive/plans/`
- Move: `docs/plans/2026-08-22-ui-foundations-implementation-plan.md` → `docs/archive/plans/`
- Move: `docs/plans/2026-08-24-design-system-implementation-plan.md` → `docs/archive/plans/`
- Modify: `docs/README.md` lines 12, 14, 16, 18, 21
- Modify: `docs/roadmap.md` lines 251, 252, 285

**Do NOT move** `docs/plans/2026-08-20-repo-health-implementation-plan.md` — it is the only plan with open tasks.

**Interfaces:**

- Produces: the path prefix `archive/plans/` (relative to `docs/`), which Task 2's master table and Task 4's README table both reference.

- [ ] **Step 1: Save the link checker**

Write the Python block from "The link checker" above to `/tmp/claude-0/-home-user-SimulatedBetting/1eaf57c7-5dc0-5725-910f-b21d1385e56d/scratchpad/linkcheck.py`.

- [ ] **Step 2: Record the starting line count**

```bash
wc -l $(find docs -name "*.md") | tail -1
```

Expected: `28751 total` (plus the new spec and this plan, so roughly `29300`).

- [ ] **Step 3: Create the archive directory and move the five plans**

```bash
mkdir -p docs/archive/plans
git mv docs/plans/2026-08-17-social-layer-implementation-plan.md docs/archive/plans/
git mv docs/plans/2026-08-17-custom-events-implementation-plan.md docs/archive/plans/
git mv docs/plans/2026-08-19-peer-to-peer-bets-implementation-plan.md docs/archive/plans/
git mv docs/plans/2026-08-22-ui-foundations-implementation-plan.md docs/archive/plans/
git mv docs/plans/2026-08-24-design-system-implementation-plan.md docs/archive/plans/
```

- [ ] **Step 4: Confirm git sees renames, not delete-plus-add**

```bash
git status --short
```

Expected: five lines beginning with `R ` (rename). If any show as `D ` plus `?? `, the history link is lost — `git add -A docs/` and re-check; git detects renames by content similarity at commit time.

- [ ] **Step 5: Verify only the repo-health plan remains in docs/plans/**

```bash
ls docs/plans/
```

Expected: exactly two files — `2026-08-20-repo-health-implementation-plan.md` and `2026-09-02-docs-status-and-archive-implementation-plan.md`.

- [ ] **Step 6: Repoint the five links in `docs/README.md`**

Change `plans/` to `archive/plans/` on lines 12, 14, 16, 18, and 21 only. Leave line 24's repo-health plan link alone.

```bash
sed -i \
  -e 's|(plans/2026-08-17-social-layer-implementation-plan.md)|(archive/plans/2026-08-17-social-layer-implementation-plan.md)|' \
  -e 's|(plans/2026-08-17-custom-events-implementation-plan.md)|(archive/plans/2026-08-17-custom-events-implementation-plan.md)|' \
  -e 's|(plans/2026-08-19-peer-to-peer-bets-implementation-plan.md)|(archive/plans/2026-08-19-peer-to-peer-bets-implementation-plan.md)|' \
  -e 's|(plans/2026-08-22-ui-foundations-implementation-plan.md)|(archive/plans/2026-08-22-ui-foundations-implementation-plan.md)|' \
  -e 's|(plans/2026-08-24-design-system-implementation-plan.md)|(archive/plans/2026-08-24-design-system-implementation-plan.md)|' \
  docs/README.md
```

- [ ] **Step 7: Repoint the three links in `docs/roadmap.md`**

These sit in the 7a and 7b rung rows and 7b's prose. Task 2 deletes those sections entirely, but they must resolve in the meantime so this task's commit is clean.

```bash
sed -i \
  -e 's|(plans/2026-08-22-ui-foundations-implementation-plan.md)|(archive/plans/2026-08-22-ui-foundations-implementation-plan.md)|g' \
  -e 's|(plans/2026-08-24-design-system-implementation-plan.md)|(archive/plans/2026-08-24-design-system-implementation-plan.md)|g' \
  docs/roadmap.md
```

- [ ] **Step 8: Confirm no stale `plans/` link to an archived file survives**

```bash
grep -rn "plans/2026-08-1[79]\|plans/2026-08-2[24]" docs/README.md docs/roadmap.md docs/repo-health.md README.md | grep -v "archive/plans/"
```

Expected: **no output.** Any line printed is a link still pointing at a moved file.

- [ ] **Step 9: Run the link checker**

```bash
python3 /tmp/claude-0/-home-user-SimulatedBetting/1eaf57c7-5dc0-5725-910f-b21d1385e56d/scratchpad/linkcheck.py
```

Expected: `LINKS OK`, or failures only on paths beginning `docs/archive/` — see the note under "The link checker".

- [ ] **Step 10: Commit**

```bash
git add -A docs/
git commit -m "docs: archive the five finished implementation plans

Social layer, custom events, peer-to-peer, 7a and 7b all shipped, and
their plans are 22,404 of the 28,751 lines in docs/ — 78% of the
documentation describing work nobody needs to plan again.

Moved rather than deleted: they are the record of how each subsystem was
built, and git history is a poor interface for that. The repo-health plan
stays in docs/plans/ since it still has open tasks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SWxR2wGjtW5sV7xvW2SE2s"
```

---

## Task 2: Restructure `docs/roadmap.md`

Replaces the two topic tables with one master status table, and deletes the body prose for every completed item.

**Files:**

- Modify: `docs/roadmap.md` — replace lines 1–20 (header and part-one table), delete lines 21–136 (subsystems 1–4 and Sequencing), delete the 7a and 7b rung sections, add task tables to phases 5, 6, 7c, 7d, 8, 9

**Interfaces:**

- Consumes: `archive/plans/` paths from Task 1.
- Produces: the anchors `#5--real-data-the-espn-adapter`, `#6--production-deployment`, `#7c--screen-by-screen-rebuild`, `#7d--craft`, `#8--email-notifications`, `#9--hardening`, which Task 4's working-set table links to. Section headings for those phases must not change.

- [ ] **Step 1: Replace the header and part-one table**

Replace everything from line 1 through line 19 (the `---` closing the part-one section) with:

```markdown
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
| 5   | [Real data: the ESPN adapter](#5--real-data-the-espn-adapter) | 🔄 In progress — Noah, local only  | [CLOUD] [NOAH]           | spec pending                                                                                                                                               |
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

**Phase 5 is not verifiable from here.** As of 2026-09-02 there is no `espn` reference anywhere
in `src/`, and `origin` carries only `main` and the current working branch, so Noah's adapter
work exists only on his machine. This table will say "in progress" until something is pushed.

---
```

- [ ] **Step 2: Delete the completed part-one sections**

Delete from the line `## 1. Core betting engine` through the line immediately before `# Part two — production readiness`. That removes subsystems 1–4 and the part-one "Sequencing" section — roughly 116 lines, all of it prose about shipped work whose spec is now linked from the master table.

- [ ] **Step 3: Verify the deletion landed on the right boundaries**

```bash
grep -n "^#\|^## \|^### " docs/roadmap.md | head -12
```

Expected: `# Roadmap`, then `# Part two — production readiness`, then `## 5 — Real data: the ESPN adapter`. No `## 1.` through `## 4.` and no `## Sequencing`.

- [ ] **Step 4: Delete the phase-7 rung status table and the 7a/7b sections**

In the `## 7 — The UI ladder` section, delete the four-row rung table (it duplicates the master table). Then delete the entire `### 7a — Foundations` and `### 7b — Design system` sections, stopping immediately before `### 7c — Screen-by-screen rebuild`.

**Keep the ladder's opening prose** — "Four rungs, ordered so the app is shippable after each one" — and keep the sentence about each rung's inherited backlog being the record of what an earlier rung declined.

**Keep both inherited-backlog tables** (`#### What 7c inherits` and `#### What 7d inherits`) in full. They are forward-looking work, and they are what keeps the audits' live findings visible now that the audits are referenced from ✅ rows.

- [ ] **Step 5: Add the phase 5 task table**

Immediately after the numbered task list in `## 5 — Real data: the ESPN adapter`, insert:

```markdown
| Task                                                  | Status         | Owner                                          |
| ----------------------------------------------------- | -------------- | ---------------------------------------------- |
| Spike the payload — NFL and CFB, both endpoints       | 🔄 Noah, local | [CLOUD]                                        |
| `EspnScoreProvider`                                   | 🔲 Backlog     | [CLOUD]                                        |
| `EspnOddsProvider`                                    | 🔲 Backlog     | [CLOUD]                                        |
| CFB paging by week and conference group               | 🔲 Backlog     | [CLOUD]                                        |
| Defensive parsing — a reshaped field skips its market | 🔲 Backlog     | [CLOUD]                                        |
| Kill switch env flag falling back to fixtures         | 🔲 Backlog     | [CLOUD] to write · **[NOAH]** to set in Vercel |
| First real slate — admin backfill plus reconciliation | 🔲 Backlog     | **[NOAH]** — runs against production           |
```

- [ ] **Step 6: Add the phase 6 task table and correct its status**

After the task bullets in `## 6 — Production deployment`, insert:

```markdown
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
```

- [ ] **Step 7: Add an Owner column to the 7c and 7d inherited-backlog tables**

Both tables currently have `| Item | Deferred by | Why it landed here |`. Add a fourth column, `Owner`, with `[CLOUD]` for every row — all of it is code and copy a web session can write, verified by CI.

- [ ] **Step 8: Add the phase 8 task table**

After the "The tasks." paragraph in `## 8 — Email notifications`, insert:

```markdown
| Task                                                       | Status     | Owner                                                    |
| ---------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| Transactional email provider on a free tier                | 🔲 Backlog | **[NOAH]** — signup, API key, DNS for the sending domain |
| `notification_preferences` table and migration             | 🔲 Backlog | [CLOUD]                                                  |
| Per-type toggles plus a global off                         | 🔲 Backlog | [CLOUD]                                                  |
| One-click unsubscribe that works without signing in        | 🔲 Backlog | [CLOUD]                                                  |
| Dev mode that logs instead of sending                      | 🔲 Backlog | [CLOUD]                                                  |
| Idempotency-keyed sends from the `feed_events` emit points | 🔲 Backlog | [CLOUD]                                                  |
| Confirm a real email renders correctly in an inbox         | 🔲 Backlog | **[MANUAL]**                                             |
```

- [ ] **Step 9: Add the phase 9 task table**

After the bullets in `## 9 — Hardening`, insert:

```markdown
| Task                                                                  | Status     | Owner                                                                          |
| --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| A written smoke checklist                                             | 🔲 Backlog | [CLOUD] to draft · **[MANUAL]** to validate — it is derived from the test pass |
| Rate limiting on mutations                                            | 🔲 Backlog | [CLOUD]                                                                        |
| Load sanity — a full CFB Saturday and a season of feed events         | 🔲 Backlog | **[LOCAL]** — needs real row counts, so it needs a database                    |
| A house rules page                                                    | 🔲 Backlog | [CLOUD]                                                                        |
| The new-member path — `/pending`, `/join`, `/no-season` as a sequence | 🔲 Backlog | [CLOUD]                                                                        |
```

Phase 9's opening line currently says it "Wants 7a finished first." Update it: 7a and 7b are both complete and merged, so phase 9 is unblocked.

- [ ] **Step 10: Check the line count and the anchors**

```bash
wc -l docs/roadmap.md
grep -n "^#\|^## \|^### \|^#### " docs/roadmap.md
```

Expected: roughly 200 lines, down from 466. The heading list must still contain `## 5 — Real data: the ESPN adapter`, `## 6 — Production deployment`, `### 7c — Screen-by-screen rebuild`, `### 7d — Craft`, `## 8 — Email notifications`, `## 9 — Hardening`, `#### What 7c inherits`, `#### What 7d inherits`, and `## What is deliberately not on this roadmap`.

- [ ] **Step 11: Run the link checker**

```bash
python3 /tmp/claude-0/-home-user-SimulatedBetting/1eaf57c7-5dc0-5725-910f-b21d1385e56d/scratchpad/linkcheck.py
```

Expected: `LINKS OK` (archive-internal failures excepted).

- [ ] **Step 12: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs: one status table for the roadmap, no prose for finished work

Adds a master table covering every item old and current, with a status, an
owner tag, and the spec/plan/audit links that let a completed item drop its
body section entirely. Subsystems 1-4 and rungs 7a/7b lose ~200 lines of
description that decisions.md and their specs already carry better.

Phases 5, 6, 8 and 9 gain task-level tables so the phase tag decomposes
into per-task owners. Phase 6's status is corrected against the repo: it is
deployed but has no monitoring, no health page, no season-creation screen
and no drift alerting.

Records that phase 5 cannot be verified from here — no espn reference in
src/ and nothing pushed beyond main as of today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SWxR2wGjtW5sV7xvW2SE2s"
```

---

## Task 3: Refresh `docs/repo-health.md`

Corrects four stale claims and adds the owner column. The document's structure is sound and stays.

**Files:**

- Modify: `docs/repo-health.md` — the lane table (~lines 18–33), the Outstanding table (~lines 47–63), the "What changed underneath" section (~lines 65–99), line 106, and the Prettier paragraph (~lines 552–556)

**Interfaces:**

- Consumes: the tag definitions from Global Constraints.
- Produces: the anchor `#status-at-a-glance`, which Task 2's roadmap header and Task 4's working-set table both link to.

- [ ] **Step 1: Drop the date from the "Status at a glance" heading**

The heading is currently `## Status at a glance (2026-08-25)`, which GitHub slugs as
`#status-at-a-glance-2026-08-25` — a moving anchor that breaks every inbound link each time the
date is refreshed. Change it to:

```markdown
## Status at a glance
```

and put the date in the body instead, as the first line under it:

```markdown
_Last verified 2026-09-02._
```

This is what makes `#status-at-a-glance` a stable anchor for Tasks 2 and 4 to link to.

- [ ] **Step 2: Add `[NOAH]` to the lane table**

The table under "Status at a glance" defines three lanes. Add a fourth row and rewrite the `[MANUAL]` row so the split is explicit:

```markdown
| **[MANUAL]** | Either of you, by hand | Clicking, reading, judging. No special account needed. |
| **[NOAH]** | Noah specifically | An account or permission only he holds: GitHub repo settings, the Vercel dashboard, DNS, paid signups. No agent has these credentials, and none should. |
```

Update the sentence introducing the table to say four lanes, not three, and note that `[NOAH]` splits what was previously all filed under `[MANUAL]`.

- [ ] **Step 3: Retag the Outstanding table**

Rename its `Lane` column to `Owner` and set every row per the credentials rule:

| #   | Item                                                        | Owner                                            |
| --- | ----------------------------------------------------------- | ------------------------------------------------ |
| 1   | Add `APP_URL` and `CRON_SECRET` as Actions secrets          | **[NOAH]**                                       |
| 2   | Dispatch both cron jobs by hand and confirm 200             | **[NOAH]**                                       |
| 3   | Uncomment the `schedule:` block, add the empty-secret guard | [CLOUD]                                          |
| 4   | Ledger-funnel guard test                                    | [CLOUD]                                          |
| 5   | `session-start` hook                                        | **[LOCAL]**                                      |
| 6   | `.nvmrc`                                                    | [CLOUD]                                          |
| 7   | CI: `build` step, `concurrency`, `timeout-minutes`          | [CLOUD]                                          |
| 8   | Dependabot, monthly, grouped                                | [CLOUD] to write · **[MANUAL]** to merge its PRs |
| 9   | `.env.test` note in the README                              | [CLOUD]                                          |
| 10  | `db-migration` skill                                        | [CLOUD]                                          |
| 11  | The human test pass, and the issues it produces             | **[MANUAL]**                                     |

Do the same for the Done table's lane column — rows 1 and 2 there were GitHub settings work, so they become `[NOAH]`.

- [ ] **Step 4: Correct the merged-PR claim**

Replace the whole "**`main` is not where the current UI work lives**" bullet — every line of it, through the D51 sentence — with:

```markdown
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
```

**Verify the D51 anchor before committing** — the entry was on the PR branch when this bullet was first written and should be on `main` now:

```bash
grep -n '^### D51' docs/decisions.md
```

If it returns nothing, D51 never landed: drop the final sentence rather than linking a decision that does not exist.

- [ ] **Step 5: Fix the three divergent test counts**

The repo currently states three different numbers in three places. The true count is **76 test files**, confirmed by:

```bash
find src -name "*.test.ts" -o -name "*.test.tsx" | wc -l
```

Expected: `76`. The root `README.md` already says "76 test files / 814 tests" and is correct. Update:

- Line ~82, the "546 tests" reference inside the superseded bullet — remove with the bullet in Step 3
- Line ~106, "`npm run verify` (typecheck, lint, 578 tests)" → 814 tests across 76 files
- Line ~524, "74 test files against 25k lines" in the coverage-thresholds bullet → 76 test files

- [ ] **Step 6: Note that the Prettier reasoning expired**

The closing Prettier paragraph argues against adopting it because a reformat commit would conflict with the long-lived PR #10 branch. That branch is merged. Update the paragraph to say the stated reason has expired and the decision is now open rather than settled — do **not** re-decide it here; that is a separate call.

- [ ] **Step 7: Add the cross-reference to the roadmap**

Under "Status at a glance", add one line pointing at the roadmap's master table for product phases, so neither document restates the other's state:

```markdown
This document covers repo mechanics. For the product phases — the ESPN adapter, deployment, the
UI ladder, email, hardening — see [the roadmap's status table](roadmap.md#roadmap).
```

- [ ] **Step 8: Confirm no stale count survives**

```bash
grep -n "546\|547\|578\|74 test" docs/repo-health.md
```

Expected: **no output.**

- [ ] **Step 9: Run the link checker**

```bash
python3 /tmp/claude-0/-home-user-SimulatedBetting/1eaf57c7-5dc0-5725-910f-b21d1385e56d/scratchpad/linkcheck.py
```

Expected: `LINKS OK` (archive-internal failures excepted).

- [ ] **Step 10: Commit**

```bash
git add docs/repo-health.md
git commit -m "docs: refresh repo-health status and split the manual lane

PR #10 merged, so 'main is not where the current UI work lives' is wrong
and the test counts it promised would update themselves did not. The repo
stated three different totals in three places; the real number is 76 test
files, which the root README already had right.

Splits the [MANUAL] lane into [MANUAL] and [NOAH] on the credentials line,
so the outstanding list now says which items are waiting on someone with
GitHub and Vercel access rather than just 'a human'.

Notes that the Prettier argument's stated reason expired with that merge,
without re-deciding it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SWxR2wGjtW5sV7xvW2SE2s"
```

---

## Task 4: Turn `docs/README.md` into the working set

Makes the index answer "what can I pick up today" without opening either source document.

**Files:**

- Modify: `docs/README.md` — the document table (lines ~7–25), the "What is left" section, the conventions list

**Interfaces:**

- Consumes: the archive paths from Task 1 and the phase anchors from Task 2.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Group the document table**

Split the single table into three, under `### Active`, `### Reference`, and `### Archive` headings.

**Active:** roadmap, repo-health, both audits, the repo-health plan, this plan, and the docs-status spec.
**Reference:** the six specs and `decisions.md`.
**Archive:** the five moved plans, each with a one-line note that its work shipped.

- [ ] **Step 2: Add the new spec and plan as rows**

`docs/README.md` states that "a spec, plan, or audit that exists but is not listed is invisible — 7a's three were, until 7b's session noticed." Add, under Active:

```markdown
| [Docs status and archive spec](specs/2026-09-02-docs-status-and-archive-design.md) | The owner taxonomy, the roadmap's master table, and what moved to the archive |
| [Docs status and archive plan](plans/2026-09-02-docs-status-and-archive-implementation-plan.md) | The task-by-task plan for that restructure |
```

- [ ] **Step 3: Replace "What is left" with the cross-cutting table**

The section currently lists phases 1–5 in prose. Replace its body with one table drawing every open item from both source documents, so this is the single place that answers what to pick up:

```markdown
Every open item from [the roadmap](roadmap.md#roadmap) and
[repo health](repo-health.md#status-at-a-glance), by who can finish it.

### What a cloud session can pick up now

| Item                                                                                   | Source        |
| -------------------------------------------------------------------------------------- | ------------- |
| Uncomment the cron `schedule:`, add the empty-secret guard                             | repo health 3 |
| Ledger-funnel guard test                                                               | repo health 4 |
| `.nvmrc`                                                                               | repo health 6 |
| CI: `build`, `concurrency`, `timeout-minutes`                                          | repo health 7 |
| Dependabot config                                                                      | repo health 8 |
| `.env.test` note in the README                                                         | repo health 9 |
| 7c component work — `Dialog`, `Sheet`, `Table`, `Toast`, `Card`'s element escape hatch | roadmap 7c    |
| 7c layout fixes from the mobile audit                                                  | roadmap 7c    |
| Rate limiting, house rules page, the new-member path                                   | roadmap 9     |

### What needs a desktop with Docker

| Item                                                           | Source        |
| -------------------------------------------------------------- | ------------- |
| `session-start` hook — only a laptop can prove the Docker path | repo health 5 |
| Load sanity at real row counts                                 | roadmap 9     |

### What needs Noah

| Item                                                                                               | Source        |
| -------------------------------------------------------------------------------------------------- | ------------- |
| `APP_URL` and `CRON_SECRET` as Actions secrets — **the app is not settling bets until this lands** | repo health 1 |
| Dispatch both cron jobs by hand, confirm 200                                                       | repo health 2 |
| Hosted Postgres, Sentry signup, alerting destination                                               | roadmap 6     |
| Email provider signup and sending-domain DNS                                                       | roadmap 8     |

### What needs a person, either of you

| Item                                          | Source        |
| --------------------------------------------- | ------------- |
| **The human test pass** — the gate on phase 5 | both          |
| Merging Dependabot PRs                        | repo health 8 |
| Confirming a real email renders               | roadmap 8     |
```

- [ ] **Step 4: Add the convention line**

Append to the conventions list at the bottom:

```markdown
- **Completed roadmap items live in the master table with their reference links, not as body
  sections.** The spec is the authority on what a subsystem does and `decisions.md` on why; a
  third summary in the roadmap only drifts from both.
- **A plan whose work has shipped moves to `archive/plans/`.** It stays listed here so it does
  not become invisible.
```

- [ ] **Step 5: Verify every doc on disk appears in the index**

```bash
for f in $(find docs -name "*.md" ! -name "README.md" | sed 's|^docs/||'); do
  grep -q "$(basename $f)" docs/README.md || echo "UNLISTED: $f"
done
```

Expected: **no output.** Any line printed is a document the index does not mention, which is the exact failure the convention warns about.

- [ ] **Step 6: Run the link checker**

```bash
python3 /tmp/claude-0/-home-user-SimulatedBetting/1eaf57c7-5dc0-5725-910f-b21d1385e56d/scratchpad/linkcheck.py
```

Expected: `LINKS OK` (archive-internal failures excepted).

- [ ] **Step 7: Commit**

```bash
git add docs/README.md
git commit -m "docs: make the index the working set

Groups the document table into Active, Reference and Archive so the table
itself says what is live, and replaces the prose 'what is left' section
with one table of every open item sorted by who can finish it: a cloud
session, a desktop with Docker, Noah, or either person by hand.

This is the view that was missing — two people working from different
places with no single answer to 'what can I pick up now.'

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SWxR2wGjtW5sV7xvW2SE2s"
```

---

## Task 5: Cross-document consistency pass

The four content tasks each verified themselves in isolation. This one checks they agree with each other and with the repo.

**Files:**

- Modify: any of the four documents, only if this pass finds a contradiction

**Interfaces:**

- Consumes: everything.

- [ ] **Step 1: Confirm the line-count reductions**

```bash
wc -l docs/roadmap.md docs/repo-health.md docs/README.md
find docs -name "*.md" ! -path "docs/archive/*" | xargs wc -l | tail -1
```

Expected: roadmap roughly 200 (from 466); the non-archive total roughly 6,300 (from 28,751). If the total is far off, a file did not move.

- [ ] **Step 2: Confirm no status claim contradicts another**

Read the roadmap master table and the repo-health Done/Outstanding tables side by side. Every item appearing in both must carry the same status and the same owner tag. The cron work is the one that appears in both — the roadmap's phase 6 `CRON_SECRET` row and repo-health outstanding items 1 and 2 must agree that it is **[NOAH]** and not done.

- [ ] **Step 3: Confirm every owner tag is defensible**

For each `[CLOUD]` tag, the item must need no database and no secrets. For each `[NOAH]`, name the specific credential. For each `[LOCAL]`, name what needs Postgres. If any tag cannot be justified in one sentence, it is wrong — fix it.

- [ ] **Step 4: Confirm no source file was touched**

```bash
git diff --stat main...HEAD -- . ':!docs' ':!README.md'
```

Expected: **no output.** This work is documentation only; anything else in the diff is out of scope and must be reverted.

- [ ] **Step 5: Final link check**

```bash
python3 /tmp/claude-0/-home-user-SimulatedBetting/1eaf57c7-5dc0-5725-910f-b21d1385e56d/scratchpad/linkcheck.py
```

Expected: `LINKS OK` (archive-internal failures excepted, and noted in the commit body if any).

- [ ] **Step 6: Commit any fixes and push**

```bash
git add -A docs/ README.md
git commit -m "docs: reconcile status claims across the four documents"   # skip if nothing changed
git push -u origin claude/roadmap-repo-health-tasks-wxcrxf
```

If the push fails on a network error, retry up to four times with exponential backoff — 2s, 4s, 8s, 16s.

---

## Deliberately not in this plan

- **A new `docs/status.md`.** A third place to update, and this repo already rejected a Projects board for that drift reason.
- **Archiving the specs or the audits.** Specs are reference material the roadmap now leans on harder; both audits carry live 7c/7d findings.
- **Acting on any roadmap or repo-health item.** The cron secrets stay unfixed and the guard test stays unwritten — this plan changes how work is described, not the work.
- **Re-deciding Prettier.** Task 3 notes its reason expired and leaves the conclusion alone.
- **Running `npm run verify`.** No code changes, and it needs a database this session cannot reach. CI runs it on the pull request.
