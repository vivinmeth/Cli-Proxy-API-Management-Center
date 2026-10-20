// tokenmaxx fork: archive bucket objects, size and cost on Request History.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { formatCompactNumber, formatDateTimeValue, formatFileSize } from '@/utils/format';
import { archiveStorageApi, formatUsd, storageRows, type StorageResponse } from './storage';
import styles from './RequestHistoryPage.module.scss';

export function StoragePanel({ connected }: { connected: boolean }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<StorageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!connected) return;
      const id = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await archiveStorageApi.get(refresh);
        if (id === seq.current) setData(res);
      } catch (err) {
        if (id === seq.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [connected]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (data && data.enabled === false) return null;
  const usage = data?.storage;
  const cost = data?.cost_estimate ?? null;
  const rows = storageRows(usage);

  return (
    <section className={styles.card} aria-label={t('tmx_requests.storage_title')}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t('tmx_requests.storage_title')}</h2>
        <Button variant="secondary" size="sm" onClick={() => void load(true)} loading={loading}>
          {t('tmx_requests.storage_relist')}
        </Button>
      </div>
      {error && <p className={styles.failedText}>{error}</p>}
      {data && data.r2_configured === false && (
        <p className={styles.muted}>{t('tmx_requests.storage_no_r2')}</p>
      )}
      {usage && (
        <>
          <div className={`${styles.tiles} ${styles.storageTiles}`}>
            <StorageTile
              label={t('tmx_requests.storage_objects')}
              value={formatCompactNumber(usage.objects)}
              hint={usage.bucket}
            />
            <StorageTile
              label={t('tmx_requests.storage_size')}
              value={formatFileSize(usage.bytes)}
            />
            <StorageTile
              label={t('tmx_requests.storage_cost_now')}
              value={formatUsd(usage.storage_usd_month)}
              hint={t('tmx_requests.storage_cost_now_hint')}
            />
            {cost && (
              <StorageTile
                label={t('tmx_requests.storage_cost_12mo')}
                value={formatUsd(cost.month_usd_in_12mo)}
                hint={t('tmx_requests.storage_cost_12mo_hint', { warn: formatUsd(cost.warn_usd) })}
                warn={cost.warning}
              />
            )}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('tmx_requests.storage_env')}</th>
                  <th className={styles.num}>{t('tmx_requests.storage_objects')}</th>
                  <th className={styles.num}>{t('tmx_requests.storage_size')}</th>
                  <th className={styles.num}>{t('tmx_requests.storage_packs')}</th>
                  <th className={styles.num}>{t('tmx_requests.storage_loose')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.env}>
                    <td className={styles.mono}>
                      {r.env}
                      {r.current ? ` · ${t('tmx_requests.storage_this_env')}` : ''}
                    </td>
                    <td className={styles.num}>{formatCompactNumber(r.objects)}</td>
                    <td className={styles.num}>{formatFileSize(r.bytes)}</td>
                    <td className={styles.num}>
                      {formatCompactNumber(r.packs)} · {formatFileSize(r.pack_bytes)}
                    </td>
                    <td className={styles.num}>
                      {formatCompactNumber(r.loose)} · {formatFileSize(r.loose_bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>
            {t('tmx_requests.storage_listed', {
              time: formatDateTimeValue(usage.listed_at, i18n.language),
            })}
          </p>
        </>
      )}
    </section>
  );
}

function StorageTile({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className={styles.tile}>
      <span
        className={`${styles.tileAccent} ${warn ? styles.accent_failure : ''}`}
        aria-hidden="true"
      />
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
      {hint && <div className={styles.tileHint}>{hint}</div>}
    </div>
  );
}
