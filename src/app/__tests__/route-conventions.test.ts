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

describe('error and not-found boundaries', () => {
  it('exist inside the app shell and the admin section, not only at the root', () => {
    expect(existsSync(join(APP, '(app)', 'error.tsx'))).toBe(true);
    expect(existsSync(join(APP, '(app)', 'not-found.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'admin', 'error.tsx'))).toBe(true);
  });

  it('keeps the root boundaries, which catch layout failures the shell ones cannot', () => {
    expect(existsSync(join(APP, 'error.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'global-error.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'not-found.tsx'))).toBe(true);
  });

  /**
   * The assertion that earns its keep. The others describe the tree as it stands; this one
   * constrains routes that do not exist yet. Note it deliberately stops the upward walk at
   * the section root — the root not-found.tsx would satisfy every page trivially and prove
   * nothing, because landing there means the shell was destroyed.
   */
  it('gives every notFound() caller a boundary inside its own section', () => {
    const SECTION_ROOTS = ['(app)', 'admin'];

    const callers = walk(APP)
      .filter((f) => f.endsWith('page.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes('notFound()'));

    expect(callers.length).toBeGreaterThan(0);

    for (const page of callers) {
      const section = SECTION_ROOTS.find((root) =>
        page.startsWith(join(APP, root) + '/'),
      );
      expect(section, `${page} is outside (app) and admin; extend SECTION_ROOTS`).toBeDefined();

      const stopAt = join(APP, section!);
      let dir = join(page, '..');
      let found = false;
      while (dir.length >= stopAt.length) {
        if (existsSync(join(dir, 'not-found.tsx'))) {
          found = true;
          break;
        }
        if (dir === stopAt) break;
        dir = join(dir, '..');
      }

      expect(found, `${page} calls notFound() with no boundary inside ${section}`).toBe(true);
    }
  });
});
