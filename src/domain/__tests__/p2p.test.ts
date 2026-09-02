import { describe, expect, it } from 'vitest';
import {
  agreedVerdict,
  computeHeadToHead,
  isDisputed,
  isOverdue,
  potCents,
  verdictForLegStatus,
  type HeadToHeadRow,
} from '@/domain/p2p';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

describe('verdictForLegStatus', () => {
  it('maps a winning selection to the offerer', () => {
    expect(verdictForLegStatus('WON')).toBe('OFFERER');
  });

  it('maps a losing selection to the acceptor, who held the negation', () => {
    expect(verdictForLegStatus('LOST')).toBe('ACCEPTOR');
  });

  it('voids a push — neither side was right', () => {
    expect(verdictForLegStatus('PUSHED')).toBe('VOID');
  });

  it('voids a voided leg — the event died', () => {
    expect(verdictForLegStatus('VOIDED')).toBe('VOID');
  });
});

describe('potCents', () => {
  it('sums two asymmetric stakes', () => {
    expect(potCents(50_000n, 20_000n)).toBe(70_000n);
  });

  it('sums two equal stakes', () => {
    expect(potCents(10_000n, 10_000n)).toBe(20_000n);
  });
});

describe('agreedVerdict', () => {
  it('returns the verdict when both parties say the same thing', () => {
    expect(agreedVerdict({ offererClaim: 'OFFERER', acceptorClaim: 'OFFERER' })).toBe('OFFERER');
    expect(agreedVerdict({ offererClaim: 'ACCEPTOR', acceptorClaim: 'ACCEPTOR' })).toBe('ACCEPTOR');
  });

  it('treats a mutual VOID claim as an agreement to refund', () => {
    expect(agreedVerdict({ offererClaim: 'VOID', acceptorClaim: 'VOID' })).toBe('VOID');
  });

  it('returns null when they disagree', () => {
    expect(agreedVerdict({ offererClaim: 'OFFERER', acceptorClaim: 'ACCEPTOR' })).toBeNull();
  });

  it('returns null when only one has claimed', () => {
    expect(agreedVerdict({ offererClaim: 'OFFERER', acceptorClaim: null })).toBeNull();
    expect(agreedVerdict({ offererClaim: null, acceptorClaim: 'OFFERER' })).toBeNull();
    expect(agreedVerdict({ offererClaim: null, acceptorClaim: null })).toBeNull();
  });
});

describe('isDisputed', () => {
  it('is true only when both claims are set and differ', () => {
    expect(isDisputed({ offererClaim: 'OFFERER', acceptorClaim: 'ACCEPTOR' })).toBe(true);
    expect(isDisputed({ offererClaim: 'OFFERER', acceptorClaim: 'VOID' })).toBe(true);
  });

  it('is false on agreement, and false while a claim is missing', () => {
    expect(isDisputed({ offererClaim: 'OFFERER', acceptorClaim: 'OFFERER' })).toBe(false);
    expect(isDisputed({ offererClaim: 'OFFERER', acceptorClaim: null })).toBe(false);
    expect(isDisputed({ offererClaim: null, acceptorClaim: null })).toBe(false);
  });
});

describe('isOverdue', () => {
  const past = new Date('2026-08-01T00:00:00Z');
  const future = new Date('2026-12-01T00:00:00Z');
  const now = new Date('2026-09-01T00:00:00Z');

  it('is overdue past the date with no claims', () => {
    expect(isOverdue({ resolvesBy: past, offererClaim: null, acceptorClaim: null }, now)).toBe(
      true,
    );
  });

  it('is overdue past the date with only one claim', () => {
    expect(isOverdue({ resolvesBy: past, offererClaim: 'OFFERER', acceptorClaim: null }, now)).toBe(
      true,
    );
  });

  it('is overdue past the date when the two disagree', () => {
    expect(
      isOverdue({ resolvesBy: past, offererClaim: 'OFFERER', acceptorClaim: 'ACCEPTOR' }, now),
    ).toBe(true);
  });

  it('is not overdue once both agree, however late', () => {
    expect(isOverdue({ resolvesBy: past, offererClaim: 'VOID', acceptorClaim: 'VOID' }, now)).toBe(
      false,
    );
  });

  it('is not overdue before the date', () => {
    expect(isOverdue({ resolvesBy: future, offererClaim: null, acceptorClaim: null }, now)).toBe(
      false,
    );
  });
});

describe('computeHeadToHead', () => {
  function row(over: Partial<HeadToHeadRow> = {}): HeadToHeadRow {
    return {
      offererMembershipId: A,
      acceptorMembershipId: B,
      status: 'SETTLED',
      verdict: 'OFFERER',
      offererStakeCents: 50_000n,
      acceptorStakeCents: 20_000n,
      ...over,
    };
  }

  it('credits the offerer the acceptor stake when the offerer wins', () => {
    const h2h = computeHeadToHead([row()], A, B);
    expect(h2h).toEqual({
      settled: 1,
      aWon: 1,
      bWon: 0,
      voided: 0,
      netCentsForA: 20_000n,
    });
  });

  it('debits the offerer their own stake when the acceptor wins', () => {
    const h2h = computeHeadToHead([row({ verdict: 'ACCEPTOR' })], A, B);
    expect(h2h).toEqual({
      settled: 1,
      aWon: 0,
      bWon: 1,
      voided: 0,
      netCentsForA: -50_000n,
    });
  });

  it('is symmetric — swapping the members negates the net', () => {
    const forA = computeHeadToHead([row()], A, B);
    const forB = computeHeadToHead([row()], B, A);
    expect(forB.netCentsForA).toBe(-forA.netCentsForA);
    expect(forB.aWon).toBe(forA.bWon);
  });

  it('scores a wager where A is the acceptor', () => {
    const h2h = computeHeadToHead(
      [row({ offererMembershipId: B, acceptorMembershipId: A, verdict: 'ACCEPTOR' })],
      A,
      B,
    );
    // A accepted, A won, so A takes B's offerer stake of 50,000.
    expect(h2h).toEqual({ settled: 1, aWon: 1, bWon: 0, voided: 0, netCentsForA: 50_000n });
  });

  it('counts a void without moving the net', () => {
    const h2h = computeHeadToHead([row({ status: 'VOIDED', verdict: 'VOID' })], A, B);
    expect(h2h).toEqual({ settled: 0, aWon: 0, bWon: 0, voided: 1, netCentsForA: 0n });
  });

  it('ignores wagers that never happened', () => {
    const rows = [
      row({ status: 'CANCELED', verdict: null }),
      row({ status: 'EXPIRED', verdict: null }),
      row({ status: 'OFFERED', verdict: null, acceptorMembershipId: null }),
      row({ status: 'ACCEPTED', verdict: null }),
    ];
    expect(computeHeadToHead(rows, A, B)).toEqual({
      settled: 0,
      aWon: 0,
      bWon: 0,
      voided: 0,
      netCentsForA: 0n,
    });
  });

  it('ignores wagers not between exactly these two members', () => {
    const rows = [row({ acceptorMembershipId: C }), row({ offererMembershipId: C })];
    expect(computeHeadToHead(rows, A, B)).toEqual({
      settled: 0,
      aWon: 0,
      bWon: 0,
      voided: 0,
      netCentsForA: 0n,
    });
  });

  it('accumulates a run of wagers in both directions', () => {
    const rows = [
      row({ verdict: 'OFFERER' }), // A +20,000
      row({ verdict: 'ACCEPTOR' }), // A -50,000
      row({ offererMembershipId: B, acceptorMembershipId: A, verdict: 'ACCEPTOR' }), // A +50,000
      row({ status: 'VOIDED', verdict: 'VOID' }), // 0
    ];
    expect(computeHeadToHead(rows, A, B)).toEqual({
      settled: 3,
      aWon: 2,
      bWon: 1,
      voided: 1,
      netCentsForA: 20_000n,
    });
  });
});
