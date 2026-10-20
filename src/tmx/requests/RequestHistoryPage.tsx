// tokenmaxx fork: Request History - persistent per-call metrics from the proxy's Postgres log.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore } from '@/stores';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import { maskEmailsInText } from '@/features/quota/emailMask';
import {
  cacheHitRatio,
  requestLogApi,
  type RequestGroup,
  type RequestItem,
  type RequestOutcome,
  type RequestSummary,
} from './api';
import { RequestChart } from './RequestChart';
import { StoragePanel } from './StoragePanel';
import styles from './RequestHistoryPage.module.scss';

const RANGES = [
  { id: '1h', seconds: 3600 },
  { id: '6h', seconds: 6 * 3600 },
  { id: '24h', seconds: 24 * 3600 },
  { id: '7d', seconds: 7 * 86400 },
  { id: '30d', seconds: 30 * 86400 },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

const OUTCOME_FILTERS: ('' | RequestOutcome)[] = ['', 'failed', 'rejected', 'canceled', 'success'];

const ratioText = (ratio: number | null) => (ratio === null ? '—' : formatPercent(ratio * 100));
const msText = (ms: number) =>
  !ms
    ? '—'
    : ms >= 10000
      ? `${(ms / 1000).toFixed(0)}s`
      : ms >= 1000
        ? `${(ms / 1000).toFixed(1)}s`
        : `${Math.round(ms)}ms`;

export function RequestHistoryPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [range, setRange] = useState<RangeId>('24h');
  const [showEmails, setShowEmails] = useState(false);
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<'' | RequestOutcome>('');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [nextBefore, setNextBefore] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const windowRef = useRef({ from: 0, to: 0 });
  const requestSeq = useRef(0);

  const mask = useCallback(
    (text: string) => (showEmails ? text : maskEmailsInText(text)),
    [showEmails]
  );
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    [i18n.resolvedLanguage]
  );

  const load = useCallback(async () => {
    if (!connected) return;
    const seq = ++requestSeq.current;
    const seconds = RANGES.find((r) => r.id === range)?.seconds ?? 86400;
    const to = Math.floor(Date.now() / 1000) + 60;
    const from = to - 60 - seconds;
    windowRef.current = { from, to };
    setLoading(true);
    setError(null);
    try {
      const [sum, list] = await Promise.all([
        requestLogApi.summary(from, to),
        requestLogApi.list({ from, to, outcome }),
      ]);
      if (seq !== requestSeq.current) return;
      setEnabled(sum.enabled);
      setSummary(sum.summary ?? null);
      setItems(list.items ?? []);
      setNextBefore(list.next_before_id ?? 0);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [connected, range, outcome]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!nextBefore) return;
    const { from, to } = windowRef.current;
    const list = await requestLogApi.list({ from, to, outcome, beforeId: nextBefore });
    setItems((prev) => [...prev, ...(list.items ?? [])]);
    setNextBefore(list.next_before_id ?? 0);
  };

  const totals = summary?.totals;
  const outcomeLabel = (value: '' | RequestOutcome) => t(`tmx_requests.outcome_${value || 'all'}`);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>{t('tmx_requests.title')}</h1>
          <p className={styles.subtitle}>{t('tmx_requests.subtitle')}</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label={t('tmx_requests.range')}>
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={r.id === range ? styles.segmentActive : styles.segment}
                aria-pressed={r.id === range}
                onClick={() => setRange(r.id)}
              >
                {t(`tmx_requests.range_${r.id}`)}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowEmails((v) => !v)}>
            {showEmails ? t('tmx_requests.hide_emails') : t('tmx_requests.show_emails')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
            {t('tmx_requests.refresh')}
          </Button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      {enabled === false ? (
        <EmptyState
          title={t('tmx_requests.disabled_title')}
          description={t('tmx_requests.disabled_desc')}
        />
      ) : (
        <>
          <section className={styles.tiles} aria-label={t('tmx_requests.overview')}>
            <Tile
              label={t('tmx_requests.tile_requests')}
              value={formatCompactNumber(totals?.requests ?? 0)}
              hint={t('tmx_requests.tile_attempts', { count: totals?.attempts ?? 0 })}
            />
            <Tile
              label={t('tmx_requests.outcome_success')}
              value={formatCompactNumber(totals?.success ?? 0)}
              tone="success"
            />
            <Tile
              label={t('tmx_requests.outcome_failed')}
              value={formatCompactNumber(totals?.failed ?? 0)}
              tone={totals?.failed ? 'failure' : undefined}
            />
            <Tile
              label={t('tmx_requests.outcome_canceled')}
              value={formatCompactNumber(totals?.canceled ?? 0)}
              hint={t('tmx_requests.canceled_hint')}
              tone="neutral"
            />
            <Tile
              label={t('tmx_requests.outcome_rejected')}
              value={formatCompactNumber(totals?.rejected ?? 0)}
              hint={t('tmx_requests.rejected_hint')}
              tone={totals?.rejected ? 'failure' : undefined}
            />
            <Tile
              label={t('tmx_requests.tile_cache')}
              value={ratioText(totals ? cacheHitRatio(totals) : null)}
              hint={t('tmx_requests.tile_cache_hint', {
                read: formatCompactNumber(totals?.cache_hit_tokens ?? 0),
                prompt: formatCompactNumber(totals?.prompt_tokens ?? 0),
              })}
            />
            <Tile
              label={t('tmx_requests.tile_tokens')}
              value={`${formatCompactNumber(totals?.input_tokens ?? 0)} / ${formatCompactNumber(totals?.output_tokens ?? 0)}`}
              hint={t('tmx_requests.tile_tokens_hint', {
                write: formatCompactNumber(totals?.cache_creation ?? 0),
              })}
            />
            <Tile
              label={t('tmx_requests.tile_ttft')}
              value={msText(totals?.p50_ttft_ms ?? 0)}
              hint={t('tmx_requests.tile_ttft_hint', {
                p95: msText(totals?.p95_ttft_ms ?? 0),
                avg: msText(totals?.avg_latency_ms ?? 0),
              })}
            />
            <Tile
              label={t('tmx_requests.tile_sessions')}
              value={formatCompactNumber(summary?.sessions.total ?? 0)}
              hint={t('tmx_requests.tile_sessions_hint', {
                count: summary?.sessions.multi_auth ?? 0,
              })}
              tone={summary?.sessions.multi_auth ? 'failure' : undefined}
            />
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{t('tmx_requests.chart_title')}</h2>
            <RequestChart
              buckets={summary?.buckets ?? []}
              bucketSeconds={summary?.bucket_seconds ?? 60}
              from={summary?.from ?? ''}
              to={summary?.to ?? ''}
            />
          </section>

          <div className={styles.split}>
            <GroupTable
              title={t('tmx_requests.by_account')}
              rows={summary?.by_auth ?? []}
              label={(g) => mask(g.label || g.key)}
            />
            <GroupTable
              title={t('tmx_requests.by_model')}
              rows={summary?.by_model ?? []}
              label={(g) => g.key || '—'}
            />
          </div>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>{t('tmx_requests.recent')}</h2>
              <div
                className={styles.segmented}
                role="group"
                aria-label={t('tmx_requests.filter_outcome')}
              >
                {OUTCOME_FILTERS.map((value) => (
                  <button
                    key={value || 'all'}
                    type="button"
                    className={value === outcome ? styles.segmentActive : styles.segment}
                    aria-pressed={value === outcome}
                    onClick={() => setOutcome(value)}
                  >
                    {outcomeLabel(value)}
                  </button>
                ))}
              </div>
            </div>
            {items.length === 0 ? (
              <p className={styles.muted}>
                {loading ? t('tmx_requests.loading') : t('tmx_requests.no_rows')}
              </p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('tmx_requests.col_time')}</th>
                      <th>{t('tmx_requests.col_outcome')}</th>
                      <th>{t('tmx_requests.col_model')}</th>
                      <th>{t('tmx_requests.col_account')}</th>
                      <th className={styles.num}>{t('tmx_requests.col_latency')}</th>
                      <th className={styles.num}>{t('tmx_requests.col_ttft')}</th>
                      <th className={styles.num}>{t('tmx_requests.col_in_out')}</th>
                      <th className={styles.num}>{t('tmx_requests.col_cache')}</th>
                      <th>{t('tmx_requests.col_client')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <RequestRow
                        key={item.id}
                        item={item}
                        time={timeFmt.format(new Date(item.ts))}
                        account={mask(item.auth_label || item.auth_id)}
                        outcomeText={outcomeLabel(item.outcome)}
                        expanded={expanded === item.id}
                        onToggle={() => setExpanded((cur) => (cur === item.id ? null : item.id))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {nextBefore > 0 && (
              <div className={styles.more}>
                <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
                  {t('tmx_requests.load_more')}
                </Button>
              </div>
            )}
          </section>

          <StoragePanel connected={connected} />
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'failure' | 'neutral';
}) {
  return (
    <div className={styles.tile}>
      <span
        className={`${styles.tileAccent} ${tone ? styles[`accent_${tone}`] : ''}`}
        aria-hidden="true"
      />
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
      {hint && <div className={styles.tileHint}>{hint}</div>}
    </div>
  );
}

function GroupTable({
  title,
  rows,
  label,
}: {
  title: string;
  rows: RequestGroup[];
  label: (g: RequestGroup) => string;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {rows.length === 0 ? (
        <p className={styles.muted}>{t('tmx_requests.no_rows')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('tmx_requests.col_name')}</th>
                <th className={styles.num}>{t('tmx_requests.outcome_success')}</th>
                <th className={styles.num}>{t('tmx_requests.outcome_failed')}</th>
                <th className={styles.num}>{t('tmx_requests.outcome_canceled')}</th>
                <th className={styles.num}>{t('tmx_requests.col_in_out')}</th>
                <th className={styles.num}>{t('tmx_requests.col_cache')}</th>
                <th className={styles.num}>{t('tmx_requests.col_latency')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.key}>
                  <td className={styles.mono} title={g.provider}>
                    {label(g)}
                  </td>
                  <td className={styles.num}>{g.success}</td>
                  <td className={`${styles.num} ${g.failed ? styles.failedText : ''}`}>
                    {g.failed}
                  </td>
                  <td className={styles.num}>{g.canceled}</td>
                  <td className={styles.num}>
                    {formatCompactNumber(g.input_tokens)} / {formatCompactNumber(g.output_tokens)}
                  </td>
                  <td className={styles.num}>{ratioText(cacheHitRatio(g))}</td>
                  <td className={styles.num}>{msText(g.avg_latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RequestRow({
  item,
  time,
  account,
  outcomeText,
  expanded,
  onToggle,
}: {
  item: RequestItem;
  time: string;
  account: string;
  outcomeText: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const ratio = cacheHitRatio({
    prompt_tokens:
      item.provider === 'claude'
        ? item.input_tokens + item.cache_read + item.cache_creation
        : item.input_tokens,
    cache_hit_tokens:
      item.provider === 'claude' ? item.cache_read : Math.max(item.cached_tokens, item.cache_read),
  });
  const client = item.user_agent.split(' ')[0] || item.client_ip || '—';
  return (
    <>
      <tr className={styles.clickable} onClick={onToggle} aria-expanded={expanded}>
        <td className={styles.mono}>{time}</td>
        <td>
          <span className={`${styles.badge} ${styles[`badge_${item.outcome}`]}`}>
            {outcomeText}
            {item.status_code ? ` ${item.status_code}` : ''}
          </span>
        </td>
        <td className={styles.mono}>{item.model}</td>
        <td className={styles.mono}>{account}</td>
        <td className={styles.num}>{msText(item.latency_ms)}</td>
        <td className={styles.num}>{msText(item.ttft_ms)}</td>
        <td className={styles.num}>
          {formatCompactNumber(item.input_tokens)} / {formatCompactNumber(item.output_tokens)}
        </td>
        <td className={styles.num}>{ratioText(ratio)}</td>
        <td className={styles.muted}>{client}</td>
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td colSpan={9}>
            <dl className={styles.detail}>
              <dt>{t('tmx_requests.detail_client')}</dt>
              <dd>
                {item.user_agent || '—'} · {item.client_ip || '—'}
              </dd>
              <dt>{t('tmx_requests.trace')}</dt>
              <dd className={styles.mono}>{item.trace_id || '—'}</dd>
              <dt>{t('tmx_requests.detail_session')}</dt>
              <dd className={styles.mono}>{item.session_id || '—'}</dd>
              <dt>{t('tmx_requests.detail_tokens')}</dt>
              <dd>
                {t('tmx_requests.detail_tokens_value', {
                  input: item.input_tokens,
                  output: item.output_tokens,
                  read: item.cache_read || item.cached_tokens,
                  write: item.cache_creation,
                  reasoning: item.reasoning_tokens,
                })}
              </dd>
            </dl>
            {item.error && <pre className={styles.errorText}>{item.error}</pre>}
          </td>
        </tr>
      )}
    </>
  );
}
