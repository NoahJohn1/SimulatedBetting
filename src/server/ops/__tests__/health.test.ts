import { describe, expect, it } from 'vitest';
import { cronStaleness, formatAge, STALE_AFTER_MS } from '@/server/ops/health';

const now = new Date('2026-09-02T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('cronStaleness', () => {
  it('is never-run when nothing has succeeded', () => {
    expect(cronStaleness('SETTLE', null, now)).toBe('never-run');
  });

  it.each([
    ['SYNC_ODDS', 45 * 60_000],
    ['SETTLE', 30 * 60_000],
    ['RECONCILE', 26 * 60 * 60_000],
    ['ALLOWANCE', 8 * 24 * 60 * 60_000],
  ] as const)('%s goes stale after %i ms', (job, threshold) => {
    expect(STALE_AFTER_MS[job]).toBe(threshold);
    expect(cronStaleness(job, ago(threshold), now)).toBe('fresh');
    expect(cronStaleness(job, ago(threshold + 1), now)).toBe('stale');
  });

  it('treats a future timestamp as fresh rather than as an error', () => {
    expect(cronStaleness('SETTLE', new Date(now.getTime() + 60_000), now)).toBe('fresh');
  });
});

describe('formatAge', () => {
  it.each([
    [0, 'just now'],
    [45_000, 'just now'],
    [60_000, '1 min ago'],
    [17 * 60_000, '17 min ago'],
    [60 * 60_000, '1 hr ago'],
    [5 * 60 * 60_000 + 30 * 60_000, '5 hr ago'],
    [26 * 60 * 60_000, '1 day ago'],
    [9 * 24 * 60 * 60_000, '9 days ago'],
  ])('renders %i ms as "%s"', (ms, expected) => {
    expect(formatAge(ms)).toBe(expected);
  });
});
