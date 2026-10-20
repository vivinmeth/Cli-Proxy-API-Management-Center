import type { RequestBucket } from './api';

export type Point = Pick<RequestBucket, 'start' | 'success' | 'failed' | 'canceled'>;

/** The API only returns buckets that have rows; fill the gaps so time stays linear. */
export function fillBuckets(
  sparse: RequestBucket[],
  fromIso: string,
  toIso: string,
  bucketSeconds: number
): Point[] {
  const step = bucketSeconds * 1000;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || step <= 0) return sparse;
  const byStart = new Map(sparse.map((b) => [Date.parse(b.start), b]));
  const out: Point[] = [];
  for (let t = from; t < to && out.length < 2000; t += step) {
    const b = byStart.get(t);
    out.push(b ?? { start: new Date(t).toISOString(), success: 0, failed: 0, canceled: 0 });
  }
  return out;
}
