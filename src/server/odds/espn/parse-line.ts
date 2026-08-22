/**
 * ESPN's line strings carry markers `normalizeLine` doesn't accept: a leading `+` on
 * positive spreads, and a leading `o`/`u` on totals. Both are stripped here so the result
 * always matches `normalizeLine`'s pattern before it reaches `syncOdds`.
 */
export function parseLine(raw: string): string {
  return raw.replace(/^[ou]/, '').replace(/^\+/, '');
}
