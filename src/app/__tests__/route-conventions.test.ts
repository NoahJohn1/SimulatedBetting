import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural assertions over the route tree. There is no jsdom in this project and no
 * component-test harness (D51), so what these tests can check is which files exist and
 * what they contain as text. That is coarse, and deliberately so — the job is to fail
 * loudly when a route is added without a boundary, not to prove the boundaries are pretty.
 */

const APP = join(process.cwd(), 'src', 'app');
const COMPONENTS = join(process.cwd(), 'src', 'components');

/** Every file beneath `dir`, recursively, as absolute paths. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('shared status components', () => {
  it('exist for the boundaries to render', () => {
    expect(existsSync(join(COMPONENTS, 'ui', 'status-screen.tsx'))).toBe(true);
    expect(existsSync(join(COMPONENTS, 'ui', 'loading-screen.tsx'))).toBe(true);
  });

  it('are shared rather than duplicated: every boundary file delegates to one of them', () => {
    const boundaries = walk(APP).filter((f) =>
      /(?:^|\/)(error|not-found|loading)\.tsx$/.test(f),
    );
    expect(boundaries.length).toBeGreaterThan(0);

    for (const file of boundaries) {
      const source = readFileSync(file, 'utf8');
      expect(
        source.includes('@/components/ui/status-screen') ||
          source.includes('@/components/ui/loading-screen'),
        `${file} should render a shared status component rather than its own markup`,
      ).toBe(true);
    }
  });
});
