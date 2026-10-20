/**
 * Pure logic for the reset-credit UI: what spending a credit now returns, whether it will lapse
 * before the windows it clears refill on their own, and the timeline geometry.
 */
import type { ResetAccount, ResetCredit, ResetWindow } from './api';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** A credit expiring within this is flagged "lapses soon". */
export const LAPSE_SOON_MS = 72 * HOUR_MS;
/** A blocked account whose natural refill is further away than this should spend now. */
export const USE_NOW_MIN_WAIT_MS = 12 * HOUR_MS;
/** Spending below this much total return is "low value". */
export const LOW_VALUE_PCT = 25;

export type VerdictKind =
  | 'blocked' // provider refuses it now (credit.blocker)
  | 'pending' // an earlier claim got no definite answer; retry reuses its id
  | 'use_now' // a cleared window is exhausted and won't refill for a while
  | 'use_or_lose' // something to clear, and it expires before the cleared windows refill
  | 'nothing' // nothing to clear right now
  | 'hold'; // outlives the next refill: keep it

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
  /** The credit the spend button targets for this account. */
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

const clearedWindows = (account: ResetAccount, credit: ResetCredit): ResetWindow[] => {
  const clears = new Set(credit.clears);
  return account.windows.filter((w) => clears.size === 0 || clears.has(w.window));
};

/** Soonest-expiring credit without a hard blocker; ties go to the provider's recommendation. */
export function spendableCredit(account: ResetAccount): ResetCredit | undefined {
  const usable = account.credits.filter((c) => !c.blocker);
  if (usable.length === 0) return undefined;
  const sorted = [...usable].sort((a, b) => {
    const ea = expiresAtMs(a) ?? Number.POSITIVE_INFINITY;
    const eb = expiresAtMs(b) ?? Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea - eb;
    if (a.id === account.next_credit_id) return -1;
    if (b.id === account.next_credit_id) return 1;
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0];
}

export function creditVerdict(account: ResetAccount, credit: ResetCredit, now: number): Verdict {
  const windows = clearedWindows(account, credit);
  const gains = windows
    .filter((w) => (w.used_pct ?? 0) > 0)
    .map((w) => ({ window: w.window, usedPct: Math.round(w.used_pct ?? 0) }));
  const totalGain = gains.reduce((sum, g) => sum + g.usedPct, 0);
  const refills = windows
    .map((w) => ms(w.resets_at))
    .filter((v): v is number => v !== null && v > now);
  const refillAtMs = refills.length > 0 ? Math.max(...refills) : null;
  const expires = expiresAtMs(credit);
  const lapsesBeforeRefill = expires !== null && refillAtMs !== null && expires < refillAtMs;
  const spendable = spendableCredit(account)?.id === credit.id;
  const base = {
    gains,
    totalGain,
    lapsesBeforeRefill,
    expiresAtMs: expires,
    refillAtMs,
    spendable,
    blocker: credit.blocker,
    warning: credit.warning,
  };

  if (account.pending && account.pending.credit_id === credit.id)
    return { ...base, kind: 'pending' };
  if (credit.blocker) return { ...base, kind: 'blocked' };
  if (totalGain === 0 || credit.warning === 'nothing_to_clear') return { ...base, kind: 'nothing' };
  const exhausted = windows.some((w) => {
    const reset = ms(w.resets_at);
    return (w.used_pct ?? 0) >= 99 && (reset === null || reset - now > USE_NOW_MIN_WAIT_MS);
  });
  if (exhausted) return { ...base, kind: 'use_now' };
  if (lapsesBeforeRefill) return { ...base, kind: 'use_or_lose' };
  return { ...base, kind: 'hold' };
}

export interface ResetsSummary {
  banked: number;
  lapseSoon: number;
  nextExpiry: { atMs: number; provider: string; label: string } | null;
  accountsWithCredits: number;
  pending: number;
}

export function summarize(accounts: ResetAccount[], now: number): ResetsSummary {
  let banked = 0;
  let lapseSoon = 0;
  let accountsWithCredits = 0;
  let pending = 0;
  let nextExpiry: ResetsSummary['nextExpiry'] = null;
  for (const account of accounts) {
    if (account.pending) pending += 1;
    const live = account.credits.filter((c) => c.blocker !== 'expired');
    if (live.length > 0) accountsWithCredits += 1;
    for (const credit of live) {
      banked += Math.max(1, credit.resets_left);
      const at = expiresAtMs(credit);
      if (at === null || at <= now) continue;
      if (at - now <= LAPSE_SOON_MS) lapseSoon += 1;
      if (!nextExpiry || at < nextExpiry.atMs) {
        nextExpiry = { atMs: at, provider: account.provider, label: account.label };
      }
    }
  }
  return { banked, lapseSoon, nextExpiry, accountsWithCredits, pending };
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
      const v = creditVerdict(account, credit, now);
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
