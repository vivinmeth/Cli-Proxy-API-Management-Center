// tokenmaxx fork: archived conversations (/tmx/archive/conversation) and the session list
// (/tmx/requests/sessions).
import { apiClient } from '@/services/api/client';

export type ConvRole = 'system' | 'user' | 'assistant' | 'tool' | 'event';
export type ConvKind = 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'image' | 'other';

export interface ConvItem {
  role: ConvRole;
  kind: ConvKind;
  text?: string;
  name?: string;
  ts?: string;
  model?: string;
}

export interface ConvExchange {
  trace_id: string;
  ts: string;
  url: string;
  status: number;
  request_bytes: number;
}

export interface Conversation {
  kind: 'imported' | 'proxy';
  session_id: string;
  harness?: string;
  title?: string;
  model?: string;
  items: ConvItem[];
  truncated?: boolean;
  trace_id?: string;
  exchanges?: ConvExchange[];
}

export interface SessionRow {
  session_id: string;
  first_ts: string;
  last_ts: string;
  models: string[];
  machines: string[];
  harnesses: string[];
  sources: string[];
  attempts: number;
  total_tokens: number;
}

export const conversationsApi = {
  sessions: (days: number, harness?: string) => {
    const to = Math.floor(Date.now() / 1000);
    return apiClient.get<{ enabled: boolean; sessions: SessionRow[] }>('/tmx/requests/sessions', {
      params: {
        order: 'recent',
        limit: 200,
        from: to - days * 86400,
        to,
        harness: harness || undefined,
      },
      timeout: 30 * 1000,
    });
  },
  conversation: (
    sessionId: string,
    opts: { harness?: string; traceId?: string; kind?: string } = {}
  ) =>
    apiClient.get<Conversation>('/tmx/archive/conversation', {
      params: {
        session_id: sessionId,
        harness: opts.harness || undefined,
        trace_id: opts.traceId || undefined,
        kind: opts.kind || undefined,
      },
      timeout: 3 * 60 * 1000,
    }),
};

export interface ConvFilter {
  events: boolean;
  system: boolean;
  thinking: boolean;
  tools: boolean;
}

/** Items to show for a filter. Events are harness bookkeeping lines (mode switches, file history). */
export function visibleItems(items: ConvItem[], f: ConvFilter): ConvItem[] {
  return items.filter((it) => {
    if (it.role === 'event') return f.events;
    if (it.role === 'system') return f.system;
    if (it.kind === 'thinking') return f.thinking;
    if (it.kind === 'tool_call' || it.kind === 'tool_result') return f.tools;
    return true;
  });
}

/** True when a session id belongs to an imported transcript rather than live proxy traffic. */
export const isImported = (row: SessionRow) => row.sources.some((s) => s.startsWith('extern:'));

/** Pretty-prints JSON tool arguments (and decodes escapes like \u003e); other text is unchanged. */
export function prettyJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}
