// Mirrors normalizeLine's pattern (src/domain/line.ts) exactly — at most 2 decimal places —
// so a value this function accepts can never throw one file downstream in normalizeLine.
const LINE_PATTERN = /^-?\d+(\.\d{1,2})?$/;
// selections.line is numeric(5,2): 3 integer digits max, so anything >= 1000 in magnitude
// would overflow the column at insert time, outside every try/catch in this feature.
const MAX_LINE_MAGNITUDE = 1000;

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
  if (Math.abs(Number(stripped)) >= MAX_LINE_MAGNITUDE) {
    throw new Error(`ESPN line out of range for storage: ${JSON.stringify(raw)}`);
  }
  return stripped;
}
