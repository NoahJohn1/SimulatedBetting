import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SimulatedBetting',
    short_name: 'SimBet',
    description:
      'A play-money sportsbook for a small private group. No real money is involved at any point.',
    // "/" only redirects here; this is the real front door.
    start_url: '/games',
    display: 'standalone',
    // Matches the viewport theme colors in layout.tsx.
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
