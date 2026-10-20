// tokenmaxx fork: quota snapshots recorded by the proxy (/tmx/quota/*).
import { apiClient } from '@/services/api/client';

export interface QuotaWindowNow {
  window: string;
  used_pct: number | null;
  resets_at: string | null;
  status?: string;
  observed_at: string;
  source: 'passive' | 'polled';
  stale?: boolean;
}

export interface QuotaAccountNow {
  auth_id: string;
  auth_index: string;
  provider: string;
  label: string;
  plan: string;
  windows: QuotaWindowNow[];
  last_poll_at: string | null;
  next_poll_at: string | null;
  poll_error?: string;
  passive_fresh?: boolean;
}

export interface QuotaSnapshot {
  ts: string;
  auth_id: string;
  provider: string;
  label: string;
  plan: string;
  window: string;
  used_pct: number | null;
  resets_at: string | null;
  status?: string;
  source: string;
}

const TIMEOUT_MS = 30 * 1000;

export const quotaHistoryApi = {
  current: () =>
    apiClient.get<{ enabled: boolean; accounts: QuotaAccountNow[] }>('/tmx/quota/current', {
      timeout: TIMEOUT_MS,
    }),
  history: (from: number, to: number) =>
    apiClient.get<{ enabled: boolean; snapshots: QuotaSnapshot[]; truncated?: boolean }>(
      '/tmx/quota/history',
      { params: { from, to, limit: 100000 }, timeout: TIMEOUT_MS }
    ),
};
