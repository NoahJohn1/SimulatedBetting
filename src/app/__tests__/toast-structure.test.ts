import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The announcement layer (D76): one ToastProvider mounted in the (app) shell, a portal at
 * the viewport edge, a polite live region. There is no jsdom in this project and no
 * component-test harness (D51), so what this checks is source text — behaviour tests arrive
 * with the harness in Task 14.
 */

const TOAST = join(process.cwd(), 'src', 'components', 'ui', 'toast.tsx');
const SHELL = join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx');

const toastSource = () => readFileSync(TOAST, 'utf8');
const shellSource = () => readFileSync(SHELL, 'utf8');

describe('toast layer', () => {
  it('announces via a polite live region', () => {
    expect(toastSource()).toMatch(/role="status"/);
    expect(toastSource()).toMatch(/aria-live="polite"/);
  });

  it('is mounted once, in the app shell', () => {
    expect(shellSource()).toMatch(/<ToastProvider>/);
  });

  it('exposes a useToast hook that throws outside the provider', () => {
    expect(toastSource()).toMatch(/export function useToast/);
    expect(toastSource()).toMatch(/useToast outside ToastProvider/);
  });

  it('is a client component', () => {
    expect(toastSource()).toMatch(/^'use client';/m);
  });

  it('caps the queue at three items', () => {
    expect(toastSource()).toMatch(/\.slice\(-2\)/);
  });

  it('renders through a portal', () => {
    expect(toastSource()).toMatch(/createPortal/);
  });

  it('pauses auto-dismiss on hover', () => {
    expect(toastSource()).toMatch(/onMouseEnter/);
    expect(toastSource()).toMatch(/onMouseLeave/);
  });
});
