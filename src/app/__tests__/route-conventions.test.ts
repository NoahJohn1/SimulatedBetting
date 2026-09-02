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

/**
 * A loading.tsx covers its segment and everything nested below it, so these eight cover all
 * eighteen pages. Adding one per segment instead would produce a dozen identical files that
 * no navigation ever crosses.
 */
const FEATURE_SEGMENTS = [
  join('(app)', 'games'),
  join('(app)', 'events'),
  join('(app)', 'feed'),
  join('(app)', 'bets'),
  join('(app)', 'wagers'),
  join('(app)', 'standings'),
  join('(app)', 'me'),
  'admin',
];

describe('loading boundaries', () => {
  it.each(FEATURE_SEGMENTS)('%s has one', (segment) => {
    expect(existsSync(join(APP, segment, 'loading.tsx'))).toBe(true);
  });

  it('covers every page in the app', () => {
    const uncovered = walk(APP)
      .filter((f) => f.endsWith('page.tsx'))
      .filter((page) => !FEATURE_SEGMENTS.some((s) => page.startsWith(join(APP, s) + '/')))
      // Routes outside the two sections are standalone states with no shell and no
      // meaningful load: /, /sign-in, /join, /pending, /disabled, /no-season, and the
      // one member-profile route that has no feature segment of its own.
      .filter((page) => page.startsWith(join(APP, '(app)') + '/'));

    expect(uncovered.map((f) => f.replace(APP, ''))).toEqual([
      join('/(app)', 'members', '[membershipId]', 'page.tsx'),
    ]);
  });
});

describe('metadata', () => {
  const layout = () => readFileSync(join(APP, 'layout.tsx'), 'utf8');

  it('no longer reports the app as a create-next-app scaffold', () => {
    expect(layout()).not.toContain('Create Next App');
    expect(layout()).not.toContain('Generated by create next app');
  });

  it('names the app and keeps it out of search indexes', () => {
    expect(layout()).toContain('SimulatedBetting');
    // A private group behind Google OAuth has no business in an index, and every route
    // requiring auth is not a reason to skip saying so.
    expect(layout()).toContain('index: false');
  });

  it('exports viewport separately from metadata, as Next 16 requires', () => {
    expect(layout()).toMatch(/export const viewport: Viewport/);
    expect(layout()).toContain("width: 'device-width'");
    // The tab bar is fixed to the bottom, so a notched phone needs the full screen.
    expect(layout()).toContain("viewportFit: 'cover'");
  });

  const TITLED_PAGES = [
    join('(app)', 'games'),
    join('(app)', 'events'),
    join('(app)', 'feed'),
    join('(app)', 'bets'),
    join('(app)', 'wagers'),
    join('(app)', 'standings'),
    join('(app)', 'me'),
    'admin',
  ];

  it.each(TITLED_PAGES)('%s exports its own title', (segment) => {
    const source = readFileSync(join(APP, segment, 'page.tsx'), 'utf8');
    expect(source).toMatch(/export const metadata: Metadata = \{\s*title:/);
  });
});

describe('icons and manifest', () => {
  it('generates its icons in code', () => {
    expect(existsSync(join(APP, 'icon.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'apple-icon.tsx'))).toBe(true);
  });

  it('has no favicon.ico, which would outrank the generated icon', () => {
    expect(existsSync(join(APP, 'favicon.ico'))).toBe(false);
  });

  it('ships a web manifest so the app installs to a home screen', () => {
    const manifest = join(APP, 'manifest.ts');
    expect(existsSync(manifest)).toBe(true);
    const source = readFileSync(manifest, 'utf8');
    expect(source).toContain("display: 'standalone'");
    // "/" only redirects; /games is the real front door.
    expect(source).toContain("start_url: '/games'");
  });

  it('has none of the create-next-app scaffold assets left', () => {
    const publicDir = join(process.cwd(), 'public');
    const stock = ['file.svg', 'globe.svg', 'next.svg', 'vercel.svg', 'window.svg'];
    const remaining = stock.filter((f) => existsSync(join(publicDir, f)));
    expect(remaining).toEqual([]);
  });
});

describe('form pending states', () => {
  /**
   * A source-text assertion, and a coarse one — it can be defeated by a form that names its
   * flag something else. Its job is to fail when a form is added with no pending state at
   * all, which is the failure that actually happens. The twelve that exist were read
   * individually during the 7a design session.
   */
  it('every form that submits through a transition disables a control while it runs', () => {
    const roots = [APP, COMPONENTS];
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of walk(root)) {
        if (!file.endsWith('.tsx')) continue;
        const source = readFileSync(file, 'utf8');
        if (!source.includes('useTransition')) continue;
        if (!/disabled=\{[^}]*pending/.test(source)) {
          offenders.push(file.replace(process.cwd(), ''));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('covers the forms it is supposed to cover', () => {
    const withTransition = [APP, COMPONENTS]
      .flatMap((root) => walk(root))
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes('useTransition'));

    // Guards against the check silently passing because it stopped finding any forms.
    expect(withTransition.length).toBeGreaterThanOrEqual(12);
  });
});

describe('error boundary recovery', () => {
  it('uses retry(), which re-fetches, rather than reset(), which does not', () => {
    const boundaries = walk(APP).filter((f) => /(?:^|\/)(global-)?error\.tsx$/.test(f));
    expect(boundaries.length).toBeGreaterThanOrEqual(4);

    for (const file of boundaries) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} should offer retry()`).toContain('retry');
      expect(source, `${file} still uses reset(), which does not re-fetch`).not.toContain(
        'reset',
      );
    }
  });
});
