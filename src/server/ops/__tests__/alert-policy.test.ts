import { describe, expect, it } from 'vitest';
import { REALERT_AFTER_MS, shouldAlert } from '@/server/ops/alert-policy';

const now = new Date('2026-09-02T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('shouldAlert', () => {
  it('alerts on the first recorded failure', () => {
    expect(shouldAlert({ previousOk: null, lastAlertedAt: null, ok: false, now })).toBe(true);
  });

  it('alerts when a healthy job starts failing', () => {
    expect(shouldAlert({ previousOk: true, lastAlertedAt: null, ok: false, now })).toBe(true);
  });

  it('stays quiet while a job keeps failing', () => {
    expect(
      shouldAlert({ previousOk: false, lastAlertedAt: ago(10 * 60_000), ok: false, now }),
    ).toBe(false);
  });

  it('re-alerts once the quiet period has elapsed', () => {
    expect(
      shouldAlert({ previousOk: false, lastAlertedAt: ago(REALERT_AFTER_MS), ok: false, now }),
    ).toBe(true);
  });

  it('stays quiet one millisecond before the quiet period elapses', () => {
    expect(
      shouldAlert({ previousOk: false, lastAlertedAt: ago(REALERT_AFTER_MS - 1), ok: false, now }),
    ).toBe(false);
  });

  it('alerts if it is failing and has somehow never alerted', () => {
    expect(shouldAlert({ previousOk: false, lastAlertedAt: null, ok: false, now })).toBe(true);
  });

  it('sends one recovery notice on the first success after a failure', () => {
    expect(shouldAlert({ previousOk: false, lastAlertedAt: ago(60_000), ok: true, now })).toBe(
      true,
    );
  });

  it('says nothing about a success that follows a success', () => {
    expect(shouldAlert({ previousOk: true, lastAlertedAt: null, ok: true, now })).toBe(false);
  });

  it('says nothing about the very first run when it succeeds', () => {
    expect(shouldAlert({ previousOk: null, lastAlertedAt: null, ok: true, now })).toBe(false);
  });
});
