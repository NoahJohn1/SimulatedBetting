import type { ReactNode } from 'react';
import { Card } from './card';
import { Table, THead, TBody, Tr, Th, Td } from './table';

/**
 * Screen-specific skeletons (D-something, Task 16): a skeleton that does not match the screen
 * it precedes reads worse than an honest placeholder (see loading-screen.tsx's own comment,
 * which is exactly why that generic component waited for 7d instead of guessing). Each shape
 * below is drawn from the shipped markup of the screen it stands in for — same grid columns,
 * same card borders, same row counts — so the layout does not jump when the real content
 * arrives. `LoadingScreen` remains in use on every route that has no shipped shape yet.
 */

type SkeletonRadius = 'control' | 'card' | 'pill';

const RADIUS: Record<SkeletonRadius, string> = {
  control: 'rounded-control',
  card: 'rounded-card',
  pill: 'rounded-pill',
};

/**
 * The one primitive every skeleton below is built from: a `bg-surface-skeleton` block in one
 * of the app's three corner radii. `animate-pulse` sits behind Tailwind's `motion-safe:`
 * variant — compiled to `@media (prefers-reduced-motion: no-preference)` — so a
 * reduced-motion viewer gets a static block in the same place: the reserved space is the
 * information, the pulse is decoration.
 */
export function Skeleton({
  className = '',
  radius = 'control',
}: {
  className?: string;
  radius?: SkeletonRadius;
}) {
  return (
    <div
      aria-hidden
      className={`${RADIUS[radius]} bg-surface-skeleton motion-safe:animate-pulse ${className}`}
    />
  );
}

/**
 * The same live-region contract `LoadingScreen` uses: one `role="status"` announcement for
 * the whole screen, so a screen reader says "Loading games" once instead of walking a tree of
 * unlabelled decorative blocks (every `Skeleton` above is `aria-hidden`).
 */
function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Games — the odds board (games/page.tsx, day-section.tsx, game-row.tsx)

const LEAGUE_CHIP_WIDTHS = ['w-12', 'w-12', 'w-16'] as const;
const DAY_CHIP_WIDTHS = ['w-1/4', 'w-1/4', 'w-1/4', 'w-1/4'] as const;

function ChipRow({ widths }: { widths: readonly string[] }) {
  return (
    <div className="flex gap-2 overflow-x-auto px-1">
      {widths.map((w, i) => (
        <Skeleton key={i} radius="pill" className={`h-6 shrink-0 ${w}`} />
      ))}
    </div>
  );
}

/** The SPREAD/MONEY/TOTAL column-header row that renders once per open day section. */
function BoardHeaderRow() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4rem)] gap-x-2 px-1 py-1 lg:grid-cols-[3.5rem_minmax(0,1fr)_repeat(3,4.5rem)]">
      <span className="hidden lg:block" />
      <span />
      <Skeleton className="mx-auto h-3 w-12" />
      <Skeleton className="mx-auto h-3 w-12" />
      <Skeleton className="mx-auto h-3 w-12" />
    </div>
  );
}

/** One GameRow: away line then home line, each a team abbreviation plus three odds cells —
 * the cell blocks are sized `h-12 w-16` to match OddsCell's real dimensions exactly. */
function BoardRow() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4rem)] items-center gap-x-2 gap-y-1 border-b border-line-subtle px-1 py-2 lg:grid-cols-[3.5rem_minmax(0,1fr)_repeat(3,4.5rem)]">
      <Skeleton className="row-span-2 hidden h-4 w-12 lg:block" />
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-12 w-16" />
      <Skeleton className="h-12 w-16" />
      <Skeleton className="h-12 w-16" />
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-12 w-16" />
      <Skeleton className="h-12 w-16" />
      <Skeleton className="h-12 w-16" />
    </div>
  );
}

/**
 * Mirrors `/games`: the League and Day chip rows, one day section's sticky heading and market
 * header, then ten two-line game rows — the density a real slate shows on first paint, not
 * the empty-board fallback.
 */
export function GamesBoardSkeleton() {
  return (
    <LoadingRegion label="Loading games">
      <div className="flex flex-col gap-3 px-4 py-4 lg:px-0">
        <ChipRow widths={LEAGUE_CHIP_WIDTHS} />
        <div className="overflow-x-auto">
          <ChipRow widths={DAY_CHIP_WIDTHS} />
        </div>

        <div className="border-b border-line-subtle">
          <div className="sticky top-12 z-10 flex items-center justify-between bg-surface px-1 py-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-12" />
          </div>
          <BoardHeaderRow />
          {Array.from({ length: 10 }).map((_, i) => (
            <BoardRow key={i} />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

// ---------------------------------------------------------------------------------------------
// Feed (feed-card.tsx, feed-list.tsx)

function FeedCardSkeleton() {
  return (
    <Card as="article" className="flex flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-12 shrink-0" />
      </div>
      <div className="flex flex-col gap-1">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <Skeleton radius="pill" className="h-6 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </Card>
  );
}

/** Mirrors `/feed`: four cards, each a header line (actor + relative time), two body lines,
 * and a reaction-trigger-plus-comment-link footer. */
export function FeedListSkeleton() {
  return (
    <LoadingRegion label="Loading the feed">
      <div className="flex flex-col gap-2 px-4 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <FeedCardSkeleton key={i} />
        ))}
      </div>
    </LoadingRegion>
  );
}

// ---------------------------------------------------------------------------------------------
// Bets (bets/page.tsx)

function BetCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-raised p-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton radius="pill" className="h-4 w-16" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-12 shrink-0" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-12 shrink-0" />
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line-subtle pt-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

/** Mirrors `/bets`: the merged Bets|Wagers / Cash|Credits chip row, a "Pending" section
 * heading, and three bet cards — each a status chip, a couple of leg lines with prices, and a
 * stake/return footer. */
export function BetsListSkeleton() {
  return (
    <LoadingRegion label="Loading your bets">
      <div className="flex flex-col gap-6 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton radius="pill" className="h-6 w-16" />
          <Skeleton radius="pill" className="h-6 w-16" />
          <Skeleton radius="pill" className="h-6 w-16" />
          <Skeleton radius="pill" className="h-6 w-16" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          {Array.from({ length: 3 }).map((_, i) => (
            <BetCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

// ---------------------------------------------------------------------------------------------
// Standings (standings/page.tsx)

function RankCardSkeleton() {
  return (
    <Card className="flex items-center gap-3 p-3">
      <Skeleton className="h-4 w-6" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-16 shrink-0" />
    </Card>
  );
}

function StandingsTableSkeleton() {
  return (
    <Card className="hidden overflow-x-auto lg:block">
      <Table>
        <THead>
          <Tr>
            <Th>
              <Skeleton className="h-3 w-8" />
            </Th>
            <Th>
              <Skeleton className="h-3 w-12" />
            </Th>
            <Th align="right">
              <Skeleton className="ml-auto h-3 w-12" />
            </Th>
            <Th align="right">
              <Skeleton className="ml-auto h-3 w-12" />
            </Th>
          </Tr>
        </THead>
        <TBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <Tr key={i}>
              <Td>
                <Skeleton className="h-4 w-6" />
              </Td>
              <Td>
                <Skeleton className="h-4 w-1/2" />
              </Td>
              <Td align="right">
                <Skeleton className="ml-auto h-4 w-12" />
              </Td>
              <Td align="right">
                <Skeleton className="ml-auto h-4 w-16" />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

/** One board's worth of shape: rank cards below `lg`, the `Table` at `lg` — reused for both
 * the cash and the credits section, since the page always renders both. */
function StandingsBoardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2 lg:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i}>
            <RankCardSkeleton />
          </li>
        ))}
      </ol>
      <StandingsTableSkeleton />
    </div>
  );
}

/** Mirrors `/standings`: the cash board's shape, then the credits section heading and its own
 * board — the same dual-render pattern (cards below `lg`, `Table` at `lg`) twice, matching
 * the page's two always-rendered sections. */
export function StandingsSkeleton() {
  return (
    <LoadingRegion label="Loading standings">
      <div className="flex flex-col gap-6 px-4 py-4">
        <StandingsBoardSkeleton />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-1/3" />
          <StandingsBoardSkeleton />
        </div>
      </div>
    </LoadingRegion>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin (admin/page.tsx)

function PendingApprovalCardSkeleton() {
  return (
    <Card className="flex items-center justify-between gap-3 p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <span className="flex shrink-0 gap-2">
        <Skeleton radius="pill" className="h-8 w-16" />
        <Skeleton radius="pill" className="h-8 w-16" />
      </span>
    </Card>
  );
}

/** Mirrors `/admin`: the page heading, the four section links, and the "Waiting for approval"
 * list — three pending-member cards, each a name/email pair and its approve/deny buttons. */
export function AdminSkeleton() {
  return (
    <LoadingRegion label="Loading admin">
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-6">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-1/4" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-1/3" />
          {Array.from({ length: 3 }).map((_, i) => (
            <PendingApprovalCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}
