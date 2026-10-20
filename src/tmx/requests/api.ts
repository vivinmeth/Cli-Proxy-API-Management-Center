// tokenmaxx fork: client for the persistent request log (/v8/management/tmx/requests*).
import { apiClient } from '@/services/api/client';

export type RequestOutcome = 'success' | 'failed' | 'canceled';

export interface RequestCounts {
  attempts: number;
  requests: number;
  success: number;
  failed: number;
  canceled: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_creation: number;
  cached_tokens: number;
  total_tokens: number;
  prompt_tokens: number;
  cache_hit_tokens: number;
  cache_hit_ratio: number;
  avg_latency_ms: number;
  p50_ttft_ms: number;
  p95_ttft_ms: number;
}

export interface RequestBucket extends RequestCounts {
  start: string;
}

export interface RequestGroup extends RequestCounts {
  key: string;
  label: string;
  provider: string;
}

export interface RequestSummary {
  from: string;
  to: string;
  bucket_seconds: number;
  totals: RequestCounts;
  buckets: RequestBucket[] | null;
  by_auth: RequestGroup[] | null;
  by_model: RequestGroup[] | null;
  sessions: { total: number; multi_auth: number };
  writer: Record<string, number>;
}

export interface RequestItem {
  id: number;
  ts: string;
  trace_id: string;
  session_id: string;
  provider: string;
  model: string;
  auth_id: string;
  auth_label: string;
  client_ip: string;
  user_agent: string;
  stream: boolean;
  outcome: RequestOutcome;
  status_code: number;
  error: string;
  latency_ms: number;
  ttft_ms: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read: number;
  cache_creation: number;
  total_tokens: number;
}

export interface RequestListFilter {
  from: number;
  to: number;
  outcome?: RequestOutcome | '';
  authId?: string;
  model?: string;
  beforeId?: number;
  limit?: number;
}

const TIMEOUT_MS = 20 * 1000;

export const requestLogApi = {
  summary: (from: number, to: number) =>
    apiClient.get<{ enabled: boolean; summary?: RequestSummary }>('/tmx/requests/summary', {
      params: { from, to },
      timeout: TIMEOUT_MS,
    }),
  list: (filter: RequestListFilter) =>
    apiClient.get<{ enabled: boolean; items: RequestItem[]; next_before_id?: number }>(
      '/tmx/requests',
      {
        params: {
          from: filter.from,
          to: filter.to,
          outcome: filter.outcome || undefined,
          auth_id: filter.authId || undefined,
          model: filter.model || undefined,
          before_id: filter.beforeId || undefined,
          limit: filter.limit ?? 50,
        },
        timeout: TIMEOUT_MS,
      }
    ),
};

/** Cache hit share of prompt tokens, 0..1; null when there were no prompt tokens. */
export function cacheHitRatio(counts: Pick<RequestCounts, 'prompt_tokens' | 'cache_hit_tokens'>) {
  return counts.prompt_tokens > 0 ? counts.cache_hit_tokens / counts.prompt_tokens : null;
}
