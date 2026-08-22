'use client';

// Only catches errors thrown by the root layout itself, which is why it renders its own
// <html>/<body> rather than relying on layout.tsx — that layout is what would have thrown.
// Kept dependency-free (no Tailwind classes) since the app's own CSS may be what failed to
// load in the first place.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '0 1.5rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: '0.75rem', maxWidth: '24rem', fontSize: '0.875rem', color: '#71717a' }}>
            That&rsquo;s on us, not on you. Nothing was lost.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{ fontSize: '0.875rem', fontWeight: 500, color: '#71717a', textDecoration: 'underline' }}
          >
            Try again
          </button>
          {/* Plain anchor, not next/link: this file replaces the root layout, which is what
              just threw, so it deliberately doesn't lean on more of the app's own runtime
              than a raw browser navigation needs. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{ fontSize: '0.875rem', fontWeight: 500, color: '#71717a', textDecoration: 'underline' }}
          >
            Back home
          </a>
        </div>
      </body>
    </html>
  );
}
