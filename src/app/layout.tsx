import { eq } from 'drizzle-orm';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getSessionUser } from '@/server/auth/session';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Set on the deployment; localhost is the local fallback. Phase 6 supplies the real value.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    // Pages export a short title; this appends the app name once, in one place.
    default: 'SimulatedBetting',
    template: '%s · SimulatedBetting',
  },
  description:
    'A play-money sportsbook for a small private group. No real money is involved at any point.',
  applicationName: 'SimulatedBetting',
  appleWebApp: { capable: true, title: 'SimulatedBetting', statusBarStyle: 'default' },
  // A private group behind Google OAuth. Requiring auth on every route is not a reason
  // to skip telling crawlers to stay away.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The tab bar is fixed to the bottom; a notched phone needs the whole screen.
  viewportFit: 'cover',
  // The two --surface values from globals.css, as literal hex: browser chrome is painted
  // before any stylesheet is parsed, so it cannot read a CSS variable.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

/**
 * The dark-mode toggle (Task 17, D75). `theme` is a device cookie, not an account column —
 * "System" is represented by the cookie's absence (or any value other than `light`/`dark`),
 * which is why this returns `undefined` rather than a third literal: React drops a JSX
 * attribute entirely when its value is `undefined`, so System renders `<html>` with no
 * `data-theme` at all, exactly what the `[data-theme]` selectors in globals.css (7b) already
 * expect — the plain `prefers-color-scheme` media query handles System on its own.
 */
function readThemeCookie(value: string | undefined): 'light' | 'dark' | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const cookieStore = await cookies();
  const theme = readThemeCookie(cookieStore.get('theme')?.value);

  // The accent picker (Task 18, D75) is account-level, not a device cookie, so it needs the
  // signed-in user's row — nothing above this reads one yet, since this layout wraps signed-out
  // routes too (sign-in, pending, disabled…), so a narrow select here is the query, not a reuse
  // of one from further down the tree. Signed-out pages get no attribute at all, which is
  // exactly the green default globals.css already renders for that case.
  const sessionUser = await getSessionUser();
  let accent: string | undefined;
  if (sessionUser) {
    const [row] = await db
      .select({ accent: users.accent })
      .from(users)
      .where(eq(users.id, sessionUser.id));
    accent = row?.accent.toLowerCase();
  }

  return (
    <html
      lang="en"
      data-theme={theme}
      data-accent={accent}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
