import { describe, expect, test } from 'bun:test';
import {
  isImported,
  visibleItems,
  type ConvItem,
  type SessionRow,
} from '../src/tmx/conversations/api';

const items: ConvItem[] = [
  { role: 'system', kind: 'text', text: 'You are…' },
  { role: 'user', kind: 'text', text: 'hi' },
  { role: 'assistant', kind: 'thinking', text: 'hmm' },
  { role: 'assistant', kind: 'tool_call', name: 'Bash', text: '{}' },
  { role: 'tool', kind: 'tool_result', text: 'ok' },
  { role: 'event', kind: 'other', text: '{}' },
  { role: 'assistant', kind: 'text', text: 'done' },
];

describe('conversations', () => {
  test('default filter hides system prompts and harness events', () => {
    const shown = visibleItems(items, {
      events: false,
      system: false,
      thinking: true,
      tools: true,
    });
    expect(shown.map((i) => i.role + ':' + i.kind)).toEqual([
      'user:text',
      'assistant:thinking',
      'assistant:tool_call',
      'tool:tool_result',
      'assistant:text',
    ]);
  });

  test('everything off leaves only the dialogue', () => {
    const shown = visibleItems(items, {
      events: false,
      system: false,
      thinking: false,
      tools: false,
    });
    expect(shown.map((i) => i.text)).toEqual(['hi', 'done']);
  });

  test('imported sessions are recognised by source', () => {
    const row = (sources: string[]) => ({ sources }) as unknown as SessionRow;
    expect(isImported(row(['extern:opencode']))).toBe(true);
    expect(isImported(row(['tmx-proxy']))).toBe(false);
  });
});

import { parseHashQuery } from '../src/tmx/conversations/useHashQuery';

test('hash query parsing', () => {
  expect(parseHashQuery('#/conversations?session=a%3Ab&kind=proxy').get('session')).toBe('a:b');
  expect(parseHashQuery('#/conversations').get('session')).toBeNull();
});

import { prettyJson } from '../src/tmx/conversations/api';

test('tool arguments are pretty-printed with escapes decoded', () => {
  expect(prettyJson('{"command":"a \\u003e b"}')).toBe('{\n  "command": "a > b"\n}');
  expect(prettyJson('not json')).toBe('not json');
  expect(prettyJson('{broken')).toBe('{broken');
});
