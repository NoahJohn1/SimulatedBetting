import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dark-mode toggle (Task 17) and the accent picker (Task 18, D75). There is no jsdom in
 * this project's node project and no component-test harness over the root layout (D51), so
 * what this checks is source text — the root layout is a server component that reads request
 * cookies and (for a signed-in user) the accent column, then stamps `data-theme`/`data-accent`
 * on `<html>` accordingly. Behaviour — the three OS/theme combinations, the six accents
 * rendering correctly — is a manual/browser check per the plan.
 */

const LAYOUT = join(process.cwd(), 'src', 'app', 'layout.tsx');
const ACTIONS = join(process.cwd(), 'src', 'app', '(app)', '(column)', 'me', 'actions.ts');
const FORM = join(process.cwd(), 'src', 'app', '(app)', '(column)', 'me', 'appearance-form.tsx');

const layoutSource = () => readFileSync(LAYOUT, 'utf8');
const actionsSource = () => readFileSync(ACTIONS, 'utf8');
const formSource = () => readFileSync(FORM, 'utf8');

describe('root layout theme', () => {
  it('reads the theme cookie', () => {
    expect(layoutSource()).toMatch(/cookies\(\)/);
    expect(layoutSource()).toMatch(/['"]theme['"]/);
  });

  it('stamps data-theme only for an explicit light/dark choice', () => {
    // System (no cookie, or any value other than light/dark) must leave the attribute unset —
    // React omits a JSX attribute entirely when its value is `undefined`, which is what makes
    // "stamps nothing at all" true rather than stamping the literal string "system".
    expect(layoutSource()).toMatch(/data-theme=\{/);
    expect(layoutSource()).not.toMatch(/data-theme=['"]/);
  });
});

describe('appearance form', () => {
  it('is a client component', () => {
    expect(formSource()).toMatch(/^'use client';/m);
  });

  it('offers exactly System, Light, and Dark', () => {
    expect(formSource()).toMatch(/system/);
    expect(formSource()).toMatch(/light/);
    expect(formSource()).toMatch(/dark/);
  });

  it('disables its controls while a save is pending (D51)', () => {
    expect(formSource()).toMatch(/useTransition/);
    expect(formSource()).toMatch(/disabled=\{/);
  });
});

describe('theme action', () => {
  it('is a server action', () => {
    expect(actionsSource()).toMatch(/'use server'/);
  });

  it('sets the cookie with a one-year expiry', () => {
    expect(actionsSource()).toMatch(/saveThemeAction/);
    // 60 * 60 * 24 * 365, however the file chooses to spell it.
    expect(actionsSource()).toMatch(/365/);
  });

  it('consumes a rate-limit bucket (D69)', () => {
    const body = actionsSource().slice(actionsSource().indexOf('saveThemeAction'));
    expect(body).toMatch(/consume\(/);
  });
});

describe('root layout accent', () => {
  it("reads the signed-in user's accent column, not a second hand-typed value", () => {
    expect(layoutSource()).toMatch(/getSessionUser/);
    expect(layoutSource()).toMatch(/users\.accent/);
  });

  it('stamps data-accent only for a signed-in user', () => {
    expect(layoutSource()).toMatch(/data-accent=\{/);
    expect(layoutSource()).not.toMatch(/data-accent=['"]/);
  });

  it('lowercases the enum value to match the [data-accent] CSS selectors', () => {
    expect(layoutSource()).toMatch(/\.toLowerCase\(\)/);
  });
});

describe('appearance form accent picker', () => {
  it('renders its six swatches from the schema’s exported list, not a second copy', () => {
    expect(formSource()).toMatch(/ACCENT_VALUES/);
  });

  it('is a radio group', () => {
    expect(formSource()).toMatch(/role="radiogroup"/);
    expect(formSource()).toMatch(/role="radio"/);
  });
});

describe('accent action', () => {
  it('is a server action that validates against the curated six', () => {
    expect(actionsSource()).toMatch(/saveAccentAction/);
    expect(actionsSource()).toMatch(/ACCENT_VALUES\.includes/);
  });

  it('consumes a rate-limit bucket (D69)', () => {
    const body = actionsSource().slice(actionsSource().indexOf('saveAccentAction'));
    expect(body).toMatch(/consume\(/);
  });

  it('keys the write on the session, never on a client-supplied member id', () => {
    const body = actionsSource().slice(actionsSource().indexOf('saveAccentAction'));
    expect(body).toMatch(/requireApprovedMemberOrThrow/);
  });
});
