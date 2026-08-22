const LINE_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * ESPN's line strings carry markers `normalizeLine` doesn't accept: a leading `+` on
 * positive spreads, and a leading `o`/`u` on totals. Both are stripped here so the result
 * always matches `normalizeLine`'s pattern before it reaches `syncOdds`.
 *
 * ESPN also reports the literal string "OFF" when a book has pulled a market (common on
 * lopsided games) instead of a number — that isn't a line at all, so it must throw here
 * rather than pass through, so the per-market try/catch in `mapMarkets` catches it instead
 * of it surviving to crash `normalizeLine` in a completely different file.
 */
export function parseLine(raw: string): string {
  const stripped = raw.replace(/^[ou]/, '').replace(/^\+/, '');
  if (!LINE_PATTERN.test(stripped)) {
    throw new Error(`Unparseable ESPN line: ${JSON.stringify(raw)}`);
  }
  return stripped;
}
