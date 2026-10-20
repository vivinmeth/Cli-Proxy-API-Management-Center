import { describe, expect, test } from 'bun:test';
import {
  buildQuotaChart,
  compareWindows,
  valueAt,
  windowLabel,
} from '../src/tmx/quotahistory/model';
import type { QuotaSnapshot } from '../src/tmx/quotahistory/api';

const H = 3600 * 1000;
const t0 = Date.parse('2026-10-20T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const snap = (h: number, window: string, used: number, resetH: number | null): QuotaSnapshot => ({
  ts: iso(t0 + h * H),
  auth_id: 'claude-a.json',
  provider: 'claude',
  label: 'a@example.com',
  plan: 'max_20x',
  window,
  used_pct: used,
  resets_at: resetH === null ? null : iso(t0 + resetH * H),
  source: 'polled',
});
const tr = (key: string, opts?: Record<string, string>) =>
  key.endsWith('len_hours') ? `${opts?.n}-hour` : key.endsWith('len_days') ? `${opts?.n}-day` : key;

describe('quota history model', () => {
  test('a new reset time starts a new segment and marks the reset', () => {
    const [acc] = buildQuotaChart(
      [snap(0, '5h', 10, 5), snap(2, '5h', 40, 5), snap(6, '5h', 3, 10)],
      [],
      t0,
      t0 + 8 * H
    );
    const s = acc.series[0];
    expect(s.segments.length).toBe(2);
    expect(s.resets).toEqual([t0 + 5 * H]);
    // The first period ends at its last reading; the open one extends to the end of the range.
    expect(s.segments[0].points.at(-1)).toEqual({ t: t0 + 2 * H, v: 40 });
    expect(s.segments[1].points.at(-1)).toEqual({ t: t0 + 8 * H, v: 3 });
    expect(valueAt(s, t0 + 1 * H)).toBe(10);
    expect(valueAt(s, t0 + 7 * H)).toBe(3);
    expect(valueAt(s, t0 + 3 * H)).toBeNull(); // between last reading and reset: unknown
  });

  test('a period whose reset passed stops at the reset, not the end of range', () => {
    const [acc] = buildQuotaChart([snap(0, '5h', 50, 3)], [], t0, t0 + 8 * H);
    const seg = acc.series[0].segments[0];
    expect(seg.points.at(-1)).toEqual({ t: t0 + 3 * H, v: 50 });
    expect(acc.series[0].resets).toEqual([t0 + 3 * H]);
  });

  test('reset times within a minute are one period (sources round differently)', () => {
    const a = snap(0, '7d', 4, 100);
    const b = { ...snap(1, '7d', 5, 100), resets_at: iso(t0 + 100 * H + 1000) };
    const [acc] = buildQuotaChart([a, b], [], t0, t0 + 2 * H);
    expect(acc.series[0].segments.length).toBe(1);
  });

  test('windows sort 5h, 7d, model weekly, rest; labels read well', () => {
    expect(['code_review:30d', '7d:fable', '7d', '5h'].sort(compareWindows)).toEqual([
      '5h',
      '7d',
      '7d:fable',
      'code_review:30d',
    ]);
    expect(windowLabel('5h', tr)).toBe('5-hour');
    expect(windowLabel('7d:fable', tr)).toBe('7-day · Fable');
    expect(windowLabel('code_review:30d', tr)).toBe('Code review · 30-day');
    expect(windowLabel('7d_opus', tr)).toBe('7-day · Opus');
  });

  test('accounts from current state appear even without history', () => {
    const charts = buildQuotaChart(
      [],
      [
        {
          auth_id: 'codex-1',
          auth_index: 'x',
          provider: 'codex',
          label: 'c',
          plan: 'prolite',
          windows: [],
          last_poll_at: null,
          next_poll_at: null,
        },
      ],
      t0,
      t0 + H
    );
    expect(charts.map((c) => [c.authId, c.plan, c.series.length])).toEqual([
      ['codex-1', 'prolite', 0],
    ]);
  });
});
