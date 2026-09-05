import type { FeedLegSnapshot } from './payload';

/**
 * One line naming what a leg was, for an email subject or body. Lifted out of the two
 * settlement paths rather than copied into both — two copies of a formatting rule is how they
 * drift, and a correction email that describes a bet differently from the original is a bug
 * somebody will report as "it emailed me about the wrong bet".
 *
 * The feed card renders its own richer version from the same snapshot; this is the plain-text
 * one, because an email body has no components.
 */
export function describeLeg(leg: FeedLegSnapshot): string {
  if (leg.kind === 'GAME') {
    const line = leg.line ? ` ${leg.line}` : '';
    return `${leg.awayAbbr} @ ${leg.homeAbbr} — ${leg.marketType} ${leg.side}${line}`;
  }
  return `${leg.eventTitle} — ${leg.outcomeLabel}`;
}

/** What a whole bet is called in an email: the leg, or the leg count. */
export function describeBet(legs: FeedLegSnapshot[]): string {
  if (legs.length === 0) return 'a bet';
  return legs.length === 1 ? describeLeg(legs[0]) : `${legs.length}-leg parlay`;
}
