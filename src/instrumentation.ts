import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * The one hook that covers server components, route handlers AND server actions. This app's
 * dangerous code is almost entirely server actions — placeBet, resolveEvent, the arbitration
 * forms — so a wiring that missed them would miss the point.
 */
export const onRequestError = Sentry.captureRequestError;
