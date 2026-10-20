// tokenmaxx fork: quota used % over time per account and window, from the proxy's recorded
// snapshots (/tmx/quota/history). Renders nothing when the backend has no quota tracking.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores';
import { maskEmailsInText } from '@/features/quota/emailMask';
import { quotaHistoryApi, type QuotaAccountNow, type QuotaSnapshot } from './api';
import { buildQuotaChart, valueAt, windowLabel, type QuotaChartAccount } from './model';
import styles from './QuotaHistory.module.scss';

const RANGES = [
  { id: '24h', seconds: 86400 },
  { id: '7d', seconds: 7 * 86400 },
  { id: '30d', seconds: 30 * 86400 },
] as const;
type RangeId = (typeof RANGES)[number]['id'];
const SLOTS = 5;

export function QuotaHistoryPanel({ maskEmails }: { maskEmails: boolean }) {
  const { t } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [range, setRange] = useState<RangeId>('7d');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [snapshots, setSnapshots] = useState<QuotaSnapshot[]>([]);
  const [accounts, setAccounts] = useState<QuotaAccountNow[]>([]);
  const [bounds, setBounds] = useState({ from: 0, to: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!connected) return;
    const id = ++seq.current;
    const to = Math.floor(Date.now() / 1000);
    const from = to - (RANGES.find((r) => r.id === range)?.seconds ?? 7 * 86400);
    setLoading(true);
    setError(null);
    try {
      const [cur, hist] = await Promise.all([
        quotaHistoryApi.current(),
        quotaHistoryApi.history(from, to),
      ]);
      if (id !== seq.current) return;
      setEnabled(cur.enabled !== false && hist.enabled !== false);
      setAccounts(cur.accounts ?? []);
      setSnapshots(hist.snapshots ?? []);
      setBounds({ from: from * 1000, to: to * 1000 });
    } catch (err) {
      if (id !== seq.current) return;
      // Older backends have no quota tracking: hide the panel rather than show an error.
      const status = (err as { status?: number })?.status;
      if (status === 404) setEnabled(false);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [connected, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const charts = useMemo(
    () => buildQuotaChart(snapshots, accounts, bounds.from, bounds.to),
    [snapshots, accounts, bounds]
  );

  if (enabled === false) return null;
  const mask = (s: string) => (maskEmails ? maskEmailsInText(s) : s);

  return (
    <section className={styles.root} aria-label={t('tmx_quota_history.title')}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>{t('tmx_quota_history.title')}</h2>
          <p className={styles.subtitle}>{t('tmx_quota_history.subtitle')}</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label={t('tmx_quota_history.range')}>
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={range === r.id ? styles.segmentActive : styles.segment}
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
              >
                {t(`tmx_quota_history.range_${r.id}`)}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
            {t('tmx_quota_history.reload')}
          </Button>
        </div>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {!error && enabled && charts.length === 0 && (
        <p className={styles.muted}>{t('tmx_quota_history.empty')}</p>
      )}
      <div className={styles.grid}>
        {charts.map((c) => (
          <AccountChart
            key={c.authId}
            chart={c}
            from={bounds.from}
            to={bounds.to}
            label={mask(c.label || c.authId)}
          />
        ))}
      </div>
    </section>
  );
}

function AccountChart({
  chart,
  from,
  to,
  label,
}: {
  chart: QuotaChartAccount;
  from: number;
  to: number;
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const [hover, setHover] = useState<{ t: number; x: number } | null>(null);
  const span = Math.max(1, to - from);
  const x = (time: number) => ((time - from) / span) * 1000;
  const y = (v: number) => 100 - v;
  const color = (i: number) => `var(--qh-s${Math.min(i, SLOTS - 1)})`;
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [i18n.resolvedLanguage]
  );
  const current = new Map((chart.current?.windows ?? []).map((w) => [w.window, w]));
  const windows = chart.series.map((s) => s.window);
  for (const w of current.keys()) if (!windows.includes(w)) windows.push(w);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover({ t: from + frac * span, x: frac });
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.account} title={label}>
          {label}
        </span>
        <span className={styles.meta}>
          {chart.provider}
          {chart.plan ? ` · ${chart.plan}` : ''}
        </span>
      </div>
      <div className={styles.legend}>
        {windows.map((w) => {
          const i = chart.series.findIndex((s) => s.window === w);
          const now = current.get(w);
          return (
            <span key={w} className={styles.legendItem}>
              <span
                className={styles.swatch}
                style={{ background: color(i < 0 ? SLOTS - 1 : i) }}
              />
              {windowLabel(w, t)}
              {now && now.used_pct !== null && !now.stale && (
                <span className={styles.legendValue}>{Math.round(now.used_pct)}%</span>
              )}
              {now?.stale && (
                <span className={styles.staleBadge} title={t('tmx_quota_history.stale_hint')}>
                  {t('tmx_quota_history.stale')}
                </span>
              )}
            </span>
          );
        })}
      </div>
      {chart.series.length === 0 ? (
        <p className={styles.muted}>{t('tmx_quota_history.no_history')}</p>
      ) : (
        <>
          <div className={styles.plot}>
            <div className={styles.yAxis} aria-hidden="true">
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>
            <div className={styles.svgWrap}>
              <svg
                className={styles.svg}
                viewBox="0 0 1000 100"
                preserveAspectRatio="none"
                role="img"
                aria-label={t('tmx_quota_history.chart_label', { account: label })}
              >
                <line
                  className={styles.gridLine}
                  x1="0"
                  x2="1000"
                  y1="50"
                  y2="50"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  className={styles.gridLine}
                  x1="0"
                  x2="1000"
                  y1="0"
                  y2="0"
                  vectorEffect="non-scaling-stroke"
                />
                {chart.series.flatMap((s) =>
                  s.resets.map((r) => (
                    <line
                      key={`${s.window}-${r}`}
                      className={styles.resetLine}
                      x1={x(r)}
                      x2={x(r)}
                      y1="0"
                      y2="100"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))
                )}
                {chart.series.map((s, i) =>
                  s.segments.map((seg, j) => {
                    if (seg.points.length === 0) return null;
                    let d = `M${x(seg.points[0].t)},${y(seg.points[0].v)}`;
                    for (const p of seg.points.slice(1)) d += ` H${x(p.t)} V${y(p.v)}`;
                    return (
                      <path
                        key={`${s.window}-${j}`}
                        className={styles.line}
                        d={d}
                        stroke={color(i)}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })
                )}
                {hover && (
                  <line
                    className={styles.crosshair}
                    x1={hover.x * 1000}
                    x2={hover.x * 1000}
                    y1="0"
                    y2="100"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <rect
                  x="0"
                  y="0"
                  width="1000"
                  height="100"
                  fill="transparent"
                  onMouseMove={onMove}
                  onMouseLeave={() => setHover(null)}
                />
              </svg>
              {hover && (
                <div
                  className={styles.tip}
                  style={
                    hover.x > 0.6
                      ? { right: `${(1 - hover.x) * 100 + 2}%` }
                      : { left: `${hover.x * 100 + 2}%` }
                  }
                >
                  <span className={styles.tipTime}>{fmt.format(new Date(hover.t))}</span>
                  {chart.series.map((s, i) => {
                    const v = valueAt(s, hover.t);
                    return (
                      <span key={s.window} className={styles.legendItem}>
                        <span className={styles.swatch} style={{ background: color(i) }} />
                        {windowLabel(s.window, t)}
                        <span className={styles.legendValue}>
                          {v === null ? '—' : `${Math.round(v)}%`}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className={styles.xAxis} aria-hidden="true">
            <span>{fmt.format(new Date(from))}</span>
            <span>{fmt.format(new Date(from + span / 2))}</span>
            <span>{fmt.format(new Date(to))}</span>
          </div>
        </>
      )}
    </div>
  );
}
