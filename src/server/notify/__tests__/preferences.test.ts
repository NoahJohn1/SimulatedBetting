import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import {
  disableAllEmail,
  getManyNotificationPreferences,
  getNotificationPreferences,
  isSuppressed,
  muteType,
  setNotificationPreferences,
} from '@/server/notify/preferences';
import { resetDb } from '@/test/db';

async function aUser(email = 'a@example.com') {
  const [row] = await db
    .insert(users)
    .values({ provider: 'GOOGLE', providerAccountId: email, email, displayName: 'A' })
    .returning({ id: users.id });
  return row.id;
}

beforeEach(resetDb);

describe('getNotificationPreferences', () => {
  it('defaults to everything on when no row exists — opt-out by default (D50)', async () => {
    const userId = await aUser();
    expect(await getNotificationPreferences(userId)).toEqual({
      mutedTypes: [],
      emailsEnabled: true,
    });
  });
});

describe('getManyNotificationPreferences', () => {
  it('returns a default for every id asked about, row or no row', async () => {
    const a = await aUser('a@example.com');
    const b = await aUser('b@example.com');
    await setNotificationPreferences(a, { mutedTypes: ['BETS_SETTLED'], emailsEnabled: true });

    const map = await getManyNotificationPreferences([a, b]);

    expect(map.get(a)).toEqual({ mutedTypes: ['BETS_SETTLED'], emailsEnabled: true });
    expect(map.get(b)).toEqual({ mutedTypes: [], emailsEnabled: true });
  });

  it('is empty for an empty request rather than querying', async () => {
    expect((await getManyNotificationPreferences([])).size).toBe(0);
  });
});

describe('setNotificationPreferences', () => {
  it('upserts, so the first save needs no pre-existing row', async () => {
    const userId = await aUser();

    await setNotificationPreferences(userId, {
      mutedTypes: ['BETS_SETTLED', 'BETS_SETTLED'],
      emailsEnabled: false,
    });

    const prefs = await getNotificationPreferences(userId);
    // De-duplicated, because the read filter treats the array as a set.
    expect(prefs.mutedTypes).toEqual(['BETS_SETTLED']);
    expect(prefs.emailsEnabled).toBe(false);
  });
});

describe('muteType and disableAllEmail', () => {
  it('adds one type without disturbing the others', async () => {
    const userId = await aUser();
    await muteType(userId, 'WAGER_OFFERED');
    await muteType(userId, 'ALLOWANCE_PAID');
    await muteType(userId, 'WAGER_OFFERED');

    const prefs = await getNotificationPreferences(userId);
    expect([...prefs.mutedTypes].sort()).toEqual(['ALLOWANCE_PAID', 'WAGER_OFFERED']);
    expect(prefs.emailsEnabled).toBe(true);
  });

  it('turns everything off without listing the types, so turning it back on restores them', async () => {
    const userId = await aUser();
    await muteType(userId, 'WAGER_OFFERED');
    await disableAllEmail(userId);

    const prefs = await getNotificationPreferences(userId);
    expect(prefs.emailsEnabled).toBe(false);
    expect(prefs.mutedTypes).toEqual(['WAGER_OFFERED']);
  });
});

describe('isSuppressed', () => {
  it('suppresses a muted type', () => {
    expect(
      isSuppressed({ mutedTypes: ['BETS_SETTLED'], emailsEnabled: true }, 'BETS_SETTLED'),
    ).toBe(true);
  });

  it('suppresses every type when email is off entirely', () => {
    expect(isSuppressed({ mutedTypes: [], emailsEnabled: false }, 'ACCOUNT_APPROVED')).toBe(true);
  });

  it('passes an unmuted type', () => {
    expect(
      isSuppressed({ mutedTypes: ['BETS_SETTLED'], emailsEnabled: true }, 'WAGER_OFFERED'),
    ).toBe(false);
  });
});
