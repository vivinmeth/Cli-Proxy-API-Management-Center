/**
 * Ledger view model: every credential's limits flattened to one comparable
 * shape, plus the per-provider summary that sits above the rows.
 *
 * The card bodies render each provider's state on its own terms. The ledger
 * instead lines credentials up in columns, which needs the same few facts from
 * every provider — remaining percent, reset instant, window length — so they
 * are extracted here once. Everything is derived from the state the provider
 * adapters already fetched; nothing here talks to the network or the store.
 *
 * Pure and React-free: `nowMs` is passed in, so aggregation is directly tested.
 */

import { parseIsoToMs } from '@/utils/quota';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './constants';
import type { QuotaProviderType } from './providers/types';

/** One limit on one credential, normalized to percent REMAINING. */
export interface LedgerLimit {
  id: string;
  /** Translation key when the provider labels rows by key. */
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  /** Literal label; used when there is no key, or as the key's fallback. */
  label: string;
  /** Remaining percent, 0..100; null when the provider did not report usage. */
  remaining: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

export type LedgerLevel = 'high' | 'medium' | 'low' | 'unknown';

/** Same thresholds as the card meters, so a colour means the same thing on both views. */
export function ledgerLevel(remaining: number | null): LedgerLevel {
  if (remaining === null || !Number.isFinite(remaining)) return 'unknown';
  if (remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD) return 'high';
  if (remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const remainingFromUsed = (used: unknown): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(100 - used) : null;

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const WEEK_HOURS = 24 * 7;

/**
 * Preferred "headline" window per provider, most preferred first. The summary
 * strip aggregates this window; rows put it in the first column.
 */
export const LEDGER_PRIMARY_PREFERENCE: Partial<Record<QuotaProviderType, readonly string[]>> = {
  claude: ['seven-day-fable', 'seven-day'],
  codex: ['weekly', 'monthly'],
  xai: ['weekly', 'monthly'],
  kimi: ['summary', 'monthly'],
  devin: ['weekly', 'daily'],
  meta: ['weekly', 'window'],
};

/**
 * Windows that stay out of the ledger entirely. Claude's Opus bucket is
 * deprioritized upstream and would only crowd out the Fable/5-hour/7-day trio.
 */
export const LEDGER_HIDDEN_LIMITS: Partial<Record<QuotaProviderType, readonly string[]>> = {
  claude: ['seven-day-opus'],
};

/** Label shown for a provider's headline window before anything has loaded. */
export const LEDGER_DEFAULT_PRIMARY_LABEL_KEY: Partial<Record<QuotaProviderType, string>> = {
  claude: 'claude_quota.seven_day',
  codex: 'codex_quota.secondary_window',
  xai: 'xai_quota.weekly_limit',
  kimi: 'kimi_quota.weekly_limit',
  devin: 'devin_quota.weekly',
  meta: 'meta_quota.weekly',
};

/** Columns per credential row. */
export const LEDGER_ROW_LIMIT_COUNT = 3;

/* ---------------------------------------------------------- extraction */

interface WindowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface KimiRowLike {
  id: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  used: number;
  limit: number;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface XaiBillingLike {
  mode?: string;
  periodType?: string;
  usagePercent?: number | null;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
  monthlyLimitCents?: number | null;
  usedCents?: number | null;
  billingPeriodEnd?: string;
}

interface BucketLike {
  id?: string;
  label?: string;
  remainingFraction?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

/**
 * Every limit a loaded credential reports, in the provider's own order.
 * Anything not in `success` state has no limits — the row shows its status instead.
 */
export function extractLedgerLimits(provider: QuotaProviderType, quota: unknown): LedgerLimit[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  if (provider === 'claude' || provider === 'codex') {
    return ((quota as { windows?: WindowLike[] }).windows ?? []).map((window, index) => ({
      id: window.id || `window-${index}`,
      labelKey: window.labelKey,
      labelParams: window.labelParams,
      label: window.label ?? window.id ?? '',
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: finiteOrNull(window.resetAtMs),
      periodHours: finiteOrNull(window.periodHours),
    }));
  }

  if (provider === 'devin') {
    const windows =
      (
        quota as {
          windows?: {
            id: string;
            label?: string;
            remainingPercent: number | null;
            resetAtMs: number | null;
            periodHours: number;
          }[];
        }
      ).windows ?? [];
    return windows.map((window) => ({
      id: window.id,
      labelKey: `devin_quota.${window.id}`,
      label: window.label ?? window.id,
      remaining:
        finiteOrNull(window.remainingPercent) === null
          ? null
          : clampPercent(window.remainingPercent as number),
      resetAtMs: finiteOrNull(window.resetAtMs),
      periodHours: finiteOrNull(window.periodHours),
    }));
  }

  if (provider === 'kimi') {
    return ((quota as { rows?: KimiRowLike[] }).rows ?? []).map((row) => ({
      id: row.id,
      labelKey: row.labelKey,
      labelParams: row.labelParams,
      label: row.label ?? '',
      // Kimi reports raw counts; mirror KimiQuotaBody's derivation.
      remaining:
        row.limit > 0
          ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100))
          : row.used > 0
            ? 0
            : null,
      resetAtMs: finiteOrNull(row.resetAtMs),
      periodHours: finiteOrNull(row.periodHours),
    }));
  }

  if (provider === 'xai') {
    const billing = (quota as { billing?: XaiBillingLike | null }).billing;
    if (!billing || billing.mode === 'paid-health') return [];
    const limits: LedgerLimit[] = [];
    const weekly = billing.periodType === 'weekly';
    if (weekly) {
      limits.push({
        id: 'weekly',
        labelKey: 'xai_quota.weekly_limit',
        label: 'weekly',
        remaining: remainingFromUsed(billing.usagePercent),
        resetAtMs: finiteOrNull(billing.resetAtMs),
        periodHours: finiteOrNull(billing.periodHours) ?? WEEK_HOURS,
      });
    }
    const hasMonthly =
      (billing.monthlyLimitCents != null || billing.usedCents != null) &&
      !(weekly && billing.monthlyLimitCents === 0 && billing.usedCents === 0);
    if (hasMonthly) {
      limits.push({
        id: 'monthly',
        labelKey: 'xai_quota.monthly_credits',
        label: 'monthly',
        remaining: remainingFromUsed(billing.usedPercent),
        resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
        periodHours: null,
      });
    }
    return limits;
  }

  if (provider === 'antigravity' || provider === 'plugin') {
    return ((quota as { groups?: { buckets?: BucketLike[] }[] }).groups ?? [])
      .flatMap((group) => group.buckets ?? [])
      .map((bucket, index) => ({
        id: bucket.id || `bucket-${index}`,
        label: bucket.label ?? bucket.id ?? '',
        remaining:
          typeof bucket.remainingFraction === 'number' && Number.isFinite(bucket.remainingFraction)
            ? clampPercent(Math.round(bucket.remainingFraction * 100))
            : null,
        resetAtMs: finiteOrNull(bucket.resetAtMs),
        periodHours: finiteOrNull(bucket.periodHours),
      }));
  }

  if (provider === 'meta') {
    const windows =
      (
        quota as {
          data?: {
            windows?: {
              id: 'window' | 'weekly';
              usedPercent: number | null;
              resetAt?: number;
              durationMinutes?: number;
            }[];
          };
        }
      ).data?.windows ?? [];
    return windows.map((window) => ({
      id: window.id,
      labelKey: `meta_quota.${window.id}`,
      label: window.id,
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: finiteOrNull(window.resetAt) === null ? null : (window.resetAt as number) * 1000,
      periodHours:
        window.id === 'weekly'
          ? WEEK_HOURS
          : finiteOrNull(window.durationMinutes) === null
            ? null
            : (window.durationMinutes as number) / 60,
    }));
  }

  return [];
}

const visibleLimits = (provider: QuotaProviderType, limits: readonly LedgerLimit[]) => {
  const hidden = LEDGER_HIDDEN_LIMITS[provider] ?? [];
  return limits.filter((limit) => !hidden.includes(limit.id));
};

/**
 * The headline window id for one provider across a set of credentials.
 *
 * The first preferred id any credential reports wins, so every row puts the
 * same window in its first column. Without a preference hit, the longest
 * window of the first credential that reports anything is used.
 */
export function resolvePrimaryLimitId(
  provider: QuotaProviderType,
  limitsPerCredential: readonly (readonly LedgerLimit[])[]
): string | null {
  const visible = limitsPerCredential.map((limits) => visibleLimits(provider, limits));
  for (const id of LEDGER_PRIMARY_PREFERENCE[provider] ?? []) {
    if (visible.some((limits) => limits.some((limit) => limit.id === id))) return id;
  }
  for (const limits of visible) {
    if (limits.length === 0) continue;
    return limits.reduce((best, limit) =>
      (limit.periodHours ?? 0) > (best.periodHours ?? 0) ? limit : best
    ).id;
  }
  return null;
}

/**
 * Columns for one credential row: the provider's headline window first, then
 * the rest in the provider's own order, hidden buckets dropped.
 */
export function selectRowLimits(
  provider: QuotaProviderType,
  limits: readonly LedgerLimit[],
  primaryId: string | null,
  max = LEDGER_ROW_LIMIT_COUNT
): LedgerLimit[] {
  const visible = visibleLimits(provider, limits);
  const primary = primaryId ? visible.find((limit) => limit.id === primaryId) : undefined;
  const rest = visible.filter((limit) => limit !== primary);
  return (primary ? [primary, ...rest] : rest).slice(0, max);
}

/** Soonest instant strictly after `nowMs`, or null. */
export function soonestUpcomingReset(
  instants: readonly (number | null | undefined)[],
  nowMs: number
): number | null {
  let best: number | null = null;
  for (const atMs of instants) {
    if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs <= nowMs) continue;
    if (best === null || atMs < best) best = atMs;
  }
  return best;
}

/* ---------------------------------------------------------- summary */

export interface LedgerSegment {
  remaining: number | null;
  level: LedgerLevel;
}

/** One window aggregated across a provider's credentials. */
export interface LedgerWindowSummary {
  id: string | null;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  label: string;
  /** Sum of remaining percent across credentials; null when none is known. */
  totalRemaining: number | null;
  /** credentials × 100. */
  capacity: number;
  /** One per credential, in row order; unknown when not loaded or not reported. */
  segments: LedgerSegment[];
  soonestResetMs: number | null;
}

export interface LedgerProviderSummary {
  provider: QuotaProviderType;
  credentialCount: number;
  primary: LedgerWindowSummary;
  /** Other long (≥ 1 day) windows, e.g. Claude's 7-day limit under Fable. */
  secondary: LedgerWindowSummary[];
}

export interface LedgerCredentialInput {
  provider: QuotaProviderType;
  quota: unknown;
}

const DAY_HOURS = 24;

function summarizeWindow(
  id: string | null,
  limitsPerCredential: readonly (readonly LedgerLimit[])[],
  fallbackLabelKey: string | undefined,
  nowMs: number
): LedgerWindowSummary {
  let total: number | null = null;
  const segments: LedgerSegment[] = [];
  const resets: (number | null)[] = [];
  let sample: LedgerLimit | undefined;

  for (const limits of limitsPerCredential) {
    const limit = id === null ? undefined : limits.find((candidate) => candidate.id === id);
    sample ??= limit;
    const remaining = limit?.remaining ?? null;
    if (remaining !== null) total = (total ?? 0) + remaining;
    segments.push({ remaining, level: ledgerLevel(remaining) });
    resets.push(limit?.resetAtMs ?? null);
  }

  return {
    id,
    labelKey: sample ? sample.labelKey : fallbackLabelKey,
    labelParams: sample?.labelParams,
    label: sample?.label ?? '',
    totalRemaining: total,
    capacity: limitsPerCredential.length * 100,
    segments,
    soonestResetMs: soonestUpcomingReset(resets, nowMs),
  };
}

/**
 * Aggregate one provider's credentials into the summary-strip card.
 *
 * Every credential counts toward the capacity, loaded or not: "409% of 500%"
 * with one unloaded account is honest about the missing hundred, while
 * dropping it to "409% of 400%" would overstate what is left.
 */
export function buildProviderSummary(
  provider: QuotaProviderType,
  quotas: readonly unknown[],
  nowMs: number
): LedgerProviderSummary {
  const limitsPerCredential = quotas.map((quota) =>
    visibleLimits(provider, extractLedgerLimits(provider, quota))
  );
  const primaryId = resolvePrimaryLimitId(provider, limitsPerCredential);
  const primary = summarizeWindow(
    primaryId,
    limitsPerCredential,
    LEDGER_DEFAULT_PRIMARY_LABEL_KEY[provider] ?? 'quota_management.ledger_primary_window',
    nowMs
  );

  // Other long windows, ordered by the provider's preference, then by length.
  const preference = LEDGER_PRIMARY_PREFERENCE[provider] ?? [];
  const seen = new Map<string, { periodHours: number; order: number }>();
  limitsPerCredential.flat().forEach((limit) => {
    if (limit.id === primaryId || seen.has(limit.id)) return;
    if (limit.periodHours === null || limit.periodHours < DAY_HOURS) return;
    seen.set(limit.id, { periodHours: limit.periodHours, order: seen.size });
  });
  const rank = (id: string) => {
    const index = preference.indexOf(id);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  const secondary = [...seen.entries()]
    .sort(
      ([idA, a], [idB, b]) =>
        rank(idA) - rank(idB) || b.periodHours - a.periodHours || a.order - b.order
    )
    .map(([id]) => summarizeWindow(id, limitsPerCredential, undefined, nowMs));

  return { provider, credentialCount: quotas.length, primary, secondary };
}

/**
 * Group entries by provider, keeping the incoming order both for the groups
 * (first appearance) and within them — so "soonest recovery" ordering survives.
 */
export function groupByProvider<T extends { type: QuotaProviderType }>(
  entries: readonly T[]
): { provider: QuotaProviderType; entries: T[] }[] {
  const groups = new Map<QuotaProviderType, T[]>();
  for (const entry of entries) {
    const group = groups.get(entry.type);
    if (group) group.push(entry);
    else groups.set(entry.type, [entry]);
  }
  return [...groups.entries()].map(([provider, grouped]) => ({ provider, entries: grouped }));
}
