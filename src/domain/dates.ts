const ET = 'America/New_York';
const opt = (o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({ timeZone: ET, ...o });

export function formatDayHeading(d: Date): string {
  return d.toLocaleDateString('en-US', opt({ weekday: 'long', month: 'short', day: 'numeric' }));
}

export function formatKickoff(d: Date): string {
  return `${d.toLocaleTimeString('en-US', opt({ hour: 'numeric', minute: '2-digit' }))} ET`;
}

export function formatDateTime(d: Date, now: Date = new Date()): string {
  const sameYear =
    d.toLocaleDateString('en-US', opt({ year: 'numeric' })) ===
    now.toLocaleDateString('en-US', opt({ year: 'numeric' }));
  const date = d.toLocaleDateString(
    'en-US',
    opt({ month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }),
  );
  return `${date}, ${formatKickoff(d)}`;
}
