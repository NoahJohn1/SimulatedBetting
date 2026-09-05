# Screen Rebuild and Craft — Design Spec

**Date:** 2026-09-05
**Status:** Specified
**Scope:** Phases 7c and 7d of the UI ladder (see [../roadmap.md](../roadmap.md#7--the-ui-ladder)) — one
spec for both rungs, because 7d's inherited items are craft applied to the same screens 7c
rebuilds, and specifying them apart would design every screen twice. The rungs stay separate
inside it: **the app is shippable at the end of 7c alone**, and every 7d item lands on top of a
7c screen rather than reopening it.
**Depends on:** [7b](2026-08-24-design-system-design.md), which shipped the token layer and the
component set this phase builds against, and [phase 5](../roadmap.md#5--real-data-the-espn-adapter),
whose local ESPN path produced the real slate this spec was written against.
**Blocks:** nothing outside the ladder.

## Purpose

7b gave the app one vocabulary; the screens are still the ones drawn before it existed. This
phase redesigns them — hot path first, so the rungs pay off in the order people feel them:

**Games and the bet slip → Feed → Standings → Bets and Wagers → Events → Me → Admin.**

7c is the rebuild: layout, hierarchy, density, and the four components 7b deferred for lack of
call sites. 7d is craft on the rebuilt screens: motion, skeletons, accessibility behaviour, the
dark-mode toggle, and the accent picker.

Unlike 7a and 7b, this spec was written against **real content**: a live ESPN slate pulled into
a local database (179 games, 366 markets), viewed signed-in at 375×812 and 1280×800. Most of the
inherited backlog only exists under real content, and the walk confirmed it — including that the
"60-game CFB Saturday" stress case in [D8](../decisions.md#d8--layout-sportsbook-first) is not
hypothetical: the walk's Saturday had 68 upcoming games, the next one 80.

### What the walk found

The evidence the design answers to. Each item is what a signed-in member actually sees today.

- **/games is a 34,000px page.** 180 game cards in one column, ~190px each, no league or day
  filter, no sticky context, and the SPREAD/MONEY/TOTAL header row repeated inside every card —
  about 45 screenfuls of blind scrolling to reach next week.
- **At 1280×800 no screen has a shape.** Team codes sit far left, odds pinned far right, ~900px
  of empty card between them, four games per screen, and the mobile tab bar stretches across the
  full width. Confirms the [design-system audit](../design-system-audit.md)'s finding unchanged.
- **Game-bet legs never name the game.** `/bets` renders "SPREAD · AWAY 2.5 −112" and
  "MONEYLINE · HOME −1450" with no team, no opponent, no kickoff — a member cannot tell which
  bet is which. Custom-event legs do carry their title, so this is specifically the game-leg
  describer. The feed already solves this (`describe-leg.ts`); the bets screen never adopted it.
- **The expanded bet slip omits the price.** A leg shows "ECU +27.5 · Spread" without the −102,
  and there is no potential-payout line before placing — "To return" exists on `/bets` but not
  in the slip, where the decision is actually made.
- **`/me` leaks an enum.** Escrow ledger rows are titled raw `P2P_ESCROW`; "Bet placed" rows
  carry no bet detail. The Feed filters / Email links are bare text with no affordance.
- **Dates are formatted three ways.** "Wed 11:25am" (feed), "Sep 7, 11:25 AM" (events),
  "9/10/2026, 11:27:03 AM" (wager detail, seconds included).
- **A wager can occupy two board sections at once** — an accepted wager appears under both
  AWAITING YOUR CALL and LIVE on `/wagers`.
- **The status chip stutters.** A pending parlay card shows PENDING three times: once at bet
  level and once per leg.
- **Inherited items reproduced as written:** the two-up `datetime-local` cramping on
  `/events/new` and `/wagers/new`; the "Event queueBack to admin" run-together; the admin
  section rendering outside the shell with floating empty states; the neutral "Loading admin"
  flash on every admin navigation.
- **Reactions dominate the feed's height.** Every card carries an always-visible six-emoji
  row plus a Comment link — roughly a third of each card is interaction chrome.
- **Detail screens have no back links and no titles.** Browser back and the tab bar are the only
  exits, and with `generateMetadata` missing (7a's deferral), history entries are all named
  "SimulatedBetting".

## Success criteria

### 7c — the rebuild

1. Every screen in the order above is rebuilt on the 7b vocabulary, and the app is shippable at
   each step — one screen group per PR-sized commit, hot path first.
2. `/games` handles a real Saturday: compact rows in day sections, column headers once per
   section, sticky day header, league and day filter chips, later days collapsed by default
   with counts ([D77](../decisions.md#d77--the-odds-board-is-compact-rows-in-filterable-collapsible-day-sections)).
   A 68-game day is navigable without scrolling blind.
3. At ≥1024px the tab bar moves into the top header, content clamps to a centered column, and
   `/games` alone widens to two panes with a persistent bet-slip rail
   ([D74](../decisions.md#d74--desktop-is-a-content-column-plus-a-games-slip-rail-not-a-redesign)).
   Below 1024px, layout behaviour is unchanged from today except where a screen's own rebuild
   changes it.
4. `Dialog`, `Sheet`, `Table`, and `Toast` exist, each built in the commit that first needs it,
   each with a real call site named in this spec ([D53](../decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist)'s rule, continued).
5. Every action result announces through the Toast layer
   ([D76](../decisions.md#d76--all-action-results-announce-through-one-toast-layer)); no form
   reports success as inline text that can scroll out of view.
6. The token layer carries six accent hues under `[data-accent]`, each an a11y-checked
   light/dark pair; the app defaults to green
   ([D75](../decisions.md#d75--the-accent-is-a-per-account-choice-from-six-curated-hues)).
7. Game-bet legs name their teams everywhere legs render, via one shared leg describer.
8. One date/time vocabulary, applied by one formatter module, replaces the three formats above.
9. `generateMetadata` exists on every detail route; detail screens carry a back link.
10. The admin section renders inside the app shell
    ([D78](../decisions.md#d78--admin-joins-the-app-shell)), with its inherited header and
    container fixes absorbed by the rebuild.
11. Type scale and spacing on every rebuilt screen use only the subsets 7b recorded.
12. `npm run verify` and `npm run build` pass; the token-lint and structural tests are extended,
    not weakened.

### 7d — craft on the rebuilt screens

13. Motion: enter/exit transitions for Sheet, Dialog, and Toast; selection feedback on odds
    cells; all gated behind `prefers-reduced-motion`.
14. Skeleton loaders shaped like their screens replace the neutral `LoadingScreen` on the
    routes that fetch: games, feed, bets, standings, admin.
15. Accessibility: keyboard paths through the odds board and slip; focus trap and restore in
    Dialog and Sheet; `role="status"` announcements for Toast; labels on every icon-only
    control; contrast holds in both themes for all six accents.
16. The dark-mode toggle ships: control on `/me`, cookie, `[data-theme]` — the selectors 7b
    already wrote.
17. The accent picker ships: `users.accent` column, `/me` control, server-rendered
    `[data-accent]` with no flash of the default.
18. Error and empty-state copy reads like a person wrote it — the walk's floating "Nobody is
    waiting" states get designed layouts.
19. Dialog, Sheet, and Toast get the minimal component-test harness
    ([D79](../decisions.md#d79--dialog-sheet-and-toast-earn-a-minimal-component-harness-revisiting-d54)).

## Non-goals

- **Virtualized lists.** Collapsed sections and filters cap the rendered DOM; a windowing
  library is a dependency the slate sizes seen do not justify. Revisit if a filtered single day
  exceeds ~150 games.
- **Live scores or in-play states on the board.** The board shows the pre-game slate;
  IN_PROGRESS/FINAL rendering stays as it is today.
- **Team logos.** `teams.logo_url` is populated by the ESPN adapter and available, but the
  compact row is designed text-first; logos are a possible desktop-only enhancement the screen
  designs may propose, not a requirement.
- **Any change to money, betting, or settlement logic.** This phase renders differently; it
  computes nothing differently. The [money-invariants](../decisions.md#d5--balance-immutable-ledger-plus-a-cached-balance)
  surface is untouched.
- **New runtime dependencies for 7c.** Sheet, Dialog, Table, and Toast are hand-built on the
  token layer (Dialog on the native `<dialog>` element). 7d adds jsdom and React Testing
  Library as dev dependencies only (D79).
- **Multi-book lines, search, notification UI changes** — out of scope entirely.
- **The design canvas.** A separate step after this spec is reviewed, per the phase brief.

## Architecture

### The layout system (D74)

One breakpoint carries the phase: `lg` (1024px). Below it the app keeps its phone shape. At and
above it:

- **The shell.** The bottom `TabBar` hides; the same six destinations render as links in the top
  header, between the wordmark and the Admin/balance cluster. One nav component, two placements,
  active-state logic shared.
- **Content column.** Every screen's content clamps to `max-w-2xl` (matching `/admin*`'s
  existing pattern) centered, full-width inside it. This alone retires the "every list runs edge
  to edge" audit finding.
- **`/games` two-pane.** The one screen that earns more: a grid of board (the content column's
  width) plus a ~340px slip rail, the rail sticky under the header. The rail renders the same
  slip state the mobile Sheet renders — selections, stakes, payout, place — permanently visible,
  which is the sportsbook pattern [D8](../decisions.md#d8--layout-sportsbook-first) chose
  mobile-first and never got to finish on desktop.

The slip is therefore one stateful component with two containers: a `Sheet` below `lg`, a rail
at `lg+`. Selection state already lives above both (it survives today's collapse/expand), so
this is a rendering split, not a state refactor.

### The odds board (D77)

The card-per-game design dies here; compact rows replace it.

- **A game is a two-line row**: away team on line one, home on line two, each line carrying its
  three prices (spread, money, total) as tappable cells; kickoff time in the row's leading
  column. Cell tap behaviour, selected state, and "—" suspended rendering carry over unchanged.
- **A day is a section**: sticky header ("Saturday, Sep 5 · 68 games"), the SPREAD/MONEY/TOTAL
  column header rendered once under it, rows beneath. Today's section is open; later days
  render collapsed with their counts, expanding on tap.
- **Filters are chips above the board**: league (All · NFL · NCAAF) and day. They are
  server-rendered links (the `SegmentedControl` link pattern), not client state, so the URL
  carries the view and back works.
- **Budget:** a 68-game day at roughly 64px/row plus section chrome lands near 5,000px —
  down from 34,000px — before any filter is applied.

### The accent system (D75)

Tier 1 gains the ramp stops for six hues; Tier 2 gains nothing — `--accent` and `--accent-ink`
keep their names, and `[data-accent="…"]` selectors remap them exactly the way `[data-theme]`
remaps the neutrals:

| Accent | Light | Dark | `--accent-ink` (light/dark) |
| ------ | ----------- | ----------- | --------------------------- |
| Green (default) | green-700 | green-400 | white / green-950 |
| Blue | blue-600 | blue-400 | white / blue-950 |
| Indigo | indigo-600 | indigo-400 | white / indigo-950 |
| Violet | violet-600 | violet-400 | white / violet-950 |
| Teal | teal-700 | teal-400 | white / teal-950 |
| Orange | orange-700 | orange-400 | white / orange-950 |

The exact stops are chosen in the token commit against measured contrast — every `--accent-ink`
on `--accent` pair must hold ≥4.5:1 in both themes, and the two hues that share a family with an
outcome colour are tuned away from it: green darker and yellower than emerald (positive), orange
redder and deeper than amber (caution). A selected odds cell must never read as a settled
outcome; the audit for this phase checks exactly that confusion.

Where the accent appears — and deliberately nowhere else: selected odds cells, the primary
`Button` variant, active nav state, the segmented control's active pill, focus rings. The rest
of the app stays monochrome.

**Split across the rungs:** 7c ships the six hue pairs and the `[data-accent]` plumbing with
green applied to everyone. 7d ships the choice: a `users.accent` column, the `/me` picker, and
the root layout reading the signed-in user's value — server-rendered, so no flash.

### The four components, and where each is first used

Following [D53](../decisions.md#d53--the-shared-component-set-is-scoped-to-call-sites-that-exist):
each is built in the commit that first needs it, against the call sites named here.

| Component | First call site | What it is |
| --------- | --------------- | ---------- |
| `Sheet` | The expanded bet slip below `lg` (Games commit, first in the order) | Bottom sheet in a portal: scrim, drag-handle, ESC/scrim dismiss, focus trap, body scroll lock, safe-area padding. Replaces today's sticky-div slip and its `bottom-[41px]` coupling to the tab bar's rendered height. |
| `Toast` | Bet placed / slip errors (same Games commit) | One provider in the `(app)` shell, portal at the viewport edge, `role="status"` live region, auto-dismiss with pause-on-hover, a small queue. Tone prop reuses the callout tones. |
| `Dialog` | "Propose calling it off" on the wager detail (Bets and Wagers commit) | Native `<dialog>` under a styled wrapper: `showModal()`, ESC and scrim dismiss, focus restore to the invoker, a `danger` confirm variant. Later call sites: admin void, comment delete. |
| `Table` | `/standings` at `lg+` (Standings commit) | A semantic `<table>` speaking the token vocabulary — header row, numeric cell alignment, row hover. Desktop-only presentation; below `lg` the rank rows stay cards. Later call sites: `/me`'s ledger, admin queues. |

`Card` also gets the element-type escape hatch the 7b review asked for (`as` prop accepting
`article`/`section`/`li`), which unblocks the eleven hand-rolled call sites the audit counted.

### Toast policy (D76)

Every action result announces through the Toast layer — successes and failures both. Field-level
validation additionally marks the offending field inline (a toast saying "title is required"
without highlighting the title field would be a regression on long forms like `/events/new`),
but the announcement itself is always a toast, so no result can scroll out of view and every
result surfaces identically. This retires the inline-success-text pattern on all twelve forms as
their screens are rebuilt.

### Screen by screen (7c)

Each group is one shippable commit, in this order.

1. **Games and the bet slip.** The board per D77; the layout per D74; `Sheet` and `Toast` are
   born here. The slip gains each leg's price and a "To return" line before placing — the two
   things the walk found missing at the exact moment of decision. The slip rail appears at
   `lg+`.
2. **Feed.** Cards keep their sentence-first design; the reaction row collapses to a single
   trigger showing existing reactions plus a "react" affordance, restoring the card to content.
   Feed detail gains a back link and a real `<title>`.
3. **Standings.** `Table` at `lg+` with room for record columns the cards cannot afford;
   cards below. Current-user highlight carries over.
4. **Bets and Wagers.** Game legs adopt the shared leg describer — team, opponent, line, price,
   kickoff. One status chip per card (leg-level chips only where legs genuinely diverge on a
   settled parlay). The two stacked segmented controls merge into one row. A wager appears in
   exactly one board section — the one naming the action it wants from you. `Dialog` is born on
   the wager detail's call-it-off confirm. Dates move to the one formatter.
5. **Events.** The two-up `datetime-local` inputs stack full-width (the inherited layout fix);
   the market editor's "Book: —" placeholder disappears (a house market has no book, so the
   label earns nothing); event detail gets `generateMetadata` and a back link.
6. **Me.** Ledger rows speak English — "Escrow held · Chiefs win by 10+" instead of
   `P2P_ESCROW`, bet rows naming their bet — and the ledger becomes a `Table` at `lg+`. The
   Feed filters / Email links become a settings list with affordances, making room for 7d's
   toggle and picker rows.
7. **Admin.** Joins the app shell (D78): header, tab bar, and the content column replace the
   bare pages; the run-together header and the latent `mx-auto` overflow are fixed by
   construction. Admin destinations render for admins only, as today — the shell just stops
   pretending admin is a different app.

### 7d, on top

7d touches the same screens but never reopens their layout. Motion lands inside Sheet, Dialog,
and Toast (they ship in 7c with instant transitions; 7d adds the animation and the
`prefers-reduced-motion` gate). Skeletons are drawn from the final 7c screens — which is why 7a
deferred them here. The a11y pass audits what 7c built: focus order through compact rows, the
trap in Sheet and Dialog, toast announcements, chip labels. The dark toggle and accent picker
land together on `/me`'s new settings list — theme is a device choice (cookie), accent an
account choice (column), per D75. The harness (D79) arrives with the behaviour it tests.

## Testing

- **Structural tests extend.** Token-lint gains the six accent families in its Tier-1 allowlist
  file (`globals.css` only — screens still may not name a raw hue). `token-layer.test.ts`
  asserts each `[data-accent]` block remaps exactly the two accent tokens and nothing else. The
  route-conventions tests keep passing; `generateMetadata` presence on detail routes joins them
  as a new assertion, D51-style: it constrains routes not yet written.
- **A component harness, at last (D79).** jsdom plus React Testing Library, dev-only, scoped to
  the three components with real behaviour: Dialog (focus trap, ESC, restore), Sheet (dismiss
  paths, scroll lock), Toast (announcement, queue, dismiss). Nothing else migrates —
  `Button` and friends stay under structural assertion, as [D54](../decisions.md#d54--a-token-lint-test-is-the-harness-7b-earns-revisiting-d51)
  concluded.
- **No new e2e layer.** The browser audit below remains the phase's eyes.

## Verification

The 7b audit pattern, applied per rung:

- **End of 7c:** every route × both themes × 375×812 and 1280×800, against the real local ESPN
  slate (the phase-5 local path), written up as `docs/screen-rebuild-audit.md`. Two additions to
  the 7b protocol: the board is audited at a ≥60-game day specifically, and the six accents are
  each spot-checked on the selected-cell/primary-button/active-nav trio in both themes for the
  outcome-colour confusion named above.
- **End of 7d:** the same pass plus keyboard-only and screen-reader walks of the hot path
  (select → slip → place → toast), recorded in the same document.

## What this phase defers, and who owns it

| Deferred | Owner | Why not here |
| -------- | ----- | ------------ |
| Virtualized board rendering | Future, if ever | Collapse + filters cap the DOM at sizes measured; a dependency against a problem not yet observed |
| Team logos on the board | Screen designs may propose at `lg+` | Compact rows are text-first; logos are decoration until proven otherwise |
| Live/in-play board states | Post-ladder | Depends on data freshness guarantees the sync does not make |
| Member identity colour (accent as avatar) | Never, unless asked | D75 rejected admin-assigned accents; identity colour is a different feature wearing the same token |
| Radius-vocabulary adoption sweep (45 raw sites) | Absorbed per-screen here | Each rebuilt screen adopts `rounded-card`/`control`/`pill` as it is touched; no separate sweep |

## Risks

**The board rebuild is the phase's one genuinely new design, and it carries D8's stress case.**
Mitigated by designing against the live 68-game slate before any code (this spec's walk), and by
the audit's explicit ≥60-game check.

**Toast-for-everything is easy to overapply.** A toast per keystroke of validation would be
noise; the policy is one announcement per submitted action. The plan's per-form tasks name the
trigger moments.

**Six accents multiply the audit surface.** 30 tokens × 2 themes was 7b's matrix; accents add
6 × 2 pairs but only two tokens deep. Bounded by the spot-check protocol above rather than a
full re-audit per accent.

**Admin joining the shell touches authorization-adjacent rendering.** The shell gains
conditional admin links; the `requireAdmin` gates on the routes themselves are untouched. The
existing structural tests around admin routing must stay green through the move.

**The rungs can blur.** The discipline is the commit order: nothing in a 7c commit depends on a
7d item, and every 7d commit lands on a screen 7c already shipped. The plan tags every task
with its rung.
