/**
 * Ledger view: email masking, per-provider summary aggregation, and row columns.
 */

import { describe, expect, test } from 'bun:test';
import { maskEmailsInText } from '@/features/quota/emailMask';
import {
  buildProviderSummary,
  extractLedgerLimits,
  groupByProvider,
  ledgerLevel,
  resolvePrimaryLimitId,
  selectRowLimits,
  soonestUpcomingReset,
} from '@/features/quota/ledgerModel';

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const claudeQuota = (opts: {
  fable?: number | null;
  sevenDay?: number | null;
  fiveHour?: number | null;
  resetAtMs?: number | null;
  status?: 'success' | 'idle' | 'loading' | 'error';
}) => ({
  status: opts.status ?? 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      label: '5-hour limit',
      labelKey: 'claude_quota.five_hour',
      usedPercent: opts.fiveHour ?? 0,
      resetLabel: '-',
      resetAtMs: null,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '7-day limit',
      labelKey: 'claude_quota.seven_day',
      usedPercent: opts.sevenDay ?? 0,
      resetLabel: '-',
      resetAtMs: opts.resetAtMs ?? null,
      periodHours: 168,
    },
    {
      id: 'seven-day-opus',
      label: '7-day Opus',
      labelKey: 'claude_quota.seven_day_opus',
      usedPercent: 3,
      resetLabel: '-',
      resetAtMs: opts.resetAtMs ?? null,
      periodHours: 168,
    },
    ...(opts.fable === undefined
      ? []
      : [
          {
            id: 'seven-day-fable',
            label: '7-day Fable 5',
            labelKey: 'claude_quota.seven_day_fable',
            usedPercent: opts.fable,
            resetLabel: '-',
            resetAtMs: opts.resetAtMs ?? null,
            periodHours: 168,
          },
        ]),
  ],
});

describe('maskEmailsInText', () => {
  test('masks local part and domain labels, keeping the first character', () => {
    expect(maskEmailsInText('claude-theo@1code.dev.json')).toBe('claude-t•••@1•••.dev.json');
    expect(maskEmailsInText('claude-team@ping.gg.json')).toBe('claude-t•••@p•••.gg.json');
    expect(maskEmailsInText('alice@example.com')).toBe('a•••@e•••.com');
  });

  test('keeps known provider prefixes readable but masks unknown leading words', () => {
    expect(maskEmailsInText('codex-john.doe@mail.example.co.json')).toBe(
      'codex-j•••@m•••.e•••.co.json'
    );
    expect(maskEmailsInText('john-doe@example.com.json')).toBe('j•••@e•••.com.json');
  });

  test('leaves text without an email untouched and masks every occurrence', () => {
    expect(maskEmailsInText('kimi-default.json')).toBe('kimi-default.json');
    expect(maskEmailsInText('')).toBe('');
    expect(maskEmailsInText('a@b.io and c@d.io')).toBe('a•••@b•••.io and c•••@d•••.io');
  });
});

describe('ledger levels and resets', () => {
  test('uses the card meter thresholds', () => {
    expect(ledgerLevel(100)).toBe('high');
    expect(ledgerLevel(70)).toBe('high');
    expect(ledgerLevel(69.9)).toBe('medium');
    expect(ledgerLevel(30)).toBe('medium');
    expect(ledgerLevel(29)).toBe('low');
    expect(ledgerLevel(0)).toBe('low');
    expect(ledgerLevel(null)).toBe('unknown');
  });

  test('soonest reset ignores past, missing, and non-finite instants', () => {
    expect(soonestUpcomingReset([NOW - HOUR, null, NOW + 2 * DAY, NOW + DAY, NaN], NOW)).toBe(
      NOW + DAY
    );
    expect(soonestUpcomingReset([NOW, undefined], NOW)).toBeNull();
  });
});

describe('buildProviderSummary', () => {
  test('sums remaining across credentials against a capacity of N × 100', () => {
    const summary = buildProviderSummary(
      'claude',
      [
        claudeQuota({ fable: 42, sevenDay: 21, resetAtMs: NOW + 3 * DAY }),
        claudeQuota({ fable: 0, sevenDay: 0, resetAtMs: NOW + DAY }),
        claudeQuota({ fable: 80, sevenDay: 50, resetAtMs: NOW - HOUR }),
        undefined,
      ],
      NOW
    );

    expect(summary.credentialCount).toBe(4);
    const fable = summary.secondary.find((window) => window.id === 'seven-day-fable')!;
    expect(fable.labelKey).toBe('claude_quota.seven_day_fable');
    expect(fable.totalRemaining).toBe(58 + 100 + 20);
    expect(fable.capacity).toBe(400);
    expect(fable.segments.map((segment) => segment.level)).toEqual([
      'medium',
      'high',
      'low',
      'unknown',
    ]);
    // The already-passed reset on the third credential is not "soonest".
    expect(fable.soonestResetMs).toBe(NOW + DAY);
  });

  test('leads Claude with the 5-hour and general 7-day limits, Fable collapsed', () => {
    const summary = buildProviderSummary(
      'claude',
      [claudeQuota({ fable: 10, sevenDay: 20, fiveHour: 30, resetAtMs: NOW + DAY })],
      NOW
    );
    expect(summary.headline.map((window) => window.id)).toEqual(['five-hour', 'seven-day']);
    expect(summary.headline.map((window) => window.totalRemaining)).toEqual([70, 80]);
    expect(summary.secondary.map((window) => window.id)).toEqual(['seven-day-fable']);
    expect(summary.secondary[0].totalRemaining).toBe(90);
  });

  test('keeps both Claude headline windows labelled before anything loads', () => {
    const summary = buildProviderSummary('claude', [undefined], NOW);
    expect(summary.headline.map((window) => window.labelKey)).toEqual([
      'claude_quota.five_hour',
      'claude_quota.seven_day',
    ]);
    expect(summary.headline.every((window) => window.totalRemaining === null)).toBe(true);
    expect(summary.secondary).toEqual([]);
  });

  test('other providers lead with their single primary window', () => {
    const summary = buildProviderSummary('codex', [undefined], NOW);
    expect(summary.headline).toEqual([summary.primary]);
  });

  test('reports unknown rather than zero when nothing is loaded', () => {
    const summary = buildProviderSummary('codex', [undefined, { status: 'loading' }], NOW);
    expect(summary.primary.id).toBeNull();
    expect(summary.primary.totalRemaining).toBeNull();
    expect(summary.primary.capacity).toBe(200);
    expect(summary.primary.labelKey).toBe('codex_quota.secondary_window');
    expect(summary.primary.segments.every((segment) => segment.level === 'unknown')).toBe(true);
    expect(summary.primary.soonestResetMs).toBeNull();
  });

  test('aggregates the Codex weekly window ahead of the 5-hour one', () => {
    const codex = (weekly: number, resetAtMs: number) => ({
      status: 'success',
      windows: [
        { id: 'five-hour', label: '5h', usedPercent: 10, resetAtMs: NOW + HOUR, periodHours: 5 },
        { id: 'weekly', label: 'Weekly', usedPercent: weekly, resetAtMs, periodHours: 168 },
      ],
    });
    const summary = buildProviderSummary(
      'codex',
      [codex(83, NOW + 2 * DAY), codex(100, NOW + 3 * DAY), codex(100, NOW + 5 * DAY)],
      NOW
    );
    expect(summary.primary.id).toBe('weekly');
    expect(summary.primary.totalRemaining).toBe(17);
    expect(summary.primary.soonestResetMs).toBe(NOW + 2 * DAY);
    expect(summary.secondary).toEqual([]);
  });

  test('normalizes xAI weekly and Kimi counts to remaining percent', () => {
    const xai = extractLedgerLimits('xai', {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 25,
        resetAtMs: NOW + DAY,
        periodHours: 168,
        monthlyLimitCents: null,
        usedCents: null,
      },
    });
    expect(xai).toEqual([
      expect.objectContaining({ id: 'weekly', remaining: 75, resetAtMs: NOW + DAY }),
    ]);

    const kimi = extractLedgerLimits('kimi', {
      status: 'success',
      rows: [
        { id: 'limit-0', label: '5h', used: 30, limit: 120, resetAtMs: null, periodHours: 5 },
        { id: 'summary', labelKey: 'kimi_quota.weekly_limit', used: 0, limit: 100 },
      ],
    });
    expect(kimi.map((limit) => limit.remaining)).toEqual([75, 100]);
    expect(resolvePrimaryLimitId('kimi', [kimi])).toBe('summary');
  });
});

describe('ledger rows', () => {
  test('put the headline window first, then the provider order, without Opus', () => {
    const limits = extractLedgerLimits('claude', claudeQuota({ fable: 49, sevenDay: 25 }));
    const primaryId = resolvePrimaryLimitId('claude', [limits]);
    expect(primaryId).toBe('five-hour');
    const columns = selectRowLimits('claude', limits, primaryId);
    expect(columns.map((limit) => limit.id)).toEqual(['five-hour', 'seven-day', 'seven-day-fable']);
    expect(columns[2].remaining).toBe(51);
  });

  test('unloaded credentials have no limits', () => {
    expect(extractLedgerLimits('claude', undefined)).toEqual([]);
    expect(extractLedgerLimits('claude', claudeQuota({ status: 'error' }))).toEqual([]);
  });

  test('groups by provider in first-appearance order, preserving row order', () => {
    const entries = [
      { type: 'codex' as const, id: 1 },
      { type: 'claude' as const, id: 2 },
      { type: 'codex' as const, id: 3 },
    ];
    expect(groupByProvider(entries)).toEqual([
      { provider: 'codex', entries: [entries[0], entries[2]] },
      { provider: 'claude', entries: [entries[1]] },
    ]);
  });
});
