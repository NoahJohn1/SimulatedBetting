import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The four screens a member meets before the app does (D71). They are a sequence, not three
 * unrelated holding pages — and there are four of them, not the three the roadmap named:
 * `/disabled` is reached by the same `requireApprovedMember` switch as the other three.
 */

const APP = join(process.cwd(), 'src', 'app');
const GATES = ['pending', 'join', 'no-season', 'disabled'];

const sourceFor = (gate: string) => readFileSync(join(APP, gate, 'page.tsx'), 'utf8');

describe('gate screens', () => {
  it.each(GATES)('/%s renders the shared GateScreen', (gate) => {
    expect(sourceFor(gate)).toContain('@/components/ui/gate-screen');
  });

  it.each(GATES)('/%s exports its own title', (gate) => {
    expect(sourceFor(gate)).toMatch(/export const metadata: Metadata = \{\s*title:/);
  });

  it.each(GATES)('/%s links to the house rules', (gate) => {
    expect(sourceFor(gate)).toContain('/rules');
  });

  it('gives the two-step sequence its step numbers', () => {
    expect(sourceFor('pending')).toContain('current: 1');
    expect(sourceFor('join')).toContain('current: 2');
  });
});
