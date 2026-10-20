// tokenmaxx fork: turn quota snapshots into chart series (pure, tested in tests/).
import type { QuotaAccountNow, QuotaSnapshot } from './api';

/** A run of readings that share one reset time (one window period). */
export interface QuotaSegment {
  points: { t: number; v: number }[];
  resetsAt: number | null;
}

export interface QuotaSeries {
  window: string;
  segments: QuotaSegment[];
  /** Times inside the range where this window reset (the end of a period). */
  resets: number[];
}

export interface QuotaChartAccount {
  authId: string;
  provider: string;
  label: string;
  plan: string;
  series: QuotaSeries[];
  current: QuotaAccountNow | null;
}

const ORDER = ['5h', '7d'];

/** Fixed window order: 5h, 7d, model-scoped weekly, then the rest alphabetically. */
export function compareWindows(a: string, b: string): number {
  const rank = (w: string) => {
    const i = ORDER.indexOf(w);
    if (i >= 0) return i;
    if (w.startsWith('7d:')) return 2;
    return 3;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

const parse = (s: string | null | undefined) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/**
 * Groups snapshots by account and window. Readings are step values (they hold until the next
 * reading); a new reset time starts a new segment, and the previous reset time — when it falls
 * inside the range — becomes a reset marker. The last segment is extended to `until` unless its
 * reset has passed (then the value is stale and the line stops at its last reading).
 */
export function buildQuotaChart(
  snapshots: QuotaSnapshot[],
  accounts: QuotaAccountNow[],
  from: number,
  until: number
): QuotaChartAccount[] {
  const byAccount = new Map<string, QuotaChartAccount>();
  const ensure = (id: string, provider: string, label: string, plan: string) => {
    let acc = byAccount.get(id);
    if (!acc) {
      acc = { authId: id, provider, label, plan, series: [], current: null };
      byAccount.set(id, acc);
    }
    if (label) acc.label = label;
    if (plan) acc.plan = plan;
    return acc;
  };
  for (const a of accounts) ensure(a.auth_id, a.provider, a.label, a.plan).current = a;

  const grouped = new Map<string, QuotaSnapshot[]>();
  for (const s of snapshots) {
    if (s.used_pct === null || s.used_pct === undefined) continue;
    const key = `${s.auth_id}\u0000${s.window}`;
    const list = grouped.get(key);
    if (list) list.push(s);
    else grouped.set(key, [s]);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const first = list[0];
    const acc = ensure(first.auth_id, first.provider, first.label, first.plan);
    const series: QuotaSeries = { window: first.window, segments: [], resets: [] };
    let seg: QuotaSegment | null = null;
    for (const s of list) {
      const t = Date.parse(s.ts);
      const resetsAt = parse(s.resets_at);
      // Same period if the reset time moved by less than a minute (sources round differently).
      const samePeriod =
        seg !== null &&
        (seg.resetsAt === resetsAt ||
          (seg.resetsAt !== null &&
            resetsAt !== null &&
            Math.abs(seg.resetsAt - resetsAt) < 60000));
      if (!samePeriod) {
        if (seg && seg.resetsAt !== null && seg.resetsAt > from && seg.resetsAt <= until) {
          series.resets.push(seg.resetsAt);
        }
        seg = { points: [], resetsAt };
        series.segments.push(seg);
      }
      seg!.points.push({ t: Math.max(t, from), v: Math.max(0, Math.min(100, s.used_pct!)) });
    }
    const last = series.segments[series.segments.length - 1];
    if (last && last.points.length > 0) {
      const end = last.resetsAt !== null && last.resetsAt < until ? last.resetsAt : until;
      const lastPoint = last.points[last.points.length - 1];
      if (end > lastPoint.t) last.points.push({ t: end, v: lastPoint.v });
      if (last.resetsAt !== null && last.resetsAt > from && last.resetsAt <= until) {
        series.resets.push(last.resetsAt);
      }
    }
    acc.series.push(series);
  }
  const out = [...byAccount.values()];
  for (const a of out) a.series.sort((x, y) => compareWindows(x.window, y.window));
  out.sort((a, b) => a.provider.localeCompare(b.provider) || a.authId.localeCompare(b.authId));
  return out;
}

/** Value of a series at time t (step function), or null outside its readings. */
export function valueAt(series: QuotaSeries, t: number): number | null {
  for (const seg of series.segments) {
    const pts = seg.points;
    if (pts.length === 0 || t < pts[0].t || t > pts[pts.length - 1].t) continue;
    let v = pts[0].v;
    for (const p of pts) {
      if (p.t <= t) v = p.v;
      else break;
    }
    return v;
  }
  return null;
}

/** Human label for a canonical window name. */
export function windowLabel(
  window: string,
  t: (key: string, opts?: Record<string, string>) => string
) {
  const length = (w: string) =>
    w.endsWith('h')
      ? t('tmx_quota_history.len_hours', { n: w.slice(0, -1) })
      : w.endsWith('d')
        ? t('tmx_quota_history.len_days', { n: w.slice(0, -1) })
        : w;
  if (window.startsWith('7d:')) {
    const model = window.slice(3).replace(/-/g, ' ');
    return `${length('7d')} · ${model.charAt(0).toUpperCase()}${model.slice(1)}`;
  }
  const colon = window.indexOf(':');
  if (colon > 0) {
    const name = window.slice(0, colon).replace(/_/g, ' ');
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} · ${length(window.slice(colon + 1))}`;
  }
  const us = window.indexOf('_');
  if (us > 0) {
    const name = window.slice(us + 1).replace(/_/g, ' ');
    return `${length(window.slice(0, us))} · ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
  return length(window);
}
