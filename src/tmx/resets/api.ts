// tokenmaxx fork: client for banked reset credits (/v8/management/tmx/resets*).
import { apiClient } from '@/services/api/client';

/** Window names follow the backend: 5h, 7d, 7d_oi (weekly incl. overage), 30d. */
export interface ResetWindow {
  window: string;
  used_pct: number | null;
  resets_at: string | null;
}

export interface ResetCredit {
  id: string;
  title: string;
  granted_at?: string;
  starts_at?: string;
  expires_at?: string;
  clears: string[];
  resets_left: number;
  /** Hard: the provider would refuse it now. */
  blocker?: string;
  /** Soft: allowed, but likely returns nothing. */
  warning?: string;
  /** Server recommendation, computed per response. */
  verdict?: ResetVerdict;
}

export interface ResetVerdict {
  kind: 'pending' | 'blocked' | 'nothing' | 'use_now' | 'use_or_lose' | 'hold';
  gains: { window: string; used_pct: number }[];
  total_gain: number;
  refill_at?: string;
  lapses_before_refill: boolean;
  lapses_soon: boolean;
  /** The credit a redeem should target (soonest expiry without a blocker). */
  spendable: boolean;
}

export interface ResetsSummary {
  banked: number;
  lapse_soon: number;
  accounts_with_credits: number;
  pending: number;
  next_expiry: { at: string; auth_id: string; provider: string; credit_id: string } | null;
}

export interface ResetRedemption {
  id: number;
  created_at: string;
  settled_at?: string;
  auth_id: string;
  provider: string;
  label: string;
  credit_id: string;
  credit_title: string;
  state: 'pending' | 'settled';
  outcome: string;
  confirmed: boolean;
  warning?: string;
  before: ResetWindow[];
  after: ResetWindow[];
}

export interface ResetAccount {
  auth_id: string;
  auth_index: string;
  provider: string;
  label: string;
  plan: string;
  checked_at: string | null;
  error?: string;
  eligible: boolean;
  ineligible_reason?: string;
  at_limit: boolean;
  cooldown_until?: string;
  applicable_count?: number;
  windows: ResetWindow[];
  credits: ResetCredit[];
  next_credit_id?: string;
  pending?: ResetRedemption;
}

export interface ResetsResponse {
  enabled: boolean;
  generated_at?: string;
  summary?: ResetsSummary;
  accounts: ResetAccount[];
  history: ResetRedemption[];
}

export interface RedeemResponse {
  redemption: ResetRedemption;
  account?: ResetAccount;
}

/** Redeem = upstream claim (≤25 s) + two reads; leave headroom. */
const REDEEM_TIMEOUT_MS = 90_000;

export const resetsApi = {
  list: (refresh = false) =>
    apiClient.get<ResetsResponse>('/tmx/resets', {
      params: refresh ? { refresh: 1 } : undefined,
      timeout: 60_000,
    }),
  poll: (authId: string) =>
    apiClient.post<{ account: ResetAccount; throttled: boolean }>('/tmx/resets/poll', undefined, {
      params: { auth_id: authId },
      timeout: 60_000,
    }),
  redeem: (authId: string, creditId: string) =>
    apiClient.post<RedeemResponse>(
      '/tmx/resets/redeem',
      { auth_id: authId, credit_id: creditId, actor: 'tmx-ui' },
      { timeout: REDEEM_TIMEOUT_MS }
    ),
};
