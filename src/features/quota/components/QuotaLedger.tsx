/**
 * Ledger view: a provider summary strip above compact, provider-grouped rows.
 *
 * Reads only what the provider adapters already put in the quota store —
 * no extra requests. Rows keep the click-to-load contract: an unloaded
 * credential shows a Load action instead of meters.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { formatInstantShort, formatRelativeInstant, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { maskEmailsInText } from '../emailMask';
import { formatCodexPlanLabel } from '../providers/codex/data';
import {
  buildProviderSummary,
  extractLedgerLimits,
  groupByProvider,
  ledgerLevel,
  resolvePrimaryLimitId,
  selectRowLimits,
  type LedgerLevel,
  type LedgerLimit,
  type LedgerProviderSummary,
  type LedgerWindowSummary,
} from '../ledgerModel';
import styles from './QuotaLedger.module.scss';

export type QuotaLedgerProps = {
  /** Every filtered credential — the summary strip aggregates all of them. */
  summaryEntries: QuotaFileEntry[];
  /** The rows to render (current page, already sorted). */
  rowEntries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  showEmails: boolean;
  canRefresh: boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
};

const LEVEL_CLASS: Record<LedgerLevel, string> = {
  high: styles.levelHigh,
  medium: styles.levelMedium,
  low: styles.levelLow,
  unknown: styles.levelUnknown,
};

const formatPercent = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

const labelOf = (
  t: TFunction,
  item: { labelKey?: string; labelParams?: Record<string, string | number>; label: string }
) =>
  item.labelKey
    ? t(item.labelKey, { ...(item.labelParams ?? {}), defaultValue: item.label })
    : item.label;

function ProviderIcon({
  providerType,
  label,
  resolvedTheme,
}: {
  providerType: string;
  label: string;
  resolvedTheme: ResolvedTheme;
}) {
  const iconSrc = getAuthFileIcon(providerType, resolvedTheme);
  return (
    <span
      className={styles.iconWrap}
      aria-hidden="true"
      style={
        isThemeSurfaceIconProvider(providerType)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.icon} />
      ) : (
        <span className={styles.iconFallback}>{label.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

/** "in 1 day · 09/12, 23:00", or the no-reset fallback. */
function ResetText({
  atMs,
  now,
  emphasize,
}: {
  atMs: number | null;
  now: number;
  emphasize?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (atMs === null || atMs <= now) {
    return <span className={styles.resetMuted}>{t('quota_management.ledger_no_reset')}</span>;
  }
  return (
    <span className={styles.reset}>
      <span className={emphasize ? styles.resetRelativeStrong : styles.resetRelative}>
        {formatRelativeInstant(atMs, now, i18n.resolvedLanguage)}
      </span>
      <span className={styles.resetDot} aria-hidden="true">
        ·
      </span>
      <span>{formatInstantShort(atMs)}</span>
    </span>
  );
}

function SegmentBar({ window, label }: { window: LedgerWindowSummary; label: string }) {
  return (
    <div
      className={styles.segments}
      role="img"
      aria-label={`${label}: ${formatPercent(window.totalRemaining)}`}
    >
      {window.segments.map((segment, index) => (
        <span key={index} className={styles.segmentTrack}>
          <span
            className={`${styles.segmentFill} ${LEVEL_CLASS[segment.level]}`}
            style={{ width: `${segment.remaining ?? 0}%` } as CSSProperties}
          />
        </span>
      ))}
    </div>
  );
}

function SummaryCard({
  summary,
  resolvedTheme,
  now,
}: {
  summary: LedgerProviderSummary;
  resolvedTheme: ResolvedTheme;
  now: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const providerLabel = getTypeLabel(t, summary.provider);
  const primaryLabel = labelOf(t, summary.primary);
  const [firstSecondary, ...moreSecondary] = summary.secondary;
  const detailsId = `quota-ledger-summary-${summary.provider}`;

  return (
    <article className={styles.summaryCard} aria-label={providerLabel}>
      <header className={styles.summaryHead}>
        <ProviderIcon
          providerType={summary.provider}
          label={providerLabel}
          resolvedTheme={resolvedTheme}
        />
        <span className={styles.summaryName}>{providerLabel}</span>
        <span className={styles.summaryCount}>
          {t('quota_management.ledger_credentials', { count: summary.credentialCount })}
        </span>
      </header>
      <div className={styles.summaryLabel}>{primaryLabel}</div>
      <div className={styles.summaryFigure}>
        <span className={styles.summaryValue}>{formatPercent(summary.primary.totalRemaining)}</span>
        <span className={styles.summaryCapacity}>
          {t('quota_management.ledger_of_capacity', { capacity: summary.primary.capacity })}
        </span>
      </div>
      <SegmentBar window={summary.primary} label={primaryLabel} />
      <div className={styles.summaryReset}>
        <ResetText atMs={summary.primary.soonestResetMs} now={now} emphasize />
      </div>

      {firstSecondary && (
        <div className={styles.secondary}>
          <div className={styles.secondaryLine}>
            <span className={styles.secondaryLabel}>{labelOf(t, firstSecondary)}</span>
            <span className={styles.secondaryValue}>
              {formatPercent(firstSecondary.totalRemaining)}
            </span>
            <button
              type="button"
              className={styles.secondaryToggle}
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? t('quota_management.ledger_show_less')
                : t('quota_management.ledger_show_more')}
            </button>
          </div>
          {expanded && (
            <div id={detailsId} className={styles.secondaryDetails}>
              <div className={styles.secondaryBlock}>
                <SegmentBar window={firstSecondary} label={labelOf(t, firstSecondary)} />
                <div className={styles.summaryReset}>
                  <ResetText atMs={firstSecondary.soonestResetMs} now={now} />
                </div>
              </div>
              {moreSecondary.map((window) => {
                const label = labelOf(t, window);
                return (
                  <div key={window.id ?? label} className={styles.secondaryBlock}>
                    <div className={styles.secondaryLine}>
                      <span className={styles.secondaryLabel}>{label}</span>
                      <span className={styles.secondaryValue}>
                        {formatPercent(window.totalRemaining)}
                      </span>
                    </div>
                    <SegmentBar window={window} label={label} />
                    <div className={styles.summaryReset}>
                      <ResetText atMs={window.soonestResetMs} now={now} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function LimitMeter({ limit, now }: { limit: LedgerLimit; now: number }) {
  const { t } = useTranslation();
  const label = labelOf(t, limit);
  const level = ledgerLevel(limit.remaining);
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel} title={label}>
          {label}
        </span>
        <span className={styles.meterValue}>{formatPercent(limit.remaining)}</span>
      </div>
      <div
        className={styles.meterTrack}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={limit.remaining === null ? undefined : Math.round(limit.remaining)}
      >
        <span
          className={`${styles.meterFill} ${LEVEL_CLASS[level]}`}
          style={{ width: `${limit.remaining ?? 0}%` }}
        />
      </div>
      <div className={styles.meterReset}>
        <ResetText atMs={limit.resetAtMs} now={now} emphasize />
      </div>
    </div>
  );
}

const planLabelFor = (
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  t: TFunction
): string | null => {
  if (!quota || quota.status !== 'success') return null;
  if (entry.type === 'claude') {
    const planType = (quota as { planType?: string | null }).planType;
    return planType ? t(`claude_quota.${planType}`) : null;
  }
  if (entry.type === 'codex') {
    return formatCodexPlanLabel((quota as { planType?: string | null }).planType, t);
  }
  if (entry.type === 'xai') {
    return (quota as { billing?: { planLabel?: string } | null }).billing?.planLabel ?? null;
  }
  if (entry.type === 'devin') {
    return (quota as { plan?: string | null }).plan ?? null;
  }
  if (entry.type === 'meta') {
    return (quota as { data?: { planName?: string } }).data?.planName ?? null;
  }
  return null;
};

function LedgerRow({
  entry,
  quota,
  primaryId,
  showEmails,
  canRefresh,
  now,
  onRefresh,
}: {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  primaryId: string | null;
  showEmails: boolean;
  canRefresh: boolean;
  now: number;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const rawName = getQuotaDisplayName(entry.file);
  const name = showEmails ? rawName : maskEmailsInText(rawName);
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const limits = useMemo(
    () => selectRowLimits(entry.type, extractLedgerLimits(entry.type, quota), primaryId),
    [entry.type, quota, primaryId]
  );
  const plan = planLabelFor(entry, quota, t);

  let body;
  if (status === 'idle') {
    body = (
      <button
        type="button"
        className={styles.loadButton}
        onClick={onRefresh}
        disabled={!canRefresh}
        aria-label={t('quota_management.ledger_load_label', { name })}
      >
        <IconRefreshCw size={13} aria-hidden="true" />
        {t('quota_management.ledger_load')}
      </button>
    );
  } else if (loading) {
    body = (
      <span className={styles.rowStatus} role="status" aria-busy="true">
        {t('quota_management.ledger_loading')}
      </span>
    );
  } else if (status === 'error') {
    body = (
      <span className={styles.rowError} role="alert">
        {t('quota_management.ledger_load_failed', {
          message: resolveQuotaErrorMessage(
            t,
            quota?.errorStatus,
            quota?.error || t('common.unknown_error')
          ),
        })}
      </span>
    );
  } else if (limits.length === 0) {
    body = <span className={styles.rowStatus}>{t('quota_management.ledger_no_limits')}</span>;
  } else {
    body = limits.map((limit) => <LimitMeter key={limit.id} limit={limit} now={now} />);
  }

  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.fileName} title={showEmails ? rawName : undefined}>
          {name}
        </span>
        {plan && <span className={styles.plan}>{plan}</span>}
      </div>
      <div className={styles.meters}>{body}</div>
      <div className={styles.rowActions}>
        {status !== 'idle' && (
          <button
            type="button"
            className={styles.ghostAction}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, false)}
            aria-label={t('quota_management.ledger_refresh_label', { name })}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw
              size={13}
              aria-hidden="true"
              className={loading ? styles.spinning : undefined}
            />
            {t('auth_files.quota_refresh_single')}
          </button>
        )}
      </div>
    </li>
  );
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const { summaryEntries, rowEntries, quotaFor, resolvedTheme, showEmails, canRefresh, onRefresh } =
    props;
  const { t } = useTranslation();
  const now = useNow();

  const summaryGroups = useMemo(() => groupByProvider(summaryEntries), [summaryEntries]);
  const summaries = useMemo(
    () =>
      summaryGroups.map((group) =>
        buildProviderSummary(
          group.provider,
          group.entries.map((entry) => quotaFor(entry)),
          now
        )
      ),
    [summaryGroups, quotaFor, now]
  );
  // Rows use the same headline column as their provider's summary card.
  const primaryIds = useMemo(() => {
    const ids = new Map<QuotaProviderType, string | null>();
    summaryGroups.forEach((group) => {
      ids.set(
        group.provider,
        resolvePrimaryLimitId(
          group.provider,
          group.entries.map((entry) => extractLedgerLimits(entry.type, quotaFor(entry)))
        )
      );
    });
    return ids;
  }, [summaryGroups, quotaFor]);
  const rowGroups = useMemo(() => groupByProvider(rowEntries), [rowEntries]);

  return (
    <div className={styles.ledger}>
      {summaries.length > 0 && (
        <section className={styles.summary} aria-label={t('quota_management.ledger_summary_label')}>
          {summaries.map((summary) => (
            <SummaryCard
              key={summary.provider}
              summary={summary}
              resolvedTheme={resolvedTheme}
              now={now}
            />
          ))}
        </section>
      )}

      <div className={styles.groups} aria-label={t('quota_management.ledger_rows_label')}>
        {rowGroups.map((group) => {
          const providerLabel = getTypeLabel(t, group.provider);
          const headingId = `quota-ledger-group-${group.provider}`;
          return (
            <section key={group.provider} className={styles.group} aria-labelledby={headingId}>
              <h2 id={headingId} className={styles.groupTitle}>
                <span>{providerLabel}</span>
                <span className={styles.groupCount}>{group.entries.length}</span>
              </h2>
              <ul
                className={styles.rows}
                aria-label={t('quota_management.ledger_group_label', { provider: providerLabel })}
              >
                {group.entries.map((entry) => (
                  <LedgerRow
                    key={`${entry.type}:${getQuotaCacheKey(entry.file)}`}
                    entry={entry}
                    quota={quotaFor(entry)}
                    primaryId={primaryIds.get(group.provider) ?? null}
                    showEmails={showEmails}
                    canRefresh={canRefresh && !entry.file.disabled}
                    now={now}
                    onRefresh={() => onRefresh(entry)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
