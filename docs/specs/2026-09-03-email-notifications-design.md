# Email notifications — design

_Written 2026-09-03._

**The problem.** [The roadmap](../roadmap.md#8--email-notifications) puts it in one line: an
offer nobody sees expires, and a dispute nobody sees stalls. Subsystems 3 and 4 introduced
states that rot when unobserved, and the app has no way to reach anybody who is not currently
looking at it. Everything else on the notification list is decoration
([D50](../decisions.md#d50--notifications-are-opt-out-email-with-per-type-switches)).

**The goal.** After this work, **six time-sensitive facts reach the person they concern by
email**, every type is individually switchable with one global off, unsubscribing takes one
click and no sign-in, and **a re-run of `settle` sends nothing a second time**.

**Scope.** The five `[CLOUD]` rows of phase 8. Provider signup, the API key and the sending
domain's DNS are `[NOAH]` and appear here only where the design depends on them. Confirming a
real message renders in a real inbox is `[MANUAL]`.

---

## 1. Scope

| #   | Item                                         | Roadmap row                                    | Lane                                 |
| --- | -------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| 1   | `notification_preferences` and the outbox    | `notification_preferences` table and migration | [CLOUD] code · **[NOAH]** prod apply |
| 2   | Keyed enqueue from the emit points           | Idempotency-keyed sends                        | [CLOUD]                              |
| 3   | The delivery pass and `/api/cron/notify`     | (enabler for 1, 2, 5)                          | [CLOUD]                              |
| 4   | `/me/notifications` — toggles and global off | Per-type toggles plus a global off             | [CLOUD]                              |
| 5   | One-click unsubscribe without signing in     | One-click unsubscribe                          | [CLOUD]                              |
| 6   | The console transport                        | Dev mode that logs instead of sending          | [CLOUD]                              |
| —   | Resend account, API key, sending-domain DNS  | Transactional email provider on a free tier    | **[NOAH]**                           |
| —   | A real message rendering in a real inbox     | Confirm a real email renders correctly         | **[MANUAL]**                         |

Item 3 is not a roadmap row of its own. It exists because 1, 2 and 5 all need somewhere for a
queued row to actually become an email, and nothing in this repository sends mail today.

### Measurements this design rests on

Taken 2026-09-03 in the cloud session that wrote this document.

| Claim                                  | Measured                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `emitFeedEvent` call sites             | 22 across 16 modules; every one passes an explicit `dedupeKey`                                               |
| Emit points for the six roadmap events | **Four of six exist.** "Offer expires soon" and "account approved" have none — see §3                        |
| `feed_preferences`                     | Keyed on `user_id`, an array column, no row means nothing muted                                              |
| Approval write today                   | A bare `db.update(users)` inline in [`src/app/admin/page.tsx:37`](../../src/app/admin/page.tsx)              |
| `expirePass` in `p2p/sweep.ts`         | Refunds and closes with an explicit "No feed card: an ignored offer is a non-event"                          |
| Cron schedules                         | `allowance` and `reconcile` native on Vercel; `sync-odds` and `settle` on GitHub Actions, currently disabled |
| Vercel Hobby cron limit                | Daily-or-less only — which is why `settle` had to move to Actions (`.github/workflows/cron.yml`)             |
| `after` from `next/server`             | Stable in Next 16.3.3 (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`)          |
| `npm test` in a cloud session          | **Runs in full: 86 files, 925 tests, exit 0, 76s** — native Postgres from the session-start hook             |
| Decision log                           | Ends at **D62**, so this design's entries are D63–D68                                                        |

**Two corrections fall out of that table.**

The brief that commissioned this work said the decision log was at D56. It is at **D62** —
D57 through D62 landed with the repo-health and phase-6 work.

The brief also said `npm test` cannot run in a cloud session because there is no Postgres and no
Docker daemon. That was true when the phase-6 spec was written and is **no longer true**: the
session-start hook now installs and starts a native Postgres with no container runtime, and the
full suite passes here. See [repo-health 3.7](../repo-health.md#37-postgres-without-docker-in-a-cloud-session).
This design and its plan therefore treat database tests as provable in a cloud session.

---

## 2. Architecture

One new server directory, `src/server/notify/`. Seven small modules, one job each.

| Module                  | Exports                                                                    | Depends on                          |
| ----------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| `notify/enqueue.ts`     | `enqueueNotification(tx, input)`                                           | `db`, `notifications`               |
| `notify/recipients.ts`  | `userIdForMembership`, `adminUserIds`                                      | `db`, `users`, `season_memberships` |
| `notify/preferences.ts` | `getNotificationPreferences`, `setNotificationPreferences`, `isSuppressed` | `db`, `notification_preferences`    |
| `notify/render.ts`      | `renderImmediate`, `renderDigest` → `{subject, text, html, headers}`       | **nothing** — pure                  |
| `notify/transport.ts`   | `sendEmail(message)`                                                       | `fetch`, or `console`               |
| `notify/deliver.ts`     | `deliverPending(now)`                                                      | all of the above                    |
| `notify/unsubscribe.ts` | `signUnsubscribe`, `verifyUnsubscribe`                                     | `node:crypto`                       |

The dependency arrow runs one way. `enqueue` is the only writer, `deliver` is the only sender,
and `render` and `unsubscribe` import nothing from this repository at all — which is what makes
them provable without a database or a network, the same split
[the phase-6 spec](2026-09-02-production-deployment-design.md) made for `alert-policy.ts`.

**`emitFeedEvent` does not call `enqueueNotification`.** The four emit points that have a feed
event call both, side by side, in the same transaction. Chaining them would force every one of
the eighteen feed types to answer "do you notify?", and it would make the notification key
_derived from_ the feed key rather than _equal to it plus a recipient_ — which is the one thing
that has to stay obvious to a reader.

Nothing already in the repository changes shape. Six existing modules gain one `enqueue` call
each, `admin/page.tsx` loses its inline write to a new server module, and `vercel.json` gains
one line.

---

## 3. The six events, and the two that have no emit point

The roadmap's central instruction is to emit from the same points that already emit feed events,
reusing their dedupe key. That works for four of the six. It cannot work for the other two,
because there is nothing there to reuse.

| Event                         | Feed emit point today                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| A wager was offered to you    | `p2p/offer.ts:161` — `P2P_OFFERED` ✅                             |
| **Your offer expires soon**   | **none** — `sweep.ts` `expirePass` deliberately emits no card     |
| A dispute needs your ruling   | `p2p/claim.ts:104`, `p2p/sweep.ts:217`, `events/dispute.ts:91` ✅ |
| **Your account was approved** | **none** — a bare `db.update` inline in `admin/page.tsx:37`       |
| Your bets settled             | `bets/grade-legs.ts:128`, `bets/resettle.ts:310` ✅               |
| The weekly allowance landed   | `seasons/allowance.ts:80` ✅                                      |

The invariant this design adopts is therefore **"every enqueue carries a deterministic key"**,
not "every enqueue rides a feed event" ([D63](../decisions.md#d63--every-send-is-keyed-but-not-every-send-rides-a-feed-event)).
The two orphans get keys derived from the same kind of fact, in the same shape, and one unique
index enforces all six identically.

Adding `P2P_EXPIRING` and `MEMBER_APPROVED` to `feed_event_type` was rejected: it would put two
cards in the season feed that nobody asked for, and `P2P_EXPIRING` in particular would broadcast
to everyone a fact that concerns one person — reversing the deliberate call `expirePass` already
records in a comment.

### Who receives what

| Type                   | Enqueued at                                                     | Recipient                                     | Channel   |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------- | --------- |
| `WAGER_OFFERED`        | `p2p/offer.ts`, beside the existing emit                        | the named opponent — **directed offers only** | IMMEDIATE |
| `OFFER_EXPIRING`       | **new fourth pass** in `p2p/sweep.ts`                           | the offerer, plus the opponent when directed  | IMMEDIATE |
| `DISPUTE_NEEDS_RULING` | `p2p/claim.ts`, `p2p/sweep.ts` overduePass, `events/dispute.ts` | every `role = 'ADMIN'` user                   | IMMEDIATE |
| `ACCOUNT_APPROVED`     | **new** `server/admin/approve.ts`                               | the approved user                             | IMMEDIATE |
| `BETS_SETTLED`         | `bets/grade-legs.ts`, `bets/resettle.ts`                        | the bet's member                              | DIGEST    |
| `ALLOWANCE_PAID`       | `seasons/allowance.ts`, fanned out per membership               | every member of the season                    | DIGEST    |

Four rows there are decisions rather than mechanics.

**An open offer notifies nobody.** `P2P_OFFERED` fires for directed and open offers alike, but
the roadmap row is "a wager was offered to _you_". Mailing the whole season every time somebody
posts an open offer is precisely the noise that gets a notification system muted wholesale.

**"Your offer expires soon" goes to both parties.** Read literally it is the offerer's offer and
the offerer's escrowed credits about to be refunded. But the person who can _prevent_ the expiry
is the opponent, and "an offer nobody sees expires" is the stated reason this phase exists.
Because the recipient is inside the key, two recipients is two rows and costs nothing structurally.

**The expiring sweep cannot rely on a fixed lead time.** It selects
`status = 'OFFERED' AND expires_at > now AND expires_at - now <= 24h`. An offer written with a
two-hour window gets its warning on the first sweep after it is created rather than a day ahead,
which is the best available answer; the key makes that happen once, not once per sweep.

**`ACCOUNT_APPROVED` is unversioned on purpose.** Approve → disable → approve again sends one
email, ever. It is not news the second time. The write moves out of the inline action in
`src/app/admin/page.tsx` into `src/server/admin/approve.ts`, gated on the `PENDING → APPROVED`
transition with `returning()`, because an action that now enqueues inside a transaction does not
belong in a page component and cannot be tested there.

---

## 4. The data model

Three enums and two tables.

```
notification_type      -- one value per roadmap row, six in total
  WAGER_OFFERED | OFFER_EXPIRING | DISPUTE_NEEDS_RULING
  ACCOUNT_APPROVED | BETS_SETTLED | ALLOWANCE_PAID

notification_channel   -- IMMEDIATE | DIGEST
notification_outcome   -- SENT | SUPPRESSED | FAILED

notification_preferences
  user_id         uuid primary key references users(id)
  muted_types     notification_type[] not null default '{}'
  emails_enabled  boolean not null default true
  updated_at      timestamptz not null default now()

notifications                                   -- the outbox
  id          uuid primary key default gen_random_uuid()
  user_id     uuid not null references users(id)
  type        notification_type not null
  channel     notification_channel not null
  dedupe_key  text not null
  payload     jsonb not null
  queued_at   timestamptz not null default now()
  sent_at     timestamptz
  outcome     notification_outcome
  attempts    integer not null default 0
  error       text

  unique index notifications_dedupe_key_idx on (dedupe_key)
  index notifications_pending_idx on (channel, queued_at) where sent_at is null
```

`notification_type` is deliberately **not** `feed_event_type`. The six are not the eighteen, and
sharing the enum would let the preferences screen offer a switch for a notification that does
not exist.

### `notification_preferences` mirrors `feed_preferences`

Keyed on `user_id` rather than membership, so a preference survives into next season instead of
resetting when a new membership row appears — the reasoning
[`social.ts`](../../src/db/schema/social.ts) already records. An array column rather than a row
per type. And **no row means everything is on**, which is how D50's opt-out default is expressed
without backfilling a row for every user who has ever signed in.

`emails_enabled` is the one addition. "Off entirely" must not depend on all six types being
individually present in the array, or a seventh type added later silently turns itself back on
for somebody who had opted out.

### The key carries the recipient

This is the part worth staring at. A feed event is **one row for the whole season**. A
notification is **one row per person**. So the key is the feed event's `dedupeKey` with the
recipient appended:

| Notification           | Key                                         | Reuses                                 |
| ---------------------- | ------------------------------------------- | -------------------------------------- |
| `WAGER_OFFERED`        | `p2p:<wagerId>:offered:<userId>`            | `offer.ts:165`                         |
| `OFFER_EXPIRING`       | `p2p:<wagerId>:expiring:<userId>`           | new — no feed event exists             |
| `DISPUTE_NEEDS_RULING` | `p2p:<wagerId>:disputed:<attempt>:<userId>` | `claim.ts:110`, `sweep.ts:221`         |
| `DISPUTE_NEEDS_RULING` | `customevent:<id>:disputed:<byId>:<userId>` | `dispute.ts:95`                        |
| `ACCOUNT_APPROVED`     | `user:<userId>:approved`                    | new — no feed event exists             |
| `BETS_SETTLED`         | `bet:<betId>:settled:<attempts>:<userId>`   | `grade-legs.ts:133`, `resettle.ts:315` |
| `ALLOWANCE_PAID`       | `allowance:<seasonId>:<weekKey>:<userId>`   | `allowance.ts:83`                      |

Every one of those inherits its re-run safety from the feed key it extends, which is the whole
point: `settle` is resumable and safe to re-run, and the notification key is safe for exactly
the same reason the feed key is.

`:<attempt>` and `:<attempts>` are load-bearing and are carried over unchanged. An admin
correction writes a different key and therefore _re-notifies_, rather than being swallowed as a
duplicate — the same reasoning [`p2p.ts`](../../src/db/schema/p2p.ts) gives for
`settlementAttempts` and [`claim.ts`](../../src/server/p2p/claim.ts) records in a comment.

`ACCOUNT_APPROVED` carries no version because re-approval is not a new fact worth an email.

---

## 5. Enqueue and delivery

### Enqueue

`enqueueNotification(tx, input)` is one `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`, taking a
`tx` rather than opening its own — the argument
[`emit.ts`](../../src/server/feed/emit.ts) already makes, applied unchanged. A notification that
commits separately from the fact it describes can announce a settlement that rolled back.

**Preferences are not read here.** They are applied at delivery
([D65](../decisions.md#d65--preferences-are-applied-at-delivery-suppression-is-an-outcome-not-a-missing-row)).
Two consequences: the settle transaction gains no preferences query, and a member who mutes a
type on Sunday afternoon does not leave a half-keyed hole behind them — the row exists, is not
sent, and says `SUPPRESSED`.

### Delivery

`deliverPending(now)` is the only thing in the system that sends mail.

1. Select rows where `sent_at is null`, ordered by `queued_at`.
2. Load preferences for the distinct users in one query. A row whose user has
   `emails_enabled = false`, has the type in `muted_types`, or is not `APPROVED` is stamped
   `SUPPRESSED` and never rendered. (`ACCOUNT_APPROVED` is exempt from the status check — it is
   the transition.)
3. Group the surviving `DIGEST` rows by `user_id` and render **one** email per user
   ([D66](../decisions.md#d66--the-digest-collapses-across-types-into-one-email-per-recipient)).
   `IMMEDIATE` rows render one apiece.
4. Send, then stamp `sent_at` and `outcome`.

Two triggers, one implementation:

- **`after()` from `next/server`**, in the four actions that enqueue immediates. It runs once the
  response is flushed, so nothing sends inside a transaction and nothing sits in the request path.
- **`/api/cron/notify`**, daily at 13:00 UTC in `vercel.json`. It flushes the digest and sweeps
  anything `after()` dropped — a process that died, or an enqueue that came from a cron rather
  than a request.

13:00 UTC is 9am Eastern, so Sunday's settlements arrive Monday morning rather than at 4am. It is
a daily schedule, so it is legal on Vercel Hobby and needs no GitHub Actions job and no new
`[NOAH]` secret — unlike `settle`, whose Actions schedule is currently disabled.

The route is wrapped in `runJob('NOTIFY', …)`, which means adding `NOTIFY` to the `job_name`
enum and buys the run record, the `/admin/health` row and D60's transition-based alerting for
free. **This is the single place phase 8 depends on phase 6 having landed.** Without it the route
still works; it is simply not recorded.

### Failure

A failed send increments `attempts` and stores `"Name: message"` — never a stack, the rule
`job_runs.error` already follows. Five attempts marks the row `FAILED` and stops retrying. The
pass returns a failure count, `runJob`'s `partialErrors` turns it into an alert, so a rotated API
key shouts through the machinery phase 6 already built instead of being discovered by a member
who stopped getting mail.

**No delivery failure can change what a cron route or an action returns.** `after()` callbacks
swallow and log; `deliverPending` never throws out of a per-row failure.

### Retention

The daily `reconcile` run deletes `notifications` rows older than 30 days, beside the existing
`pruneJobRuns` call. Pruning rides an existing job rather than earning a schedule of its own.

---

## 6. The transport, and dev mode

`transport.ts` exposes one function, `sendEmail(message)`, and picks its implementation from the
environment:

| `RESEND_API_KEY` | Behaviour                                                           |
| ---------------- | ------------------------------------------------------------------- |
| unset            | `console.info` the recipient, subject and text body. Sends nothing. |
| set              | One `POST https://api.resend.com/emails` with a Bearer key.         |

**Dev mode is the absence of a key, not a second flag**
([D68](../decisions.md#d68--the-email-transport-is-inert-without-an-api-key)). This is the idiom
the repository already uses twice: `ALERT_WEBHOOK_URL` unset makes
[`alerts.ts`](../../src/server/ops/alerts.ts) `console.warn` rather than error, and
[D62](../decisions.md#d62--sentry-is-inert-without-a-dsn) makes Sentry inert without a DSN. It
also means CI and the test suite cannot send mail by construction, because no key is ever set
there — which is a stronger guarantee than a flag somebody can set wrong.

Resend over plain `fetch`, with no SDK, exactly as `alerts.ts` posts to a webhook with no SDK.
`package.json` gains no dependency. The free tier is 3,000 messages a month and 100 a day
against a group of about a dozen. The whole provider surface is one small module, so changing
provider later is a one-file change.

**What this accepts:** a production deploy that forgets the key logs silently instead of sending.
`/admin/health` therefore gains a row naming the live transport — "console (RESEND_API_KEY not
set)" or "Resend" — the same way it already surfaces the rest of the inert-without-configuration
surface.

---

## 7. Unsubscribe

### The token

`signUnsubscribe(userId, scope)` returns
`base64url(HMAC-SHA256(AUTH_SECRET, "unsub:v1:<userId>:<scope>"))`, verified with
`crypto.timingSafeEqual`. `scope` is `all` or one of the six types. `node:crypto` only, no
dependency, and no column: `AUTH_SECRET` already exists and the token is derived, not stored
([D67](../decisions.md#d67--unsubscribe-is-a-stateless-hmac-and-get-never-mutates)).

The `v1:` prefix means the scheme can be changed later without silently honouring old tokens.

### GET must not mutate

This is the part that is easy to get wrong and expensive to debug. Outlook Safe Links, corporate
mail filters and link scanners issue a GET against every URL in a message. An `/unsubscribe?…`
link that turns notifications off on GET gets members silently unsubscribed by their own
employer's spam filter, and the symptom is "email stopped working" with nothing anywhere to
explain it.

| Route              | Method | Public | Effect                                                                             |
| ------------------ | ------ | ------ | ---------------------------------------------------------------------------------- |
| `/unsubscribe`     | GET    | yes    | Verifies the token, **mutates nothing**, renders a confirmation page with a button |
| `/api/unsubscribe` | POST   | yes    | The only writer. `insert … onConflictDoUpdate`                                     |

A bad token renders a neutral "this link is not valid" and reveals nothing about whether the user
exists. Both routes are public simply by not calling `requireApprovedMember()` — this app has no
middleware, and auth is enforced per page.

### True one-click comes from the headers

Every send carries:

```
List-Unsubscribe: <https://…/api/unsubscribe?u=…&s=BETS_SETTLED&t=…>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

which is RFC 8058. Gmail and Apple Mail render their own native Unsubscribe control and **POST**
to it — no page, no sign-in, one click. That is the roadmap's requirement met in the way that
survives a link scanner.

The header is scoped to _that email's type_, never `all`. Someone pressing Gmail's button means
"stop sending me this", not "stop sending me everything". The email footer offers both scopes as
ordinary links — "stop these" and "stop all email" — plus a link to the screen.

---

## 8. `/me/notifications`

Mirrors [`/me/feed-preferences`](<../../src/app/(app)/me/feed-preferences/page.tsx>) structurally:
a server component holding an `OPTIONS` array of `{type, label, description}`, and a client
`PreferencesForm` with `useState` + `useTransition` that disables its control while pending. The
last of those is not optional — `src/app/__tests__` asserts it structurally under
[D51](../decisions.md#d51--ui-conventions-are-tested-structurally-not-with-a-component-test-harness).

One addition: a master switch above the six. **When it is off the six render disabled**, because
a row of live-looking toggles underneath a global off is a lie about what will happen.

`/me` gains a link beside the existing "Feed filters" one. No raw colour classes anywhere — the
token lint test fails the build on one.

---

## 9. What this does to the money core

**This phase writes nothing to the ledger.** No `postEntry` call is added, no entry type, no
balance-cache update, no escrow path, no currency comparison. Invariants 1, 3 and 4 of the
[money-invariants skill](../../.claude/skills/money-invariants/SKILL.md) are untouched by
construction, and that is the strongest answer available to them.

**Invariant 2 is the one this phase engages**, on a table parallel to the ledger. Every key
derives from the identity of a fact — bet id plus attempt, wager id plus attempt, season plus ISO
week, user id — combined with the recipient. Nothing closes over `Date.now()`, a random id, an
array index, or iteration order. The `attempts`/`attempt` components are carried over verbatim
from keys that already satisfy this, so a correction cannot collide with what it corrects.

**The one new risk, named rather than buried.** `enqueueNotification` runs _inside_ the settle
transaction, so a throw there rolls back a settlement. This is the same exposure `emitFeedEvent`
already accepts, for the same reason — an email about a bet that did not settle is worse than a
settlement that retries on the next pass — but it is one more statement in the money path and
should be reviewed as such. The insert takes no joins and does no computation; the recipient
comes from a query the transaction already makes where the shape allows, and a single
primary-key lookup on `season_memberships` where it does not.

**The money-touch hook fires on five of the files this phase edits** —
`p2p/offer.ts`, `p2p/claim.ts`, `p2p/sweep.ts`, `bets/grade-legs.ts` and `bets/resettle.ts` —
because it matches `src/server/bets/*` and `src/server/p2p/*`. `/money-invariants` runs before
each of those commits.

**A gap found while checking this, recorded but deliberately not fixed here.** The hook covers
`src/server/money`, `src/server/bets`, `src/server/p2p`, `src/server/events/resolve.ts` and
`src/db/schema/money.ts`. [`src/server/seasons/allowance.ts`](../../src/server/seasons/allowance.ts)
calls `postEntry` twice and sits outside all five. Phase 8 edits that file. Widening the hook is a
one-line change to `.claude/hooks/money-touch.sh`, but it belongs to repo health rather than to
this phase, and changing a guard in the same commit as the code it guards is the wrong order.

---

## 10. Testing

The split is by what the test needs, not by what a cloud session can reach — because, measured
today, a cloud session reaches all of it.

| Layer                                                                                       | Needs a database | Runs in a cloud session |
| ------------------------------------------------------------------------------------------- | ---------------- | ----------------------- |
| `render.ts` — six subjects and bodies, digest collapsing, money as strings never numbers    | no               | ✅                      |
| `unsubscribe.ts` — sign/verify round trip, tampered token, wrong scope, timing-safe compare | no               | ✅                      |
| The expiring-offer window predicate                                                         | no               | ✅                      |
| `transport.ts` against a stubbed `fetch`, as `alerts.test.ts` already stubs the webhook     | no               | ✅                      |
| Key re-run safety — settle twice, one row; correct a settlement, a **second** row           | yes              | ✅                      |
| Allowance twice in one week — one row per member, not two                                   | yes              | ✅                      |
| Delivery-time suppression, the digest grouping, the unsubscribe upsert                      | yes              | ✅                      |
| A real message rendering in a real inbox                                                    | —                | ❌ **[MANUAL]**         |
| The migration applied to the production database                                            | —                | ❌ **[NOAH]**           |

The re-run tests are the ones that matter, and they are the reason this design exists. Settling
the same bet twice must produce one notification row; correcting a settlement must produce a
second, because it is a different fact.

---

## 11. Success criteria

1. Running `settle` twice over the same finished games produces the same number of
   `notifications` rows as running it once.
2. An admin correction to a settled bet produces a **new** notification row, not a swallowed one.
3. Running the allowance job twice in one ISO week produces one row per member.
4. With `RESEND_API_KEY` unset, the whole path runs and sends nothing, logging each message.
5. A member with `emails_enabled = false` accumulates rows stamped `SUPPRESSED` and receives
   nothing.
6. A GET of an unsubscribe link changes no database row. The matching POST changes exactly one.
7. `npm run verify` passes: typecheck, lint, and the full suite.
8. **[MANUAL]** A real message arrives, renders, and its Unsubscribe control works in Gmail.

---

## 12. Decisions this design records

| #                                                                                                           | What                                                       |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [D63](../decisions.md#d63--every-send-is-keyed-but-not-every-send-rides-a-feed-event)                       | The invariant is the key, not the feed event               |
| [D64](../decisions.md#d64--notifications-are-an-outbox-enqueued-in-the-transaction-delivered-outside-it)    | Enqueue in the transaction, deliver in a separate pass     |
| [D65](../decisions.md#d65--preferences-are-applied-at-delivery-suppression-is-an-outcome-not-a-missing-row) | Preferences at delivery, never at enqueue                  |
| [D66](../decisions.md#d66--the-digest-collapses-across-types-into-one-email-per-recipient)                  | One digest email per recipient, across types               |
| [D67](../decisions.md#d67--unsubscribe-is-a-stateless-hmac-and-get-never-mutates)                           | A derived token, and a GET that cannot unsubscribe anybody |
| [D68](../decisions.md#d68--the-email-transport-is-inert-without-an-api-key)                                 | Dev mode is the absence of a key                           |
