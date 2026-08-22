import { ImageResponse } from 'next/og';

/**
 * A wordmark generated in code rather than a checked-in binary: it reviews as a diff, and
 * 7b can replace it the moment there is an actual brand. Two sizes because a web manifest
 * wants 192 and 512 for a home-screen install.
 */
export function generateImageMetadata() {
  return [
    { id: '192', contentType: 'image/png', size: { width: 192, height: 192 }, alt: 'SimulatedBetting' },
    { id: '512', contentType: 'image/png', size: { width: 512, height: 512 }, alt: 'SimulatedBetting' },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const side = Number(await id);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#fafafa',
          fontSize: side * 0.44,
          fontWeight: 700,
          letterSpacing: side * -0.02,
        }}
      >
        SB
      </div>
    ),
    { width: side, height: side },
  );
}
