import { describe, expect, it } from 'bun:test';
import type { ResetAccount } from '../src/tmx/resets/api';
import {
  DAY_MS,
  HOUR_MS,
  buildTimeline,
  creditVerdict,
  spendableCredit,
  summarize,
} from '../src/tmx/resets/model';

const NOW = Date.parse('2026-10-20T17:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const claude = (overrides: Partial<ResetAccount> = {}): ResetAccount => ({
  auth_id: 'claude-1',
  auth_index: 'idx-claude',
  provider: 'claude',
  label: 'claude@example.com',
  checked_at: iso(0),
  eligible: true,
  at_limit: false,
  windows: [
    { window: '5h', used_pct: 9, resets_at: iso(80 * 60_000) },
    { window: '7d', used_pct: 6, resets_at: iso(6.6 * DAY_MS) },
  ],
  credits: [
    {
      id: 'launch',
      title: 'Launch reset',
      expires_at: iso(2 * DAY_MS),
      clears: ['5h', '7d', '7d_oi'],
      resets_left: 1,
    },
  ],
  next_credit_id: 'launch',
  ...overrides,
});

const codex = (): ResetAccount => ({
  auth_id: 'codex-1',
  auth_index: 'idx-codex',
  provider: 'codex',
  label: 'codex@example.com',
  checked_at: iso(0),
  eligible: true,
  at_limit: false,
  applicable_count: 0,
  windows: [{ window: '7d', used_pct: 0, resets_at: iso(6.8 * DAY_MS) }],
  credits: [
    {
      id: 'c3',
      title: 'Full reset',
      expires_at: iso(17 * DAY_MS),
      clears: ['7d'],
      resets_left: 1,
      warning: 'nothing_to_clear',
    },
    {
      id: 'c1',
      title: 'Full reset',
      expires_at: iso(2.1 * DAY_MS),
      clears: ['7d'],
      resets_left: 1,
      warning: 'nothing_to_clear',
    },
    {
      id: 'c2',
      title: 'Full reset',
      expires_at: iso(9 * DAY_MS),
      clears: ['7d'],
      resets_left: 1,
      warning: 'nothing_to_clear',
    },
  ],
});

describe('creditVerdict', () => {
  it('flags use-it-or-lose-it when a credit expires before the cleared windows refill', () => {
    const a = claude();
    const v = creditVerdict(a, a.credits[0], NOW);
    expect(v.kind).toBe('use_or_lose');
    expect(v.gains).toEqual([
      { window: '5h', usedPct: 9 },
      { window: '7d', usedPct: 6 },
    ]);
    expect(v.totalGain).toBe(15);
    expect(v.lapsesBeforeRefill).toBe(true);
    expect(v.spendable).toBe(true);
  });

  it('says use now when a cleared window is exhausted and far from refilling', () => {
    const a = claude({
      windows: [
        { window: '5h', used_pct: 40, resets_at: iso(2 * HOUR_MS) },
        { window: '7d', used_pct: 100, resets_at: iso(5 * DAY_MS) },
      ],
    });
    expect(creditVerdict(a, a.credits[0], NOW).kind).toBe('use_now');
  });

  it('does not say use now when the exhausted window refills within 12 hours', () => {
    const a = claude({
      windows: [{ window: '7d', used_pct: 100, resets_at: iso(3 * HOUR_MS) }],
      credits: [
        { id: 'x', title: 'x', expires_at: iso(10 * DAY_MS), clears: ['7d'], resets_left: 1 },
      ],
    });
    expect(creditVerdict(a, a.credits[0], NOW).kind).toBe('hold');
  });

  it('reports nothing to clear for Codex credits OpenAI says are not applicable', () => {
    const a = codex();
    const v = creditVerdict(a, a.credits[1], NOW);
    expect(v.kind).toBe('nothing');
    expect(v.lapsesBeforeRefill).toBe(true);
  });

  it('targets only the soonest-expiring usable credit', () => {
    const a = codex();
    expect(spendableCredit(a)?.id).toBe('c1');
    expect(creditVerdict(a, a.credits[0], NOW).spendable).toBe(false);
  });

  it('skips blocked credits when choosing what to spend, and reports the blocker', () => {
    const a = claude({
      credits: [
        {
          id: 'early',
          title: 'e',
          expires_at: iso(DAY_MS),
          clears: ['5h'],
          resets_left: 1,
          blocker: 'not_limited',
        },
        { id: 'late', title: 'l', expires_at: iso(5 * DAY_MS), clears: ['5h'], resets_left: 1 },
      ],
    });
    expect(spendableCredit(a)?.id).toBe('late');
    const v = creditVerdict(a, a.credits[0], NOW);
    expect(v.kind).toBe('blocked');
    expect(v.blocker).toBe('not_limited');
  });

  it('shows a pending claim as retryable even when the credit is blocked now', () => {
    const a = claude();
    a.credits[0].blocker = 'exhausted';
    a.pending = {
      id: 1,
      created_at: iso(-60_000),
      auth_id: 'claude-1',
      provider: 'claude',
      label: '',
      credit_id: 'launch',
      credit_title: '',
      state: 'pending',
      outcome: 'unknown',
      confirmed: false,
      before: [],
      after: [],
    };
    expect(creditVerdict(a, a.credits[0], NOW).kind).toBe('pending');
  });
});

describe('summarize', () => {
  it('counts banked credits, those lapsing within 3 days, and the next expiry', () => {
    const s = summarize([claude(), codex()], NOW);
    expect(s.banked).toBe(4);
    expect(s.lapseSoon).toBe(2);
    expect(s.accountsWithCredits).toBe(2);
    expect(s.nextExpiry?.provider).toBe('claude');
  });

  it('ignores expired credits', () => {
    const a = claude();
    a.credits[0].blocker = 'expired';
    expect(summarize([a], NOW).banked).toBe(0);
  });
});

describe('buildTimeline', () => {
  it('returns null when no account has credits', () => {
    expect(buildTimeline([claude({ credits: [] })], NOW)).toBeNull();
  });

  it('draws refills, credit lifetimes, expiries and a waste span for a low-value lapsing credit', () => {
    const t = buildTimeline([claude(), codex()], NOW);
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.endMs).toBeGreaterThan(NOW + 17 * DAY_MS);
    expect(t.endMs - NOW).toBeLessThanOrEqual(31 * DAY_MS);
    const claudeRow = t.rows.find((r) => r.account.provider === 'claude');
    const types = claudeRow?.markers.map((m) => m.type) ?? [];
    expect(types).toContain('refill');
    expect(types).toContain('waste');
    expect(types).toContain('expiry');
    const codexRow = t.rows.find((r) => r.account.provider === 'codex');
    const expiries = codexRow?.markers.filter((m) => m.type === 'expiry') ?? [];
    expect(expiries).toHaveLength(3);
    // Weekly refills repeat across the axis; the 5-hour window is too dense to draw.
    const refills = codexRow?.markers.filter((m) => m.type === 'refill') ?? [];
    expect(refills.length).toBeGreaterThanOrEqual(2);
    expect(claudeRow?.markers.some((m) => m.type === 'refill' && m.window === '5h')).toBe(false);
  });
});
