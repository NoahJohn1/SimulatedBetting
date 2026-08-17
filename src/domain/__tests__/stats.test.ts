import { describe, expect, it } from 'vitest';
import { computeMemberStats, type BetOutcomeRow } from '@/domain/stats';

const at = (iso: string) => new Date(iso);

function row(overrides: Partial<BetOutcomeRow> = {}): BetOutcomeRow {
  return {
    status: 'WON',
    stakeCents: 10_000n,
    payoutCents: 19_091n,
    settledAt: at('2026-09-06T20:00:00Z'),
    ...overrides,
  };
}

describe('computeMemberStats', () => {
  it('returns a zeroed shape for an empty history', () => {
    const stats = computeMemberStats([]);
    expect(stats.settled).toBe(0);
    expect(stats.netCents).toBe(0n);
    expect(stats.roiBasisPoints).toBeNull();
    expect(stats.currentStreak).toEqual({ kind: 'NONE', length: 0 });
    expect(stats.biggestWinCents).toBe(0n);
  });

  it('counts pending bets separately and never as action', () => {
    const stats = computeMemberStats([
      row({ status: 'PENDING', payoutCents: 0n, settledAt: null }),
    ]);
    expect(stats.pending).toBe(1);
    expect(stats.pendingStakeCents).toBe(10_000n);
    expect(stats.settled).toBe(0);
    expect(stats.stakedCents).toBe(0n);
    expect(stats.roiBasisPoints).toBeNull();
  });

  it('nets a win against a loss', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', stakeCents: 10_000n, payoutCents: 19_091n }),
      row({ status: 'LOST', stakeCents: 10_000n, payoutCents: 0n }),
    ]);
    expect(stats.won).toBe(1);
    expect(stats.lost).toBe(1);
    expect(stats.stakedCents).toBe(20_000n);
    expect(stats.returnedCents).toBe(19_091n);
    expect(stats.netCents).toBe(-909n);
    // -909 × 10000 / 20000 = -454 basis points = -4.54%
    expect(stats.roiBasisPoints).toBe(-454);
  });

  it('counts a push in both staked and returned, leaving ROI unmoved', () => {
    const stats = computeMemberStats([
      row({ status: 'PUSHED', stakeCents: 10_000n, payoutCents: 10_000n }),
    ]);
    expect(stats.pushed).toBe(1);
    expect(stats.stakedCents).toBe(10_000n);
    expect(stats.returnedCents).toBe(10_000n);
    expect(stats.roiBasisPoints).toBe(0);
  });

  it('excludes a voided bet from staked entirely', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', stakeCents: 10_000n, payoutCents: 20_000n }),
      row({ status: 'VOIDED', stakeCents: 90_000n, payoutCents: 90_000n }),
    ]);
    expect(stats.voided).toBe(1);
    // The void never happened as far as ROI is concerned: 10000 net on 10000 staked.
    expect(stats.stakedCents).toBe(10_000n);
    expect(stats.netCents).toBe(10_000n);
    expect(stats.roiBasisPoints).toBe(10_000);
  });

  it('breaks a streak on a loss but not on a push', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', settledAt: at('2026-09-01T20:00:00Z') }),
      row({ status: 'WON', settledAt: at('2026-09-02T20:00:00Z') }),
      row({ status: 'PUSHED', payoutCents: 10_000n, settledAt: at('2026-09-03T20:00:00Z') }),
      row({ status: 'WON', settledAt: at('2026-09-04T20:00:00Z') }),
    ]);
    expect(stats.currentStreak).toEqual({ kind: 'W', length: 3 });
  });

  it('reports a losing streak from the most recent settlement backward', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', settledAt: at('2026-09-01T20:00:00Z') }),
      row({ status: 'LOST', payoutCents: 0n, settledAt: at('2026-09-02T20:00:00Z') }),
      row({ status: 'LOST', payoutCents: 0n, settledAt: at('2026-09-03T20:00:00Z') }),
    ]);
    expect(stats.currentStreak).toEqual({ kind: 'L', length: 2 });
  });

  it('takes the biggest win as net profit, not gross payout', () => {
    const stats = computeMemberStats([
      row({ status: 'WON', stakeCents: 100_000n, payoutCents: 120_000n }), // +20,000
      row({ status: 'WON', stakeCents: 1_000n, payoutCents: 51_000n }), //   +50,000
    ]);
    expect(stats.biggestWinCents).toBe(50_000n);
  });

  it('does not depend on input order when computing streaks', () => {
    const rows = [
      row({ status: 'LOST', payoutCents: 0n, settledAt: at('2026-09-03T20:00:00Z') }),
      row({ status: 'WON', settledAt: at('2026-09-01T20:00:00Z') }),
      row({ status: 'LOST', payoutCents: 0n, settledAt: at('2026-09-02T20:00:00Z') }),
    ];
    expect(computeMemberStats(rows).currentStreak).toEqual({ kind: 'L', length: 2 });
  });
});
