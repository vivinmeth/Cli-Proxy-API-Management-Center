/**
 * Reset-credit state for the Ledger: one shared read of /tmx/resets, which drawers are open, and
 * the last redeem result per account (kept until dismissed — it is not a toast).
 */
import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import { resetsApi, type ResetAccount, type ResetRedemption, type ResetsResponse } from './api';

export type RedeemResult =
  | { state: 'running'; creditId: string }
  | { state: 'done'; redemption: ResetRedemption }
  | { state: 'refused'; blocker: string }
  | { state: 'error'; message: string };

interface ResetsState {
  data: ResetsResponse | null;
  revision: number | null;
  loading: boolean;
  error: string | null;
  open: Record<string, boolean>;
  results: Record<string, RedeemResult>;
  load: (refresh?: boolean) => Promise<void>;
  toggle: (authIndex: string) => void;
  dismiss: (authId: string) => void;
  redeem: (account: ResetAccount, creditId: string) => Promise<RedeemResult>;
}

const errorMessage = (err: unknown) =>
  err instanceof Error && err.message ? err.message : String(err ?? 'unknown error');

const blockerOf = (err: unknown): string | null => {
  const details = (err as { status?: number; details?: unknown } | null)?.details;
  const status = (err as { status?: number } | null)?.status;
  if (status === 409 && details && typeof details === 'object') {
    const blocker = (details as Record<string, unknown>).blocker;
    if (typeof blocker === 'string') return blocker;
  }
  return null;
};

let inflight: Promise<void> | null = null;

export const useResetsStore = create<ResetsState>((set, get) => ({
  data: null,
  revision: null,
  loading: false,
  error: null,
  open: {},
  results: {},

  load: async (refresh = false) => {
    const revision = apiClient.getConnectionRevision();
    if (get().revision !== revision) {
      // New connection: never show another backend's accounts or results.
      set({ data: null, revision, open: {}, results: {}, error: null });
    }
    if (inflight && !refresh) return inflight;
    set({ loading: true });
    const run = resetsApi
      .list(refresh)
      .then((data) => {
        if (apiClient.getConnectionRevision() !== revision) return;
        set({ data, error: null });
      })
      .catch((err: unknown) => {
        if (apiClient.getConnectionRevision() !== revision) return;
        set({ error: errorMessage(err) });
      })
      .finally(() => {
        if (inflight === run) inflight = null;
        if (apiClient.getConnectionRevision() === revision) set({ loading: false });
      });
    inflight = run;
    return run;
  },

  toggle: (authIndex) =>
    set((state) => ({ open: { ...state.open, [authIndex]: !state.open[authIndex] } })),

  dismiss: (authId) =>
    set((state) => {
      const results = { ...state.results };
      delete results[authId];
      return { results };
    }),

  redeem: async (account, creditId) => {
    const revision = apiClient.getConnectionRevision();
    const running: RedeemResult = { state: 'running', creditId };
    set((state) => ({ results: { ...state.results, [account.auth_id]: running } }));
    let result: RedeemResult;
    try {
      const res = await resetsApi.redeem(account.auth_id, creditId);
      result = { state: 'done', redemption: res.redemption };
      if (apiClient.getConnectionRevision() === revision && res.account) {
        const fresh = res.account;
        set((state) => {
          if (!state.data) return {};
          const accounts = state.data.accounts.map((a) =>
            a.auth_id === fresh.auth_id ? fresh : a
          );
          const history = [
            res.redemption,
            ...state.data.history.filter((h) => h.id !== res.redemption.id),
          ];
          return { data: { ...state.data, accounts, history } };
        });
      }
    } catch (err: unknown) {
      const blocker = blockerOf(err);
      result = blocker
        ? { state: 'refused', blocker }
        : { state: 'error', message: errorMessage(err) };
    }
    if (apiClient.getConnectionRevision() === revision) {
      set((state) => ({ results: { ...state.results, [account.auth_id]: result } }));
      // The summary and the other credits' verdicts are server-computed: re-read the (cached) list.
      if (result.state === 'done') void get().load(false);
    }
    return result;
  },
}));
