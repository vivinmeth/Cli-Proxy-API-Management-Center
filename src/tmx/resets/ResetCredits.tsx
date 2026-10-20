/**
 * tokenmaxx fork: reset credits on the Ledger view — a summary cell in the provider strip, a
 * timeline of natural refills vs credit expiries, and per-row chips with a credit drawer.
 * Data comes from the backend's /tmx/resets (one shared read in useResetsStore).
 */
import { useEffect, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { useNotificationStore } from '@/stores';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import { maskEmailsInText } from '@/features/quota/emailMask';
import type { ResetAccount, ResetCredit, ResetRedemption, ResetWindow } from './api';
import {
  buildTimeline,
  creditVerdict,
  expiresAtMs,
  LOW_VALUE_PCT,
  summaryOf,
  timelinePct,
  type Verdict,
  type WindowGain,
} from './model';
import { useResetsStore, type RedeemResult } from './useResetsStore';
import styles from './ResetCredits.module.scss';

const KNOWN_WINDOWS = new Set(['5h', '7d', '7d_oi', '30d']);

const windowLabel = (t: TFunction, window: string) =>
  KNOWN_WINDOWS.has(window) ? t(`tmx_resets.window_${window}`) : window;

const gainsText = (t: TFunction, gains: WindowGain[]) =>
  gains
    .map((g) => t('tmx_resets.gain', { pct: g.usedPct, window: windowLabel(t, g.window) }))
    .join(', ');

const changesText = (t: TFunction, before: ResetWindow[], after: ResetWindow[]) =>
  after
    .map((w) => {
      const prev = before.find((b) => b.window === w.window);
      if (prev?.used_pct == null || w.used_pct == null) return null;
      return t('tmx_resets.change', {
        window: windowLabel(t, w.window),
        from: Math.round(100 - prev.used_pct),
        to: Math.round(100 - w.used_pct),
      });
    })
    .filter(Boolean)
    .join(', ');

function useRelative() {
  const { i18n } = useTranslation();
  return (atMs: number, now: number) => formatRelativeInstant(atMs, now, i18n.resolvedLanguage);
}

const accountName = (account: ResetAccount, showEmails: boolean) =>
  showEmails ? account.label : maskEmailsInText(account.label);

/** Loads /tmx/resets once per connection; the Ledger mounts this through the summary cell. */
function useResetsData() {
  const data = useResetsStore((s) => s.data);
  const load = useResetsStore((s) => s.load);
  useEffect(() => {
    void load(false);
  }, [load]);
  return data;
}

const accountFor = (accounts: ResetAccount[] | undefined, authIndex: string | null | undefined) =>
  authIndex ? accounts?.find((a) => a.auth_index === authIndex) : undefined;

// ---------- summary cell (inside the Ledger's provider strip) ----------

export function ResetsSummaryCell() {
  const { t } = useTranslation();
  const relative = useRelative();
  const now = useNow();
  const data = useResetsData();
  const loading = useResetsStore((s) => s.loading);
  const error = useResetsStore((s) => s.error);
  const load = useResetsStore((s) => s.load);
  const summary = useMemo(() => summaryOf(data), [data]);

  if (!data?.enabled || summary.accountsWithCredits === 0) return null;
  const tickets = (data.accounts ?? []).flatMap((a) =>
    a.credits
      .filter((c) => c.blocker !== 'expired')
      .map((c) => ({ id: `${a.auth_id}:${c.id}`, provider: a.provider, at: expiresAtMs(c) }))
  );
  tickets.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));

  return (
    <article className={styles.summaryCell} aria-label={t('tmx_resets.title')}>
      <header className={styles.summaryHead}>
        <span className={styles.summaryTitle}>{t('tmx_resets.title')}</span>
        {summary.lapseSoon > 0 && (
          <span className={`${styles.chip} ${styles.chipWarn}`}>
            {t('tmx_resets.lapse_soon', { count: summary.lapseSoon })}
          </span>
        )}
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => void load(true)}
          disabled={loading}
          aria-label={t('tmx_resets.refresh')}
          title={t('tmx_resets.refresh')}
        >
          <IconRefreshCw
            size={13}
            aria-hidden="true"
            className={loading ? styles.spinning : undefined}
          />
        </button>
      </header>
      <div className={styles.tickets} aria-hidden="true">
        {tickets.map((ticket) => (
          <span
            key={ticket.id}
            className={`${styles.ticket} ${
              ticket.at !== null && ticket.at - now <= 72 * 3_600_000 ? styles.ticketUrgent : ''
            }`}
            data-provider={ticket.provider}
          />
        ))}
      </div>
      <div className={styles.summaryLine}>
        <strong>{t('tmx_resets.banked', { count: summary.banked })}</strong>
        {summary.nextExpiry && (
          <span className={styles.muted}>
            {' · '}
            {t('tmx_resets.next_expires', { when: relative(summary.nextExpiry.atMs, now) })}
          </span>
        )}
      </div>
      {summary.pending > 0 && (
        <div className={styles.warnText}>
          {t('tmx_resets.pending_count', { count: summary.pending })}
        </div>
      )}
      {error && <div className={styles.errorText}>{t('tmx_resets.load_failed')}</div>}
    </article>
  );
}

// ---------- timeline panel ----------

export function ResetsTimeline({ showEmails }: { showEmails: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const data = useResetsStore((s) => s.data);
  const timeline = useMemo(
    () => (data?.enabled ? buildTimeline(data.accounts, now) : null),
    [data, now]
  );
  if (!timeline) return null;
  const history = data?.history ?? [];

  return (
    <section className={styles.panel} aria-label={t('tmx_resets.timeline_title')}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t('tmx_resets.timeline_title')}</h2>
        <span className={styles.muted}>{t('tmx_resets.timeline_hint')}</span>
      </div>
      <div className={styles.timeline}>
        <div className={styles.tlAxis}>
          <span />
          <div className={styles.tlTicks}>
            <span className={styles.tlNowLabel} style={{ left: '0%' }}>
              {t('tmx_resets.legend_now')}
            </span>
            {timeline.ticks.map((tick) => (
              <span key={tick} style={{ left: `${timelinePct(timeline, tick)}%` }}>
                {new Date(tick).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
            ))}
          </div>
        </div>
        {timeline.rows.map((row) => (
          <div key={row.account.auth_id} className={styles.tlRow}>
            <div className={styles.tlLabel}>
              <span className={styles.providerTag} data-provider={row.account.provider}>
                {row.account.provider}
              </span>
              <span className={styles.mono}>{accountName(row.account, showEmails)}</span>
            </div>
            <div className={styles.tlLane}>
              <span className={styles.tlNow} />
              {row.markers.map((m, i) => {
                if (m.type === 'refill') {
                  return (
                    <span
                      key={`r${i}`}
                      className={styles.tlRefill}
                      style={{ left: `${timelinePct(timeline, m.atMs)}%` }}
                      title={`${windowLabel(t, m.window)} · ${formatInstantShort(m.atMs)}`}
                    >
                      <span>↻ {windowLabel(t, m.window)}</span>
                    </span>
                  );
                }
                if (m.type === 'life' || m.type === 'waste') {
                  const left = timelinePct(timeline, m.fromMs);
                  const style: CSSProperties = {
                    left: `${left}%`,
                    width: `${timelinePct(timeline, m.toMs) - left}%`,
                  };
                  return m.type === 'waste' ? (
                    <span key={`w${i}`} className={styles.tlWaste} style={style} />
                  ) : (
                    <span
                      key={`l${i}`}
                      className={`${styles.tlLife} ${m.faded ? styles.tlLifeFaded : ''}`}
                      data-provider={row.account.provider}
                      style={style}
                    />
                  );
                }
                return (
                  <span
                    key={`e${i}`}
                    className={`${styles.tlExpiry} ${m.urgent ? styles.tlExpiryUrgent : ''}`}
                    style={{ left: `${timelinePct(timeline, m.atMs)}%` }}
                    title={t('tmx_resets.expires', { date: formatInstantShort(m.atMs) })}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.legend}>
        <span>
          <i className={styles.legendRefill} />
          {t('tmx_resets.legend_refill')}
        </span>
        <span>
          <i className={styles.legendLife} />
          {t('tmx_resets.legend_credit')}
        </span>
        <span>
          <i className={styles.legendWaste} />
          {t('tmx_resets.legend_waste')}
        </span>
        <span>
          <i className={styles.legendNow} />
          {t('tmx_resets.legend_now')}
        </span>
      </div>
      {history.length > 0 && (
        <details className={styles.history}>
          <summary>{t('tmx_resets.history_title', { count: history.length })}</summary>
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                <span className={styles.muted}>{formatInstantShort(Date.parse(h.created_at))}</span>
                <span className={styles.mono}>
                  {showEmails ? h.label : maskEmailsInText(h.label)}
                </span>
                <span>{h.credit_title || h.credit_id}</span>
                <span className={h.state === 'pending' ? styles.warnText : undefined}>
                  {t(`tmx_resets.outcome_${h.outcome || 'unknown'}`, { defaultValue: h.outcome })}
                  {h.confirmed ? ' ✓' : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ---------- row chip + drawer ----------

export function ResetCreditChip({ authIndex, name }: { authIndex: string | null; name: string }) {
  const { t } = useTranslation();
  const relative = useRelative();
  const now = useNow();
  const accounts = useResetsStore((s) => s.data?.accounts);
  const open = useResetsStore((s) => (authIndex ? Boolean(s.open[authIndex]) : false));
  const toggle = useResetsStore((s) => s.toggle);
  const account = accountFor(accounts, authIndex);
  const live = account?.credits.filter((c) => c.blocker !== 'expired') ?? [];
  if (!account || !authIndex || (live.length === 0 && !account.pending)) return null;
  const count = live.reduce((sum, c) => sum + Math.max(1, c.resets_left), 0);
  const next = live
    .map((c) => expiresAtMs(c))
    .filter((v): v is number => v !== null && v > now)
    .sort((a, b) => a - b)[0];
  const urgent = next !== undefined && next - now <= 72 * 3_600_000;
  return (
    <button
      type="button"
      className={`${styles.chip} ${styles.chipButton} ${
        account.pending ? styles.chipWarn : urgent ? styles.chipBad : ''
      }`}
      aria-expanded={open}
      aria-label={t('tmx_resets.chip_label', { name })}
      onClick={() => toggle(authIndex)}
    >
      <span aria-hidden="true">🎫</span>
      {next !== undefined
        ? t('tmx_resets.chip', { count, when: relative(next, now) })
        : t('tmx_resets.chip_count', { count })}
      <span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
  );
}

function verdictText(
  t: TFunction,
  v: Verdict,
  account: ResetAccount,
  relative: (at: number) => string
) {
  const refill = v.refillAtMs !== null ? formatInstantShort(v.refillAtMs) : '';
  switch (v.kind) {
    case 'pending':
      return {
        tone: 'warn',
        head: t('tmx_resets.verdict_pending'),
        body: t('tmx_resets.verdict_pending_detail'),
      };
    case 'blocked': {
      const cooldown = account.cooldown_until
        ? formatInstantShort(Date.parse(account.cooldown_until))
        : '';
      return {
        tone: 'muted',
        head: t('tmx_resets.verdict_blocked'),
        body: t(`tmx_resets.blocker_${v.blocker}`, { date: cooldown, defaultValue: v.blocker }),
      };
    }
    case 'nothing':
      return {
        tone: v.lapsesBeforeRefill ? 'warn' : 'muted',
        head: t('tmx_resets.verdict_nothing'),
        body: [
          v.warning === 'nothing_to_clear'
            ? t('tmx_resets.verdict_nothing_codex')
            : t('tmx_resets.verdict_nothing_detail'),
          v.lapsesBeforeRefill ? t('tmx_resets.verdict_lapses', { date: refill }) : '',
        ]
          .filter(Boolean)
          .join(' '),
      };
    case 'use_now': {
      return {
        tone: 'good',
        head: t('tmx_resets.verdict_use_now'),
        body: t('tmx_resets.verdict_use_now_detail', {
          gains: gainsText(t, v.gains),
          when: v.refillAtMs !== null ? relative(v.refillAtMs) : '—',
        }),
      };
    }
    case 'use_or_lose':
      return {
        tone: 'warn',
        head: t('tmx_resets.verdict_use_or_lose'),
        body: t('tmx_resets.verdict_use_or_lose_detail', {
          gains: gainsText(t, v.gains),
          date: refill,
        }),
      };
    default:
      return {
        tone: 'good',
        head: t('tmx_resets.verdict_hold'),
        body: t('tmx_resets.verdict_hold_detail'),
      };
  }
}

function MiniMeter({ remaining }: { remaining: number }) {
  return (
    <span className={styles.miniTrack}>
      <span
        className={styles.miniFill}
        style={{ width: `${Math.max(0, Math.min(100, remaining))}%` }}
      />
    </span>
  );
}

function RedeemConfirm({
  account,
  credit,
  verdict,
}: {
  account: ResetAccount;
  credit: ResetCredit;
  verdict: Verdict;
}) {
  const { t } = useTranslation();
  const clears = new Set(credit.clears);
  const left = account.credits.filter((c) => !c.blocker).length - 1;
  return (
    <div className={styles.confirm}>
      <p className={styles.muted}>{t('tmx_resets.confirm_irreversible')}</p>
      <div className={styles.confirmBars}>
        {account.windows.map((w) => {
          const remaining = 100 - (w.used_pct ?? 0);
          const cleared = clears.size === 0 || clears.has(w.window);
          return (
            <div key={w.window} className={styles.confirmBar}>
              <span>{windowLabel(t, w.window)}</span>
              <MiniMeter remaining={remaining} />
              <span className={styles.muted}>→</span>
              {cleared ? (
                <MiniMeter remaining={100} />
              ) : (
                <span className={styles.muted}>{t('tmx_resets.unchanged')}</span>
              )}
            </div>
          );
        })}
      </div>
      <dl className={styles.kv}>
        <dt>{t('tmx_resets.confirm_spends')}</dt>
        <dd>
          {credit.title || credit.id}
          {credit.expires_at
            ? ` · ${t('tmx_resets.expires', { date: formatInstantShort(Date.parse(credit.expires_at)) })}`
            : ''}
        </dd>
        <dt>{t('tmx_resets.confirm_returns')}</dt>
        <dd>
          {verdict.gains.length > 0
            ? gainsText(t, verdict.gains)
            : t('tmx_resets.confirm_returns_none')}
        </dd>
        <dt>{t('tmx_resets.confirm_left')}</dt>
        <dd>{t('tmx_resets.confirm_left_value', { count: Math.max(0, left) })}</dd>
        <dt>{t('tmx_resets.confirm_also')}</dt>
        <dd>{t('tmx_resets.confirm_also_value')}</dd>
      </dl>
      {verdict.warning === 'nothing_to_clear' || verdict.totalGain === 0 ? (
        <div className={styles.callout}>{t('tmx_resets.confirm_nothing')}</div>
      ) : verdict.kind !== 'use_now' && verdict.totalGain < LOW_VALUE_PCT ? (
        <div className={styles.callout}>{t('tmx_resets.confirm_low_value')}</div>
      ) : null}
    </div>
  );
}

function ResultStatus({
  result,
  account,
  onDismiss,
}: {
  result: RedeemResult;
  account: ResetAccount;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  if (result.state === 'running') {
    return (
      <div className={styles.result} role="status" aria-busy="true">
        <IconRefreshCw size={13} aria-hidden="true" className={styles.spinning} />{' '}
        {t('tmx_resets.using')}
      </div>
    );
  }
  let tone = 'bad';
  let lines: string[];
  if (result.state === 'refused') {
    lines = [t(`tmx_resets.blocker_${result.blocker}`, { date: '', defaultValue: result.blocker })];
  } else if (result.state === 'error') {
    lines = [t('tmx_resets.result_error', { message: result.message })];
  } else {
    const r: ResetRedemption = result.redemption;
    const provider =
      account.provider === 'claude'
        ? 'Anthropic'
        : account.provider === 'codex'
          ? 'OpenAI'
          : account.provider;
    if (r.outcome === 'reset' || r.outcome === 'already_redeemed') {
      tone = r.confirmed ? 'good' : 'warn';
      lines = [
        `✓ ${t(r.outcome === 'reset' ? 'tmx_resets.step_redeemed' : 'tmx_resets.outcome_already_redeemed', { provider })}`,
        r.warning === 'cooldown_not_cleared'
          ? `! ${t('tmx_resets.warning_cooldown_not_cleared')}`
          : `✓ ${t('tmx_resets.step_cooldown')}`,
        r.confirmed
          ? `✓ ${t('tmx_resets.step_confirmed', { changes: changesText(t, r.before, r.after) })}`
          : `? ${t('tmx_resets.result_unconfirmed')}`,
      ];
    } else {
      tone = r.state === 'pending' || r.outcome === 'nothing_to_reset' ? 'warn' : 'bad';
      lines = [t(`tmx_resets.result_${r.outcome}`, { defaultValue: r.outcome })];
    }
  }
  return (
    <div className={`${styles.result} ${styles[`tone_${tone}`] ?? ''}`} role="status">
      <div className={styles.resultLines}>
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <button type="button" className={styles.linkButton} onClick={onDismiss}>
        {t('tmx_resets.dismiss')}
      </button>
    </div>
  );
}

export function ResetCreditDrawer({
  authIndex,
  name,
  onRedeemed,
}: {
  authIndex: string | null;
  name: string;
  onRedeemed?: () => void;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const relativeFn = useRelative();
  const accounts = useResetsStore((s) => s.data?.accounts);
  const open = useResetsStore((s) => (authIndex ? Boolean(s.open[authIndex]) : false));
  const account = accountFor(accounts, authIndex);
  const result = useResetsStore((s) => (account ? s.results[account.auth_id] : undefined));
  const redeem = useResetsStore((s) => s.redeem);
  const dismiss = useResetsStore((s) => s.dismiss);
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);
  if (!account || (!open && !result)) return null;
  const credits = account.credits.filter((c) => c.blocker !== 'expired');
  const busy = result?.state === 'running';

  const confirm = (credit: ResetCredit, verdict: Verdict) => {
    const retry = verdict.kind === 'pending';
    const expires = credit.expires_at ? formatInstantShort(Date.parse(credit.expires_at)) : '';
    showConfirmation({
      title: retry ? t('tmx_resets.confirm_retry_title') : t('tmx_resets.confirm_title', { name }),
      message: retry ? (
        t('tmx_resets.confirm_retry_text')
      ) : (
        <RedeemConfirm account={account} credit={credit} verdict={verdict} />
      ),
      confirmText: retry
        ? t('tmx_resets.retry')
        : expires
          ? t('tmx_resets.confirm_button', { date: expires })
          : t('tmx_resets.confirm_button_noexp'),
      variant: 'primary',
      onConfirm: async () => {
        const res = await redeem(account, credit.id);
        if (res.state === 'done' && onRedeemed) onRedeemed();
      },
    });
  };

  return (
    <div className={styles.drawer}>
      {open && (
        <ul className={styles.credits}>
          {account.error && (
            <li className={styles.readError}>
              {t('tmx_resets.read_error', { code: account.error })}
            </li>
          )}
          {credits.length === 0 && <li className={styles.muted}>{t('tmx_resets.none')}</li>}
          {credits.map((credit) => {
            const v = creditVerdict(credit);
            const text = verdictText(t, v, account, (at) => relativeFn(at, now));
            const at = v.expiresAtMs;
            const urgent = at !== null && at - now <= 72 * 3_600_000;
            const canClick = (v.spendable && v.kind !== 'blocked') || v.kind === 'pending';
            return (
              <li key={credit.id} className={styles.credit}>
                <span
                  className={styles.creditIcon}
                  data-provider={account.provider}
                  aria-hidden="true"
                />
                <div className={styles.creditMain}>
                  <div className={styles.creditTitle}>
                    {credit.title || credit.id}
                    {credit.resets_left > 1 && (
                      <span className={styles.muted}> ×{credit.resets_left}</span>
                    )}
                    {at !== null && (
                      <span className={`${styles.chip} ${urgent ? styles.chipBad : ''}`}>
                        {t('tmx_resets.lapses', { when: relativeFn(at, now) })}
                      </span>
                    )}
                  </div>
                  <div className={styles.muted}>
                    {at !== null && t('tmx_resets.expires', { date: formatInstantShort(at) })}
                    {credit.clears.length > 0 &&
                      ` · ${t('tmx_resets.clears', {
                        windows: credit.clears.map((w) => windowLabel(t, w)).join(' + '),
                      })}`}
                  </div>
                </div>
                <div className={`${styles.verdict} ${styles[`tone_${text.tone}`] ?? ''}`}>
                  <strong>{text.head}</strong> <span>{text.body}</span>
                  {!v.spendable && v.kind !== 'blocked' && v.kind !== 'pending' && (
                    <span className={styles.muted}> {t('tmx_resets.later_credit')}</span>
                  )}
                </div>
                <button
                  type="button"
                  className={`${styles.useButton} ${
                    v.kind === 'use_now' || v.kind === 'use_or_lose' || v.kind === 'pending'
                      ? styles.useButtonPrimary
                      : ''
                  }`}
                  disabled={!canClick || busy}
                  onClick={() => confirm(credit, v)}
                >
                  {v.kind === 'pending' ? t('tmx_resets.retry') : t('tmx_resets.use')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {result && (
        <ResultStatus
          result={result}
          account={account}
          onDismiss={() => dismiss(account.auth_id)}
        />
      )}
    </div>
  );
}
