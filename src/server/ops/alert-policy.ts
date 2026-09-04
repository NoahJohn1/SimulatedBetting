/**
 * When a job outcome is worth announcing (D60).
 *
 * `settle` runs every ten minutes. Alerting on every failing run is 144 identical messages a
 * day, and the reliable outcome of an alarm that cries constantly is that somebody mutes the
 * channel — at which point the money alarm is off and nobody decided to turn it off.
 *
 * Deliberately a pure function with no imports at all. It is the piece of this subsystem most
 * likely to be wrong and the only piece a cloud session can prove, and nothing in its import
 * graph should need a database.
 */

export const REALERT_AFTER_MS = 6 * 60 * 60 * 1_000;

export interface AlertDecision {
  /** Whether the previous *finished* run of this job was clean. `null` if there wasn't one. */
  previousOk: boolean | null;
  /** When this job last raised an alert. `null` if it never has. */
  lastAlertedAt: Date | null;
  /** Whether the run being recorded right now is clean. */
  ok: boolean;
  now: Date;
}

export function shouldAlert({ previousOk, lastAlertedAt, ok, now }: AlertDecision): boolean {
  // A success is worth announcing only as a recovery — the first one after a failure.
  if (ok) return previousOk === false;

  // A failure that follows a success, or the first run on record, is the transition.
  if (previousOk === null || previousOk) return true;

  // Still failing. Quiet, unless it has been quiet long enough that a reminder is warranted.
  if (lastAlertedAt === null) return true;
  return now.getTime() - lastAlertedAt.getTime() >= REALERT_AFTER_MS;
}
