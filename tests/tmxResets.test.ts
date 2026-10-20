import { describe, expect, it } from 'bun:test';
import type { ResetAccount, ResetsResponse } from '../src/tmx/resets/api';
import { DAY_MS, buildTimeline, creditVerdict, summaryOf } from '../src/tmx/resets/model';

const NOW = Date.parse('2026-10-20T17:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

// Shapes as returned by GET /v8/management/tmx/resets (verdicts are server-computed).
const claude = (): ResetAccount => ({
  auth_id: 'claude-1',
  auth_index: 'idx-claude',
  provider: 'claude',
  label: 'claude@example.com',
  plan: 'max_20x',
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
      verdict: {
        kind: 'use_or_lose',
        gains: [
          { window: '5h', used_pct: 9 },
          { window: '7d', used_pct: 6 },
        ],
        total_gain: 15,
        refill_at: iso(6.6 * DAY_MS),
        lapses_before_refill: true,
        lapses_soon: true,
        spendable: true,
      },
    },
  ],
  next_credit_id: 'launch',
});

const nothing = (spendable: boolean, lapses: boolean) => ({
  kind: 'nothing' as const,
  gains: [],
  total_gain: 0,
  refill_at: iso(6.8 * DAY_MS),
  lapses_before_refill: lapses,
  lapses_soon: lapses,
  spendable,
});

const codex = (): ResetAccount => ({
  auth_id: 'codex-1',
  auth_index: 'idx-codex',
  provider: 'codex',
  label: 'codex@example.com',
  plan: 'prolite',
  checked_at: iso(0),
  eligible: true,
  at_limit: false,
  applicable_count: 0,
  windows: [{ window: '7d', used_pct: 0, resets_at: iso(6.8 * DAY_MS) }],
  credits: [
    {
      id: 'c1',
      title: 'Full reset',
      expires_at: iso(2.1 * DAY_MS),
      clears: ['7d'],
      resets_left: 1,
      warning: 'nothing_to_clear',
      verdict: nothing(true, true),
    },
    {
      id: 'c2',
      title: 'Full reset',
      expires_at: iso(9 * DAY_MS),
      clears: ['7d'],
      resets_left: 1,
      warning: 'nothing_to_clear',
      verdict: nothing(false, false),
    },
    {
      id: 'c3',
      title: 'Full reset',
      expires_at: iso(17 * DAY_MS),
      clears: ['7d'],
      resets_left: 1,
      warning: 'nothing_to_clear',
      verdict: nothing(false, false),
    },
  ],
});

describe('creditVerdict (server verdict adapter)', () => {
  it('maps the backend verdict to the UI shape', () => {
    const credit = claude().credits[0];
    const v = creditVerdict(credit);
    expect(v.kind).toBe('use_or_lose');
    expect(v.gains).toEqual([
      { window: '5h', usedPct: 9 },
      { window: '7d', usedPct: 6 },
    ]);
    expect(v.totalGain).toBe(15);
    expect(v.lapsesBeforeRefill).toBe(true);
    expect(v.spendable).toBe(true);
    expect(v.expiresAtMs).toBe(NOW + 2 * DAY_MS);
    expect(v.refillAtMs).toBe(NOW + 6.6 * DAY_MS);
  });

  it('carries blocker and warning from the credit', () => {
    const credit = codex().credits[0];
    const v = creditVerdict(credit);
    expect(v.kind).toBe('nothing');
    expect(v.warning).toBe('nothing_to_clear');
  });

  it('treats a credit without a verdict (older backend) as hold and not spendable', () => {
    const credit = { ...claude().credits[0], verdict: undefined };
    const v = creditVerdict(credit);
    expect(v.kind).toBe('hold');
    expect(v.spendable).toBe(false);
  });
});

describe('summaryOf', () => {
  it('reads the server summary', () => {
    const data: ResetsResponse = {
      enabled: true,
      accounts: [claude(), codex()],
      history: [],
      summary: {
        banked: 4,
        lapse_soon: 2,
        accounts_with_credits: 2,
        pending: 0,
        next_expiry: {
          at: iso(2 * DAY_MS),
          auth_id: 'claude-1',
          provider: 'claude',
          credit_id: 'launch',
        },
      },
    };
    const s = summaryOf(data);
    expect(s.banked).toBe(4);
    expect(s.lapseSoon).toBe(2);
    expect(s.nextExpiry).toEqual({
      atMs: NOW + 2 * DAY_MS,
      provider: 'claude',
      authId: 'claude-1',
    });
  });

  it('is empty without data', () => {
    expect(summaryOf(null)).toEqual({
      banked: 0,
      lapseSoon: 0,
      accountsWithCredits: 0,
      pending: 0,
      nextExpiry: null,
    });
  });
});

describe('buildTimeline', () => {
  it('returns null when no account has credits', () => {
    expect(buildTimeline([{ ...claude(), credits: [] }], NOW)).toBeNull();
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
    expect(codexRow?.markers.filter((m) => m.type === 'expiry')).toHaveLength(3);
    // Weekly refills repeat across the axis; the 5-hour window is too dense to draw.
    expect(codexRow?.markers.filter((m) => m.type === 'refill').length).toBeGreaterThanOrEqual(2);
    expect(claudeRow?.markers.some((m) => m.type === 'refill' && m.window === '5h')).toBe(false);
  });

  it('keeps the first tick clear of the "now" label', () => {
    const t = buildTimeline([claude()], NOW);
    expect(t?.ticks.every((tick) => tick - NOW >= (t.endMs - NOW) * 0.08)).toBe(true);
  });
});
