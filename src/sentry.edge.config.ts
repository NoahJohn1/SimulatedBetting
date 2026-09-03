import * as Sentry from '@sentry/nextjs';

/**
 * Guarded on a DSN being present, deliberately (D62). Absent, `init` is never called, every
 * `Sentry.capture*` is a no-op, and CI, the test suite and local development report nothing
 * with no configuration at all. That is what lets this wiring merge before the signup exists.
 */
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Four users generate no performance question worth the free tier's quota.
    tracesSampleRate: 0,
  });
}
