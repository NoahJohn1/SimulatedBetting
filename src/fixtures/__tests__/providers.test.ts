import { describe, expect, it } from 'vitest';
import { FixtureOddsProvider, FixtureScoreProvider, allFixtureGameIds } from '@/fixtures/providers';

describe('FixtureOddsProvider', () => {
  it('returns upcoming games for a sport', async () => {
    const provider = new FixtureOddsProvider();
    const nfl = await provider.getUpcomingGames('NFL', 60);

    expect(nfl.length).toBeGreaterThanOrEqual(6);
    expect(nfl.every((g) => g.sport === 'NFL')).toBe(true);
    expect(nfl.every((g) => g.startsAt instanceof Date)).toBe(true);
  });

  it('filters by the withinDays window relative to the earliest kickoff', async () => {
    const provider = new FixtureOddsProvider();
    const all = await provider.getUpcomingGames('NFL', 60);
    const narrow = await provider.getUpcomingGames('NFL', 1);

    expect(narrow.length).toBeLessThan(all.length);
  });

  it('separates NFL and college slates', async () => {
    const provider = new FixtureOddsProvider();
    const ncaaf = await provider.getUpcomingGames('NCAAF', 60);

    expect(ncaaf.length).toBeGreaterThanOrEqual(2);
    expect(ncaaf.every((g) => g.sport === 'NCAAF')).toBe(true);
  });

  it('prices all three market types on the same game', async () => {
    const provider = new FixtureOddsProvider();
    const markets = await provider.getMarkets(['nfl-2026-w1-buf-nyj']);

    expect(markets.map((m) => m.type).sort()).toEqual(['MONEYLINE', 'SPREAD', 'TOTAL']);
    expect(markets.every((m) => m.selections.length === 2)).toBe(true);
  });

  it('carries a whole-number spread and total so both can push', async () => {
    const provider = new FixtureOddsProvider();
    const markets = await provider.getMarkets(['nfl-2026-w1-buf-nyj']);

    const spread = markets.find((m) => m.type === 'SPREAD');
    const total = markets.find((m) => m.type === 'TOTAL');

    expect(spread?.selections.find((s) => s.side === 'HOME')?.line).toBe('-4.00');
    expect(total?.selections.find((s) => s.side === 'OVER')?.line).toBe('44.00');
  });

  it('moves a line between sync rounds', async () => {
    const round0 = new FixtureOddsProvider({ round: 0 });
    const round1 = new FixtureOddsProvider({ round: 1 });

    const before = await round0.getMarkets(['nfl-2026-w1-sf-sea']);
    const after = await round1.getMarkets(['nfl-2026-w1-sf-sea']);

    const homeBefore = before[0].selections.find((s) => s.side === 'HOME');
    const homeAfter = after[0].selections.find((s) => s.side === 'HOME');

    expect(homeBefore?.line).toBe('-3.50');
    expect(homeAfter?.line).toBe('-4.50');
    expect(homeBefore?.priceAmerican).toBe(-110);
    expect(homeAfter?.priceAmerican).toBe(-120);
  });

  it('holds the last round for any round beyond it', async () => {
    const far = new FixtureOddsProvider({ round: 99 });
    const markets = await far.getMarkets(['nfl-2026-w1-sf-sea']);

    expect(markets[0].selections.find((s) => s.side === 'HOME')?.line).toBe('-4.50');
  });

  it('returns nothing for an unknown game', async () => {
    const provider = new FixtureOddsProvider();
    expect(await provider.getMarkets(['does-not-exist'])).toEqual([]);
  });
});

describe('FixtureScoreProvider', () => {
  it('finalizes at least four games in the first round', async () => {
    const provider = new FixtureScoreProvider();
    const results = await provider.getResults(allFixtureGameIds());

    const finals = results.filter((r) => r.status === 'FINAL');
    expect(finals.length).toBeGreaterThanOrEqual(4);
  });

  it('includes a postponement and a cancellation', async () => {
    const provider = new FixtureScoreProvider();
    const results = await provider.getResults(allFixtureGameIds());

    expect(results.some((r) => r.status === 'POSTPONED')).toBe(true);
    expect(results.some((r) => r.status === 'CANCELED')).toBe(true);
  });

  it('includes a tie, so a moneyline can push', async () => {
    const provider = new FixtureScoreProvider();
    const [tie] = await provider.getResults(['nfl-2026-w1-dal-phi']);

    expect(tie.homeScore).toBe(tie.awayScore);
  });

  it('corrects a score in a later round', async () => {
    const first = new FixtureScoreProvider({ round: 0 });
    const corrected = new FixtureScoreProvider({ round: 1 });

    const [before] = await first.getResults(['nfl-2026-w1-gb-chi']);
    const [after] = await corrected.getResults(['nfl-2026-w1-gb-chi']);

    expect(before.homeScore).toBe(17);
    expect(after.homeScore).toBe(24);
  });

  it('reports nothing for a game with no result yet', async () => {
    const provider = new FixtureScoreProvider();
    expect(await provider.getResults(['nfl-2026-w2-lar-ari'])).toEqual([]);
  });
});
