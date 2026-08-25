import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { getSlate } from '@/server/odds/board';
import { requireApprovedMember } from '@/server/auth/session';
import { GameCard } from './game-card';

export const metadata: Metadata = { title: 'Games' };

export default async function GamesPage() {
  await requireApprovedMember();
  const slate = await getSlate();

  if (slate.length === 0) {
    return (
      <EmptyState
        title="No games on the board"
        body="Nothing is open for betting right now. The odds sync runs every 15 minutes."
      />
    );
  }

  const byDay = new Map<string, typeof slate>();
  for (const game of slate) {
    const day = game.startsAt.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    });
    byDay.set(day, [...(byDay.get(day) ?? []), game]);
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      {[...byDay.entries()].map(([day, games]) => (
        <section key={day} className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {day}
          </h2>
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </section>
      ))}
    </div>
  );
}
