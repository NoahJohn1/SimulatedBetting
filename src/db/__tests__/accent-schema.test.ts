import { beforeEach, describe, expect, it } from 'vitest';
import { ACCENT_VALUES } from '@/db/schema';
import { makeUser } from '@/test/factories';
import { resetDb } from '@/test/db';

/**
 * The accent picker's column (Task 18, D75). Green is the default so every existing member —
 * and every new one who never opens the picker — renders exactly what 7c already shipped for
 * everyone.
 */
describe('accent schema', () => {
  beforeEach(resetDb);

  it('defaults a new user to GREEN', async () => {
    const user = await makeUser();
    expect(user.accent).toBe('GREEN');
  });

  it('accepts each of the six curated hues', async () => {
    for (const value of ACCENT_VALUES) {
      const user = await makeUser({ accent: value });
      expect(user.accent).toBe(value);
    }
  });

  it('rejects a hue outside the curated six', async () => {
    await expect(
      makeUser({ accent: 'MAGENTA' as unknown as (typeof ACCENT_VALUES)[number] }),
    ).rejects.toThrow();
  });
});
