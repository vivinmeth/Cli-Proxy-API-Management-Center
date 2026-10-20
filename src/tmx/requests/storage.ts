// tokenmaxx fork: archive bucket usage (GET /tmx/archive/storage).
import { apiClient } from '@/services/api/client';

export interface EnvStorage {
  objects: number;
  bytes: number;
  packs: number;
  pack_bytes: number;
  loose: number;
  loose_bytes: number;
}

export interface StorageUsage {
  bucket: string;
  listed_at: string;
  objects: number;
  bytes: number;
  by_env: Record<string, EnvStorage>;
  storage_usd_month: number;
  this_env: string;
}

export interface CostEstimate {
  stored_gb: number;
  growth_gb_30d: number;
  writes_30d: number;
  month_usd_now: number;
  month_usd_in_12mo: number;
  warn_usd: number;
  warning: boolean;
}

export interface StorageResponse {
  enabled?: boolean;
  r2_configured?: boolean;
  storage?: StorageUsage;
  cost_estimate?: CostEstimate | null;
  error?: string;
}

export const archiveStorageApi = {
  get: (refresh = false) =>
    apiClient.get<StorageResponse>('/tmx/archive/storage', {
      params: refresh ? { refresh: 1 } : undefined,
      timeout: 150 * 1000,
    }),
};

export interface StorageRow extends EnvStorage {
  env: string;
  current: boolean;
}

/** Environment rows, this environment first, then by size. */
export function storageRows(usage: StorageUsage | undefined): StorageRow[] {
  if (!usage) return [];
  return Object.entries(usage.by_env)
    .map(([env, s]) => ({ ...s, env, current: env === usage.this_env }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.bytes - a.bytes);
}

/** US dollars with enough precision for cents-and-below amounts. */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return '< $0.01';
  return `$${value.toFixed(value < 10 ? 2 : 0)}`;
}
