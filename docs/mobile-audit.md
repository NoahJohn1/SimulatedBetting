# Mobile audit — 375×812

Every screen viewed at the iPhone viewport the tab bar and bet slip were designed around,
during [phase 7a](specs/2026-08-22-ui-foundations-design.md). Findings are recorded, not
fixed: anything that is merely ugly belongs to the rung that rebuilds the screen anyway.

**Classification.** `7a` — broken, not ugly; fixed immediately and noted as such.
`7b` — a token or shared-component problem. `7c` — needs the screen rebuilt.
`7d` — density and craft.

## Summary

The app reads cleanly on a phone almost everywhere: single-column cards, generous tap
targets on checkboxes and stat tiles, no unexpected reflow. Two things blocked real use and
are already fixed below. The first is structural and would have hit every member on every
page: the bet slip's collapsed bar and the bottom tab bar are independent `sticky bottom-0`
siblings, and two sticky elements anchored to the same edge don't reserve space for each
other — once both are "stuck" they occupy the identical screen rectangle, and the higher
z-index one wins every tap. With any bet selected, all six tab-bar links were completely
unreachable. The second was reported directly by a user while this audit was underway:
the two custom-event odds inputs used `inputMode="numeric"`, which hides the minus key on
iOS/Android, making it impossible to enter a negative American price — required for any
favorite — from a phone. Both are one- or two-line fixes, included in this commit. Past
those two, the remaining findings are density and native-control cosmetics that belong to
later rungs; the admin section in particular has no shell chrome at all on mobile, which
is existing design rather than a 7a regression but is worth 7c/7d's attention.

## Findings

| Screen | Finding | Severity | Rung |
|---|---|---|---|
| `/games` (bet slip, any page) | Collapsed bet-slip bar and the bottom tab bar are both `sticky bottom-0`; once stuck they occupy the same rectangle and the slip's higher z-index made all six tab links completely untappable while any bet was selected. Verified via `elementFromPoint` before and after. | blocks use | 7a — fixed (`src/components/bet-slip/bet-slip.tsx`: `bottom-0` → `bottom-[41px]`, offsetting by the tab bar's rendered height) |
| `/events/new`, `/events/[eventId]` (edit) | Odds-price inputs used `inputMode="numeric"`, which omits the minus key on iOS/Android, making it impossible to enter a negative American price on a phone — required for any favorite. Reported by a user mid-audit. | blocks use | 7a — fixed (`event-form.tsx`, `market-card.tsx`: `inputMode="numeric"` → `inputMode="text"`) |
| `/games` | SPREAD / MONEY / TOTAL three-column odds grid is dense at 375px — legible but tight, especially next to longer team abbreviations. | awkward | 7c |
| `/events/new`, `/wagers/new` | Native `datetime-local` inputs are placed two-up in a 50%-width row; the `mm/dd/yyyy, --:--` placeholder and set values are visually truncated. Still usable — the input is still focusable and fillable — just cramped. | awkward | 7c |
| `/admin/events` | "Event queue" heading and the "Back to admin" link sit in a row with no gap and run together as "Event queueBack to admin". `/admin/wagers`'s equivalent header wraps correctly, so this is page-specific, not systemic. | cosmetic | 7c |
| `/admin`, `/admin/events`, `/admin/wagers` | The admin section renders with no header or tab bar at all — just a title and a "Back to app" text link. This is existing design (admin doesn't render inside the `(app)` shell) rather than a 7a regression, but it reads as a different, unfinished app on a phone. | awkward | 7d |

## Screens with nothing to report

`/events` (empty state), `/events/[eventId]` (view mode), `/events/[eventId]/resolve`,
`/feed`, `/feed/[eventId]` (including comments), `/bets` (empty state, Bets/Wagers and
Cash/Credits segmented controls), `/wagers`, `/wagers/[wagerId]`, `/standings`, `/me`,
`/me/feed-preferences`, `/members/[membershipId]`. The bet slip itself — both collapsed and
expanded, at one leg and at three — has nothing further to report once the tab-bar overlap
above is fixed.
