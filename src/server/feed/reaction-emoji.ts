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

/**
 * A screen reader's built-in emoji names are inconsistent across platforms (VoiceOver says
 * "fire", NVDA says "fire, red"). `ReactionPicker` (Task 19) uses these instead so a chip's
 * `aria-label` reads the same word everywhere, e.g. "Fire reaction, 3, yours".
 */
export const REACTION_LABEL: Record<(typeof REACTION_EMOJI)[number], string> = {
  '🔥': 'Fire',
  '😂': 'Laughing',
  '💀': 'Skull',
  '🤝': 'Handshake',
  '🎯': 'Bullseye',
  '🤡': 'Clown',
};

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

/** `REACTION_LABEL` lookup for a DB-typed (plain `string`) emoji; the emoji itself if unknown. */
export function reactionLabel(emoji: string): string {
  return (REACTION_LABEL as Record<string, string>)[emoji] ?? emoji;
}
