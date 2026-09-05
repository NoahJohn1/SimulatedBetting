import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every mutation carries a rate limit (D69). That could have been a code-review habit, so it is
 * a test instead — repo-health 3.2's layering rule, applied without being asked.
 *
 * Two populations, because one alone is a trap. Searching only for exported `*Action` functions
 * would have missed every inline `'use server'` block in a page file — including `/admin`'s
 * `setStatus`, which approves and disables members. A green test that leaves the app's most
 * consequential mutation unlimited is worse than a red one.
 *
 * Known coarseness: the inline half exempts by FILE, not by action. A page listed in UNLIMITED
 * for its sign-out form would also carry a new mutating inline action past this check. That is
 * the price of matching source text rather than parsing it, and the reason to put new mutations
 * in an actions.ts file where the first assertion sees them.
 */

const APP = join(process.cwd(), 'src', 'app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Deliberately not limited. Each entry names why — an addition here is a decision, and the
 * length assertion below makes it a visible one.
 */
const UNLIMITED = [
  // Paginates the feed. Writes nothing.
  'loadMoreFeedAction',
  // End a session. Touch neither the ledger nor the feed.
  'signOut@me',
  'signOut@pending',
  'signOut@no-season',
  'signOut@disabled',
  // Runs before there is a session, so there is no subject to key on. Google and NextAuth own
  // the rate of sign-in attempts (spec §2.4).
  'signIn@sign-in',
];

describe('every mutating server action consumes a rate-limit bucket', () => {
  const files = walk(APP)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !f.includes('__tests__'))
    .map((f) => ({ path: f, source: readFileSync(f, 'utf8') }))
    .filter((f) => f.source.includes("'use server'"));

  it('finds the action surface it is supposed to be checking', () => {
    // Guards against the whole suite passing because the walk stopped finding files.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('limits every exported *Action function', () => {
    const offenders: string[] = [];

    for (const { path, source } of files) {
      const names = [...source.matchAll(/export async function (\w*Action)\b/g)].map((m) => m[1]);
      for (const name of names) {
        if (UNLIMITED.includes(name)) continue;
        const body = source.slice(source.indexOf(`export async function ${name}`));
        const end = body.indexOf('\nexport ', 1);
        const scoped = end === -1 ? body : body.slice(0, end);
        if (!scoped.includes('consume(')) {
          offenders.push(`${path.replace(process.cwd(), '')} → ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('limits every inline use-server block in a page file', () => {
    const offenders: string[] = [];

    for (const { path, source } of files) {
      if (!path.endsWith('page.tsx')) continue;
      const inlineBlocks = source.split("'use server'").length - 1;
      if (inlineBlocks === 0) continue;

      const exempt = UNLIMITED.filter((e) => e.includes('@')).some((e) =>
        path.includes(`/${e.split('@')[1]}/`),
      );
      if (exempt) continue;

      if (!source.includes('consume(')) {
        offenders.push(path.replace(process.cwd(), ''));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the exemption list a deliberate edit', () => {
    expect(UNLIMITED).toHaveLength(6);
  });
});
