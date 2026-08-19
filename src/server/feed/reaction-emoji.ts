/**
 * Client-safe constants for feed reactions and comments — no I/O, no `db` import.
 *
 * Kept separate from social.ts on purpose: that file imports `db`, and a client component
 * that imports anything from it (even a plain constant) pulls the Postgres client into the
 * browser bundle. `npm run build` fails on exactly that.
 */

/**
 * Six, fixed, in this order everywhere.
 *
 * An open emoji field means an unbounded GROUP BY per card, a legend nobody can read, and a
 * picker on a phone. Six covers celebration, mockery and respect, which is the entire
 * emotional range of a betting group chat.
 */
export const REACTION_EMOJI = ['🔥', '😂', '💀', '🤝', '🎯', '🤡'] as const;

export const MAX_COMMENT_LENGTH = 500;

export type FeedErrorCode =
  | 'EMOJI_NOT_ALLOWED'
  | 'EVENT_NOT_FOUND'
  | 'WRONG_SEASON'
  | 'COMMENT_EMPTY'
  | 'COMMENT_TOO_LONG'
  | 'COMMENT_NOT_FOUND'
  | 'NOT_ALLOWED';

export class FeedError extends Error {
  constructor(readonly code: FeedErrorCode) {
    super(code);
    this.name = 'FeedError';
  }
}

export function isAllowedEmoji(emoji: string): boolean {
  return (REACTION_EMOJI as readonly string[]).includes(emoji);
}
