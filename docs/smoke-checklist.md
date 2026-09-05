# Smoke checklist

> **Draft. Written from the code, not from a completed pass.** No person has yet clicked through
> placing a parlay, disputing an event, or arbitrating a wager. Every step below is derived from
> reading the implementation, which means it can be wrong in the two ways reading is always wrong:
> a step that cannot be performed as written, and a step nobody thought to write. **The first
> [MANUAL] run's job is to correct this document**, and its findings are worth more than its
> pass/fail result.

## A — Before you start

Confirm which environment is being checked and which database it points at before running
anything below. Repeat the warning from
[repo-health 3.7](repo-health.md#37-postgres-without-docker-in-a-cloud-session): any script that
loads env with plain `dotenv` and no `override: true` is one ambient container variable away from
targeting the production database instead of the one you think you're pointed at. Check the
resolved `DATABASE_URL` before running a migration or a destructive command, not after.

Two Google accounts are needed for the parts of section C involving a second member (disputing an
event, offering and accepting a wager). Confirm both are available before starting section C —
stopping partway through because the second account isn't at hand is worse than confirming first.

## B — The machine half

- [ ] `npm ci`
- [ ] `npm run verify`
- [ ] `npm run build`
- [ ] Each of the five cron routes returns 200 when dispatched by hand (`/api/cron/settle`,
      `/api/cron/reconcile`, `/api/cron/allowance`, `/api/cron/sync-odds`, `/api/cron/notify`)
- [ ] `/admin/health` reports every job fresh
- [ ] `reconcile` reports no balance drift and no escrow drift

Anyone can run this, including a cloud session — nothing here needs a second account or a browser.

## C — The hands half

One continuous path, in the order a real member meets it. Each step names its expected result.

1. Sign in with a Google account that has never signed in before. Expect `/pending`, "Step 1 of 2".
2. From an admin account, approve it on `/admin`. Expect it to leave the "Waiting for approval"
   queue.
3. Return to the first account and reload. Expect `/join`, "Step 2 of 2", showing the season's
   real starting bankroll, starting credits, and weekly top-ups.
4. Join. Expect `/games` and the header balance matching the starting bankroll.
5. Place a single. Expect the balance to drop by the stake and a feed card to appear.
6. Place a parlay across two games. Expect one bet with combined odds, not two separate bets.
7. Settle a finished game (or run the settle cron by hand). Expect the bet graded and the balance
   moved by the payout.
8. Open `/me`. Expect the ledger to list every entry from the steps above and to sum to the header
   balance.
9. Create a custom event with two outcomes.
10. Bet it from the second account. Expect credits to move, not cash.
11. Resolve it from the creator account.
12. Dispute the resolution from the second account.
13. Correct it as an admin. Expect reversing entries in the ledger, not edited ones.
14. Offer a wager to the second account. Expect your credits to drop at the moment of the offer,
    not at acceptance.
15. Accept it. Claim a winner from one side, then from the other.
16. Arbitrate it as an admin.
17. React to a feed card and comment on it.
18. **Submit a comment eleven times quickly. Expect the eleventh to be refused with a countdown,
    and no eleventh comment to appear in the thread.**
19. Open `/rules` while signed out. Expect it to render, quoting the running season's real
    figures.
20. Visit `/events/does-not-exist`. Expect a not-found screen inside the app shell, not a white
    page.
21. Run `reconcile` once more. Expect no balance or escrow drift after everything above.

## D — The run log

Empty on delivery. Its emptiness is the point — an unvalidated document that looks validated is
worse than one that says plainly it isn't.

| Date | Who | Commit | Result | What broke |
| ---- | --- | ------ | ------ | ---------- |
|      |     |        |        |            |

## E — What this document cannot know yet

- Whether every step above is performable exactly as written, or whether the real screens need a
  step reworded or reordered.
- How long a full pass actually takes.
- Whether a second Google account is reliably available for the parts of section C that need one.
- Everything the pass turns up that nobody thought to write down here.

Findings from a pass are filed as issues under the existing `from-test-pass` label
([repo-health 4](repo-health.md#4-issues-and-milestones)), not folded silently into this document.
