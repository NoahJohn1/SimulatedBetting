import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  // The two values already defined in globals.css, so browser chrome stops fighting
  // the app's background.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
