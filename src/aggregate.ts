/**
 * Turning observations into numbers that can be published honestly.
 *
 * The arithmetic here is trivial. The judgement is in when to refuse to publish
 * a figure, which is most of what this module is for. A trend that reflects the
 * index's own outage rather than the network is worse than no trend, because the
 * number gets quoted and the caveat does not.
 */

export type CoverageQuality = 'good' | 'partial' | 'thin';

/** How many instances reported a given post. */
export function popcount(mask: number | bigint): number {
  let value = typeof mask === 'bigint' ? mask : BigInt(Math.trunc(mask));
  if (value < 0n) return 0;
  let count = 0;
  while (value > 0n) {
    if ((value & 1n) === 1n) count += 1;
    value >>= 1n;
  }
  return count;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (low === undefined || high === undefined) return null;
  return (low + high) / 2;
}

/**
 * Median popcount over a grouped distribution of masks.
 *
 * The mask distribution arrives grouped by value rather than as one row per
 * post, because there are at most 2^instances distinct masks and grouping keeps
 * the query to a handful of rows. The median still has to be weighted by how
 * many posts sit behind each mask.
 */
export function weightedMedianPopcount(
  distribution: readonly { mask: number | bigint; count: number }[],
): number | null {
  const buckets = distribution
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ seen: popcount(entry.mask), count: entry.count }))
    .sort((a, b) => a.seen - b.seen);

  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return null;

  // For an even total the true median averages the two middle values, so both
  // midpoints are located rather than just the one.
  const lowerTarget = Math.floor((total - 1) / 2);
  const upperTarget = Math.ceil((total - 1) / 2);
  let seen = 0;
  let lower: number | null = null;
  let upper: number | null = null;

  for (const bucket of buckets) {
    const next = seen + bucket.count;
    if (lower === null && next > lowerTarget) lower = bucket.seen;
    if (upper === null && next > upperTarget) upper = bucket.seen;
    if (lower !== null && upper !== null) break;
    seen = next;
  }

  if (lower === null || upper === null) return null;
  return (lower + upper) / 2;
}

/**
 * The headline honesty signal: how many monitored instances saw a typical post.
 *
 * A median near the monitored count says the index is watching the
 * well-connected middle of the network and the figures are reasonably solid. A
 * median of one says it is catching fragments that reached exactly one server,
 * and the count beside it is a lower bound and little more.
 */
export function medianInstancesPerPost(masks: readonly (number | bigint)[]): number | null {
  return median(masks.map(popcount));
}

/**
 * Classify coverage for a tag, so the interface can be more or less cautious
 * about the number it is showing.
 */
export function coverageQuality(
  medianSeen: number | null,
  instancesMonitored: number,
): CoverageQuality {
  if (medianSeen === null || instancesMonitored === 0) return 'thin';
  const share = medianSeen / instancesMonitored;
  if (share >= 0.5) return 'good';
  if (share >= 0.2) return 'partial';
  return 'thin';
}

/**
 * Proportional change against the preceding equal window, or null when the
 * comparison cannot be made honestly.
 *
 * Null when coverage was not comparable, and null when the previous window was
 * empty. Going from nothing to something is not a percentage, and rendering it
 * as one produces the infinite-growth figures that make an index look silly.
 */
export function trend(
  current: number,
  previous: number,
  coverageComparable: boolean,
): number | null {
  if (!coverageComparable) return null;
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

export interface ComparabilityInput {
  instancesMonitored: number;
  /** Distinct instances that polled successfully during the current window. */
  currentReporting: number;
  /** The same, for the window immediately before it. */
  previousReporting: number;
  /** Minimum share of monitored instances that must have reported in both. */
  minimumShare?: number;
  /** Largest difference between the two windows, as a share of monitored. */
  maximumDrift?: number;
}

/**
 * Whether two windows saw enough of the same network to be compared.
 *
 * Two conditions, and both must hold. Each window needs a reasonable share of
 * the monitored instances reporting, so a trend is not computed from a skeleton
 * crew. And the two windows need similar coverage, because a drop from eight
 * instances to four halves the observed count on its own and would read as a
 * fall in activity.
 */
export function isCoverageComparable(input: ComparabilityInput): boolean {
  const monitored = input.instancesMonitored;
  if (monitored <= 0) return false;

  const minimumShare = input.minimumShare ?? 0.6;
  const maximumDrift = input.maximumDrift ?? 0.25;

  if (input.currentReporting / monitored < minimumShare) return false;
  if (input.previousReporting / monitored < minimumShare) return false;

  const drift = Math.abs(input.currentReporting - input.previousReporting) / monitored;
  return drift <= maximumDrift;
}

/** Unix minute bucket, the key for the rollup table. */
export function minuteBucket(unixSeconds: number): number {
  return Math.floor(unixSeconds / 60);
}

/**
 * The polling interval this service can honestly claim for a tag.
 *
 * A tier asks for an interval, but nothing is polled more often than the cron
 * fires, so the real interval is the larger of the two. Published rather than
 * the tier's figure, because a tag page claiming a 60 second interval while the
 * cron runs every 300 would be stating something untrue about the freshness of
 * the number beside it.
 */
export function effectivePollInterval(tierSeconds: number, cronPeriodSeconds: number): number {
  return Math.max(tierSeconds, Math.max(1, cronPeriodSeconds));
}
