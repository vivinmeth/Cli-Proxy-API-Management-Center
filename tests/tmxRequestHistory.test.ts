import { describe, expect, test } from 'bun:test';
import { cacheHitRatio, type RequestBucket } from '../src/tmx/requests/api';
import { fillBuckets } from '../src/tmx/requests/buckets';

const bucket = (start: string, success: number): RequestBucket =>
  ({ start, success, failed: 0, canceled: 0 }) as RequestBucket;

describe('request history', () => {
  test('fills empty buckets so the time axis stays linear', () => {
    const filled = fillBuckets(
      [bucket('2026-10-20T10:00:00Z', 3), bucket('2026-10-20T10:03:00Z', 1)],
      '2026-10-20T10:00:00Z',
      '2026-10-20T10:05:00Z',
      60
    );
    expect(filled.map((b) => b.success)).toEqual([3, 0, 0, 1, 0]);
    expect(filled[1].start).toBe('2026-10-20T10:01:00.000Z');
  });

  test('cache hit ratio is null without prompt tokens', () => {
    expect(cacheHitRatio({ prompt_tokens: 0, cache_hit_tokens: 0 })).toBeNull();
    expect(cacheHitRatio({ prompt_tokens: 200, cache_hit_tokens: 150 })).toBe(0.75);
  });
});
