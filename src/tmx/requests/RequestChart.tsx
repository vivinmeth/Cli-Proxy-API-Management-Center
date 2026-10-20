// tokenmaxx fork: stacked outcome bars (success / failed / canceled) per time bucket.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RequestBucket } from './api';
import { fillBuckets } from './buckets';
import styles from './RequestHistoryPage.module.scss';

const SEGMENTS = ['success', 'failed', 'canceled'] as const;

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

export function RequestChart({
  buckets: sparse,
  bucketSeconds,
  from,
  to,
}: {
  buckets: RequestBucket[];
  bucketSeconds: number;
  from: string;
  to: string;
}) {
  const { t, i18n } = useTranslation();
  const buckets = useMemo(
    () => fillBuckets(sparse, from, to, bucketSeconds),
    [sparse, from, to, bucketSeconds]
  );
  const [active, setActive] = useState<number | null>(null);

  const fmt = useMemo(() => {
    // Label by the span shown, not the bucket size: a 24h range needs dates to be unambiguous.
    const spanSeconds = (Date.parse(to) - Date.parse(from)) / 1000;
    const opts: Intl.DateTimeFormatOptions =
      bucketSeconds >= 86400
        ? { month: '2-digit', day: '2-digit' }
        : spanSeconds > 20 * 3600
          ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
          : { hour: '2-digit', minute: '2-digit', hour12: false };
    return new Intl.DateTimeFormat(i18n.resolvedLanguage, opts);
  }, [bucketSeconds, from, to, i18n.resolvedLanguage]);

  const max = niceMax(Math.max(0, ...buckets.map((b) => b.success + b.failed + b.canceled)));
  const label = (key: (typeof SEGMENTS)[number]) => t(`tmx_requests.outcome_${key}`);

  if (sparse.length === 0) {
    return <p className={styles.muted}>{t('tmx_requests.no_rows')}</p>;
  }
  const activeBucket = active === null ? null : buckets[active];
  const xTicks = Array.from(new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]));

  return (
    <div className={styles.chart}>
      <div className={styles.legend}>
        {SEGMENTS.map((key) => (
          <span key={key} className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles[`seg_${key}`]}`} aria-hidden="true" />
            {label(key)}
          </span>
        ))}
      </div>
      <div className={styles.plot} onMouseLeave={() => setActive(null)} aria-hidden="true">
        <div className={styles.yAxis}>
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div className={styles.bars}>
          <div className={styles.gridLine} style={{ bottom: '50%' }} />
          {buckets.map((b, index) => (
            <div
              key={b.start}
              className={`${styles.barSlot} ${active === index ? styles.barSlotActive : ''}`}
              onMouseEnter={() => setActive(index)}
            >
              <div className={styles.barStack}>
                {SEGMENTS.map((key) =>
                  b[key] > 0 ? (
                    <div
                      key={key}
                      className={`${styles.seg} ${styles[`seg_${key}`]}`}
                      style={{ height: `${(b[key] / max) * 100}%` }}
                    />
                  ) : null
                )}
              </div>
            </div>
          ))}
          {activeBucket && (
            <div
              className={styles.chartTip}
              style={{
                left: `${((active! + 0.5) / buckets.length) * 100}%`,
                transform: active! > buckets.length / 2 ? 'translateX(-100%)' : undefined,
              }}
            >
              <strong>{fmt.format(new Date(activeBucket.start))}</strong>
              {SEGMENTS.map((key) => (
                <span key={key}>
                  <span className={`${styles.swatch} ${styles[`seg_${key}`]}`} />
                  {label(key)} <b>{activeBucket[key]}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.xAxis} aria-hidden="true">
        {xTicks.map((index) => (
          <span
            key={index}
            style={{
              left: `${((index + 0.5) / buckets.length) * 100}%`,
              // Edge labels hang inward so they never clip at the card border.
              transform:
                index === 0
                  ? 'none'
                  : index === buckets.length - 1
                    ? 'translateX(-100%)'
                    : undefined,
            }}
            className={styles.xTick}
          >
            {fmt.format(new Date(buckets[index].start))}
          </span>
        ))}
      </div>
      <table className={styles.srOnly}>
        <caption>{t('tmx_requests.chart_title')}</caption>
        <thead>
          <tr>
            <th>{t('tmx_requests.col_time')}</th>
            {SEGMENTS.map((key) => (
              <th key={key}>{label(key)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.start}>
              <td>{fmt.format(new Date(b.start))}</td>
              {SEGMENTS.map((key) => (
                <td key={key}>{b[key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
