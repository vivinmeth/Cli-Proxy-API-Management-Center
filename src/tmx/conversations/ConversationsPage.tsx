// tokenmaxx fork: read archived conversations — imported transcripts and proxied sessions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore } from '@/stores';
import { formatCompactNumber, formatDateTimeValue } from '@/utils/format';
import {
  conversationsApi,
  isImported,
  visibleItems,
  type Conversation,
  type ConvFilter,
  type ConvItem,
  type SessionRow,
  prettyJson,
} from './api';
import { useHashQuery } from './useHashQuery';
import styles from './Conversations.module.scss';

const PAGE = 300;
const LONG_TEXT = 1600;

export function ConversationsPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [params, setParams] = useHashQuery();
  const sessionId = params.get('session') ?? '';
  const harness = params.get('harness') ?? '';
  const traceId = params.get('trace') ?? '';
  const kind = params.get('kind') ?? '';

  const [days, setDays] = useState(7);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [conv, setConv] = useState<Conversation | null>(null);
  const [convError, setConvError] = useState<string | null>(null);
  const [loadingConv, setLoadingConv] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState<ConvFilter>({
    events: false,
    system: false,
    thinking: true,
    tools: true,
  });
  const convSeq = useRef(0);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    setListError(null);
    conversationsApi
      .sessions(days)
      .then((res) => live && setSessions(res.sessions ?? []))
      .catch((err) => live && setListError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [connected, days]);

  const loadConversation = useCallback(async () => {
    if (!connected || !sessionId) {
      setConv(null);
      return;
    }
    const id = ++convSeq.current;
    setLoadingConv(true);
    setConvError(null);
    try {
      const res = await conversationsApi.conversation(sessionId, { harness, traceId, kind });
      if (id !== convSeq.current) return;
      setConv(res);
      setShown(PAGE);
    } catch (err) {
      if (id !== convSeq.current) return;
      setConv(null);
      const status = (err as { status?: number })?.status;
      setConvError(
        status === 404
          ? t('tmx_conversations.not_archived')
          : err instanceof Error
            ? err.message
            : String(err)
      );
    } finally {
      if (id === convSeq.current) setLoadingConv(false);
    }
  }, [connected, sessionId, harness, traceId, kind, t]);

  useEffect(() => {
    void loadConversation();
  }, [loadConversation]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.session_id.toLowerCase().includes(q) ||
        s.harnesses.some((h) => h.includes(q)) ||
        s.machines.some((m) => m.includes(q)) ||
        s.models.some((m) => m.includes(q))
    );
  }, [sessions, query]);

  const items = useMemo(() => (conv ? visibleItems(conv.items, filter) : []), [conv, filter]);
  const start = Math.max(0, items.length - shown);
  const open = (row: SessionRow) => {
    const next = new URLSearchParams();
    next.set('session', row.session_id);
    const h = row.harnesses.find((x) => x && x !== 'claude-agent-sdk' && isImported(row));
    if (h) next.set('harness', h);
    setParams(next);
  };
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const toggle = (key: keyof ConvFilter) => setFilter((f) => ({ ...f, [key]: !f[key] }));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('tmx_conversations.title')}</h1>
          <p className={styles.subtitle}>{t('tmx_conversations.subtitle')}</p>
        </div>
      </header>
      <div className={styles.layout}>
        <aside className={styles.list} aria-label={t('tmx_conversations.sessions')}>
          <div className={styles.listHead}>
            <input
              className={styles.search}
              type="search"
              value={query}
              placeholder={t('tmx_conversations.search')}
              aria-label={t('tmx_conversations.search')}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className={styles.select}
              value={days}
              aria-label={t('tmx_conversations.range')}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[1, 7, 30, 90, 365].map((d) => (
                <option key={d} value={d}>
                  {t('tmx_conversations.last_days', { count: d })}
                </option>
              ))}
            </select>
          </div>
          {listError && <p className={styles.error}>{listError}</p>}
          {filteredSessions.length === 0 && !listError && (
            <p className={styles.muted}>{t('tmx_conversations.no_sessions')}</p>
          )}
          <ul className={styles.sessions}>
            {filteredSessions.map((s) => (
              <li key={s.session_id}>
                <button
                  type="button"
                  className={s.session_id === sessionId ? styles.sessionActive : styles.session}
                  onClick={() => open(s)}
                >
                  <span className={styles.sessionTop}>
                    <span className={styles.badge}>{s.harnesses[0] || '—'}</span>
                    <span className={styles.sessionTime}>
                      {formatDateTimeValue(s.last_ts, i18n.language)}
                    </span>
                  </span>
                  <span className={styles.sessionId}>{s.session_id}</span>
                  <span className={styles.sessionMeta}>
                    {[s.machines[0], s.models[0], `${formatCompactNumber(s.total_tokens)} tok`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className={styles.reader} aria-label={t('tmx_conversations.reader')}>
          {!sessionId ? (
            <EmptyState
              title={t('tmx_conversations.pick_title')}
              description={t('tmx_conversations.pick_desc')}
            />
          ) : (
            <>
              <div className={styles.readerHead}>
                <div className={styles.readerTitle}>
                  <span className={styles.sessionId}>{conv?.title || sessionId}</span>
                  {conv && (
                    <span className={styles.sessionMeta}>
                      {t(`tmx_conversations.kind_${conv.kind}`)}
                      {conv.harness ? ` · ${conv.harness}` : ''}
                      {conv.model ? ` · ${conv.model}` : ''}
                      {` · ${t('tmx_conversations.items', { count: conv.items.length })}`}
                    </span>
                  )}
                </div>
                <div className={styles.controls}>
                  {conv?.kind === 'proxy' && (conv.exchanges?.length ?? 0) > 1 && (
                    <select
                      className={styles.select}
                      value={traceId || conv.trace_id || ''}
                      aria-label={t('tmx_conversations.turn')}
                      onChange={(e) => setParam('trace', e.target.value)}
                    >
                      {conv.exchanges!.map((e) => (
                        <option key={e.trace_id} value={e.trace_id}>
                          {formatDateTimeValue(e.ts, i18n.language)} · {e.status} ·{' '}
                          {formatCompactNumber(e.request_bytes)}B
                        </option>
                      ))}
                    </select>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadConversation()}
                    loading={loadingConv}
                  >
                    {t('tmx_conversations.reload')}
                  </Button>
                </div>
              </div>
              <div className={styles.filters} role="group" aria-label={t('tmx_conversations.show')}>
                {(['thinking', 'tools', 'system', 'events'] as (keyof ConvFilter)[]).map((key) => (
                  <label key={key} className={styles.filter}>
                    <input type="checkbox" checked={filter[key]} onChange={() => toggle(key)} />
                    {t(`tmx_conversations.show_${key}`)}
                  </label>
                ))}
              </div>
              {convError && <p className={styles.error}>{convError}</p>}
              {loadingConv && !conv && (
                <p className={styles.muted}>{t('tmx_conversations.loading')}</p>
              )}
              {conv?.truncated && (
                <p className={styles.muted}>{t('tmx_conversations.truncated')}</p>
              )}
              {start > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                  {t('tmx_conversations.earlier', { count: start })}
                </Button>
              )}
              <ol className={styles.items}>
                {items.slice(start).map((it, i) => (
                  <Item key={start + i} item={it} />
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Item({ item }: { item: ConvItem }) {
  const { t, i18n } = useTranslation();
  const long = (item.text?.length ?? 0) > LONG_TEXT;
  const collapsible = long || item.kind === 'tool_result' || item.kind === 'other';
  const [expanded, setExpanded] = useState(!collapsible);
  const text = item.kind === 'tool_call' ? prettyJson(item.text ?? '') : (item.text ?? '');
  const shownText = expanded ? text : text.slice(0, item.kind === 'tool_result' ? 400 : LONG_TEXT);
  const label =
    item.kind === 'tool_call'
      ? t('tmx_conversations.tool_call', { name: item.name || '?' })
      : item.kind === 'tool_result'
        ? t('tmx_conversations.tool_result')
        : item.kind === 'thinking'
          ? t('tmx_conversations.thinking')
          : t(`tmx_conversations.role_${item.role}`);
  return (
    <li
      className={`${styles.item} ${styles[`role_${item.role}`] ?? ''} ${styles[`kind_${item.kind}`] ?? ''}`}
    >
      <div className={styles.itemHead}>
        <span className={styles.itemLabel}>{label}</span>
        <span className={styles.itemMeta}>
          {item.model ? `${item.model} · ` : ''}
          {item.ts ? formatDateTimeValue(item.ts, i18n.language) : ''}
        </span>
      </div>
      <pre className={item.kind === 'text' ? styles.prose : styles.code}>{shownText || '—'}</pre>
      {collapsible && text.length > shownText.length && (
        <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
          {t('tmx_conversations.show_more', { count: text.length - shownText.length })}
        </button>
      )}
      {collapsible && expanded && text.length > 400 && (
        <button type="button" className={styles.more} onClick={() => setExpanded(false)}>
          {t('tmx_conversations.show_less')}
        </button>
      )}
    </li>
  );
}
