/**
 * Reset-credit UI logic. Recommendations (verdicts) and the summary come from the backend
 * (/tmx/resets, internal/tmx/resets/verdict.go) so fleet and this UI always agree; this file only
 * adapts them and computes the timeline geometry.
 */
import type { ResetAccount, ResetCredit, ResetsResponse } from './api';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** A credit expiring within this is flagged "lapses soon" (matches the backend). */
export const LAPSE_SOON_MS = 72 * HOUR_MS;
/** Spending below this much total return is "low value". */
export const LOW_VALUE_PCT = 25;

export type VerdictKind = 'blocked' | 'pending' | 'use_now' | 'use_or_lose' | 'nothing' | 'hold';

export interface WindowGain {
  window: string;
  usedPct: number;
}

export interface Verdict {
  kind: VerdictKind;
  /** Percent points each cleared window would get back now. */
  gains: WindowGain[];
  totalGain: number;
  /** Expires before the cleared windows refill on their own. */
  lapsesBeforeRefill: boolean;
  expiresAtMs: number | null;
  /** Latest natural refill among the cleared windows. */
  refillAtMs: number | null;
  /** The credit a redeem should target for this account. */
  spendable: boolean;
  blocker?: string;
  warning?: string;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isNaN(v) ? null : v;
};

export const expiresAtMs = (credit: ResetCredit) => ms(credit.expires_at);

/** The backend's verdict for a credit; a credit without one (older backend) is shown as hold. */
export function creditVerdict(credit: ResetCredit): Verdict {
  const v = credit.verdict;
  return {
    kind: v?.kind ?? 'hold',
    gains: (v?.gains ?? []).map((g) => ({ window: g.window, usedPct: g.used_pct })),
    totalGain: v?.total_gain ?? 0,
    lapsesBeforeRefill: v?.lapses_before_refill ?? false,
    expiresAtMs: expiresAtMs(credit),
    refillAtMs: ms(v?.refill_at),
    spendable: v?.spendable ?? false,
    blocker: credit.blocker,
    warning: credit.warning,
  };
}

export interface ResetsSummary {
  banked: number;
  lapseSoon: number;
  nextExpiry: { atMs: number; provider: string; authId: string } | null;
  accountsWithCredits: number;
  pending: number;
}

export function summaryOf(data: ResetsResponse | null | undefined): ResetsSummary {
  const s = data?.summary;
  const at = ms(s?.next_expiry?.at);
  return {
    banked: s?.banked ?? 0,
    lapseSoon: s?.lapse_soon ?? 0,
    accountsWithCredits: s?.accounts_with_credits ?? 0,
    pending: s?.pending ?? 0,
    nextExpiry:
      s?.next_expiry && at !== null
        ? { atMs: at, provider: s.next_expiry.provider, authId: s.next_expiry.auth_id }
        : null,
  };
}

// ---- timeline ----

export type TimelineMarker =
  | { type: 'refill'; atMs: number; window: string }
  | { type: 'expiry'; atMs: number; creditId: string; title: string; urgent: boolean }
  | { type: 'life'; fromMs: number; toMs: number; creditId: string; faded: boolean }
  | { type: 'waste'; fromMs: number; toMs: number; creditId: string };

export interface TimelineRow {
  account: ResetAccount;
  markers: TimelineMarker[];
}

export interface Timeline {
  startMs: number;
  endMs: number;
  rows: TimelineRow[];
  ticks: number[];
}

/** Windows long enough to matter on a multi-day axis. */
const TIMELINE_WINDOWS = new Set(['7d', '7d_oi', '30d']);
const MIN_SPAN_MS = 8 * DAY_MS;
const MAX_SPAN_MS = 31 * DAY_MS;

export function buildTimeline(accounts: ResetAccount[], now: number): Timeline | null {
  const withCredits = accounts.filter((a) => a.credits.some((c) => c.blocker !== 'expired'));
  if (withCredits.length === 0) return null;
  let latest = now + MIN_SPAN_MS;
  for (const account of withCredits) {
    for (const credit of account.credits) latest = Math.max(latest, expiresAtMs(credit) ?? 0);
  }
  const endMs = Math.min(now + MAX_SPAN_MS, latest + DAY_MS);
  const rows = withCredits.map((account) => {
    const markers: TimelineMarker[] = [];
    const seen = new Set<number>();
    for (const w of account.windows) {
      const at = ms(w.resets_at);
      if (!TIMELINE_WINDOWS.has(w.window) || at === null || at <= now || at > endMs) continue;
      // A weekly window refills every 7 days: draw the following ones too.
      const period = w.window === '30d' ? 30 * DAY_MS : 7 * DAY_MS;
      for (let t = at; t <= endMs; t += period) {
        const key = Math.round(t / HOUR_MS);
        if (seen.has(key)) continue;
        seen.add(key);
        markers.push({ type: 'refill', atMs: t, window: w.window });
      }
    }
    const credits = account.credits
      .filter((c) => c.blocker !== 'expired')
      .sort((a, b) => (expiresAtMs(a) ?? Infinity) - (expiresAtMs(b) ?? Infinity));
    let lifeFrom = now;
    credits.forEach((credit, index) => {
      const at = expiresAtMs(credit);
      if (at === null) return;
      const v = creditVerdict(credit);
      const to = Math.min(at, endMs);
      if (to > lifeFrom) {
        markers.push({
          type: 'life',
          fromMs: lifeFrom,
          toMs: to,
          creditId: credit.id,
          faded: index > 0,
        });
        if (index === 0 && v.lapsesBeforeRefill && v.totalGain < LOW_VALUE_PCT) {
          markers.push({ type: 'waste', fromMs: lifeFrom, toMs: to, creditId: credit.id });
        }
      }
      if (at <= endMs) {
        markers.push({
          type: 'expiry',
          atMs: at,
          creditId: credit.id,
          title: credit.title,
          urgent: at - now <= LAPSE_SOON_MS,
        });
      }
      lifeFrom = Math.max(lifeFrom, to);
    });
    return { account, markers };
  });
  const ticks: number[] = [];
  const firstMidnight = new Date(now);
  firstMidnight.setHours(24, 0, 0, 0);
  const step = endMs - now > 16 * DAY_MS ? 4 * DAY_MS : 2 * DAY_MS;
  // Keep the first tick clear of the "now" label at the start of the axis.
  const minGap = (endMs - now) * 0.08;
  for (let t = firstMidnight.getTime(); t < endMs; t += step) {
    if (t - now >= minGap) ticks.push(t);
  }
  return { startMs: now, endMs, rows, ticks };
}

export const timelinePct = (t: Timeline, atMs: number) =>
  Math.max(0, Math.min(100, ((atMs - t.startMs) / (t.endMs - t.startMs)) * 100));
