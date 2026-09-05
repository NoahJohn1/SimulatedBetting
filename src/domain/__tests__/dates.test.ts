import { describe, expect, it } from 'vitest';
import { formatDayHeading, formatKickoff, formatDateTime } from '@/domain/dates';

const kickoff = new Date('2026-09-05T16:00:00Z'); // noon ET

describe('dates', () => {
  it('formats a day heading', () => {
    expect(formatDayHeading(kickoff)).toBe('Saturday, Sep 5');
  });
  it('formats a kickoff time', () => {
    expect(formatKickoff(kickoff)).toBe('12:00 PM ET');
  });
  it('omits the year when it matches now', () => {
    expect(formatDateTime(kickoff, new Date('2026-09-01T00:00:00Z'))).toBe('Sep 5, 12:00 PM ET');
  });
  it('includes the year when it differs', () => {
    expect(formatDateTime(kickoff, new Date('2027-06-01T00:00:00Z'))).toBe(
      'Sep 5, 2026, 12:00 PM ET',
    );
  });
  it('includes the year at ET boundary', () => {
    expect(formatDateTime(new Date('2026-01-01T02:00:00Z'), new Date('2026-06-01T00:00:00Z'))).toBe(
      'Dec 31, 2025, 9:00 PM ET',
    );
  });
});
