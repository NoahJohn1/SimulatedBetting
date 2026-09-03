import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {/* config options here */};

// Source-map upload needs SENTRY_AUTH_TOKEN. Without it the plugin warns and skips, which is
// the state of CI and of every cloud session — see the spec's §11.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  disableLogger: true,
});
