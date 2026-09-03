import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { seasons } from '@/db/schema';
import { activateSeason } from '@/server/seasons/activate';
import { resetDb } from '@/test/db';
import { makeSeason } from '@/test/factories';

beforeEach(async () => {
  await resetDb();
});

describe('activateSeason', () => {
  it('activates an upcoming season when nothing else is active', async () => {
    const season = await makeSeason();

    expect(await activateSeason(season.id)).toEqual({ ok: true });

    const [after] = await db.select().from(seasons).where(eq(seasons.id, season.id));
    expect(after.status).toBe('ACTIVE');
  });

  it('refuses while another season is active, and names it', async () => {
    await makeSeason({ name: 'Last year', status: 'ACTIVE' });
    const next = await makeSeason({ name: 'This year' });

    expect(await activateSeason(next.id)).toEqual({
      ok: false,
      code: 'ALREADY_ACTIVE',
      blockingSeasonName: 'Last year',
    });

    const [after] = await db.select().from(seasons).where(eq(seasons.id, next.id));
    expect(after.status).toBe('UPCOMING');
  });

  it('is a no-op on a season that is already active', async () => {
    const season = await makeSeason({ status: 'ACTIVE' });
    expect(await activateSeason(season.id)).toEqual({ ok: true });
  });

  it('reports a season that does not exist', async () => {
    expect(await activateSeason('00000000-0000-0000-0000-000000000000')).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});
