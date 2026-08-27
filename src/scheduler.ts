/**
 * Decide what to poll this tick.
 *
 * Request budget is the scarcest resource in the system, so this module is
 * built around the budget rather than around tags. It is pure: given the world
 * as it is now, it returns the jobs to run, and it touches nothing.
 *
 * Three rules shape the output.
 *
 *   Tier priority is global. Every hot job runs before any warm one, because a
 *   hot tag is one somebody is actually looking at.
 *
 *   Hosts are served round-robin within each tier, so a host with many due tags
 *   cannot swallow the whole budget and starve the others. Coverage depends on
 *   breadth across servers, so breadth wins over depth on any one.
 *
 *   Tags are only batched with others in the same tier. Tier is derived from
 *   observed volume, so it is the available proxy for similar volume, and the
 *   limit of 40 statuses is shared across a batch. Batching a busy tag with a
 *   quiet one loses the quiet one's posts.
 */

import { TIER_INTERVAL_SECONDS, TIER_ORDER, type Tier } from './types';

export interface SchedulableTag {
  id: number;
  name: string;
  tier: Tier;
}

export interface CursorState {
  minId: string | null;
  polledAt: number | null;
  /**
   * The last poll returned a full page, so there is more behind it. Because
   * min_id paginates forward from the cursor, a full page is a backlog and not
   * a loss, and the right response is to poll again next tick rather than wait
   * out the tier interval.
   */
  behind?: boolean;
}

export interface PollJob {
  host: string;
  tags: SchedulableTag[];
  /**
   * The oldest cursor in the batch, or null for a full fetch.
   *
   * One request covers several tags but each tag has its own cursor, so the
   * oldest is the only safe choice: anything newer would skip posts for the
   * tags that are further behind. It re-reads some posts for the others, which
   * costs nothing because the primary key on (tag_id, uri) makes writing them
   * again idempotent.
   */
  minId: string | null;
  tier: Tier;
}

export interface PlanInput {
  /** Unix seconds. */
  now: number;
  /** Hosts already filtered to opted-in, healthy and capability 'timeline'. */
  hosts: readonly string[];
  tags: readonly SchedulableTag[];
  cursors: ReadonlyMap<string, CursorState>;
  maxRequests: number;
  maxTagsPerBatch: number;
}

export function cursorKey(host: string, tagId: number): string {
  return `${host}\n${tagId}`;
}

/**
 * Compare two Mastodon snowflake ids. They are decimal strings that outrun
 * Number.MAX_SAFE_INTEGER, so they are compared as BigInt rather than parsed.
 * A malformed id sorts last, which makes it lose a min() and so triggers a full
 * fetch rather than a skip.
 */
export function compareSnowflake(a: string, b: string): number {
  const left = toBigInt(a);
  const right = toBigInt(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function toBigInt(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * The safe cursor for a batch: the oldest of them, or null if any tag in the
 * batch has never been polled on this host. A missing cursor means we have no
 * floor for that tag, so the whole batch has to be read without one.
 */
export function batchMinId(cursors: readonly (string | null)[]): string | null {
  let oldest: string | null = null;
  for (const cursor of cursors) {
    if (cursor === null) return null;
    if (oldest === null || compareSnowflake(cursor, oldest) < 0) oldest = cursor;
  }
  return oldest;
}

interface Candidate {
  host: string;
  tag: SchedulableTag;
  cursor: string | null;
  /** Seconds past due. Never-polled tags sort first within their tier. */
  overdue: number;
}

export function planTick(input: PlanInput): PollJob[] {
  const { now, tags, cursors, maxTagsPerBatch } = input;
  const maxRequests = Math.max(0, input.maxRequests);
  if (maxRequests === 0) return [];

  const hosts = [...input.hosts].sort();

  // Group due work by tier, then by host, so tier priority can be applied
  // globally while hosts are still served round-robin inside each tier.
  const byTier = new Map<Tier, Map<string, Candidate[]>>();

  for (const host of hosts) {
    for (const tag of tags) {
      const state = cursors.get(cursorKey(host, tag.id));
      const polledAt = state?.polledAt ?? null;
      const interval = TIER_INTERVAL_SECONDS[tag.tier];

      // A never-polled pair is maximally overdue, so new tags start promptly.
      // A pair known to be behind is due whatever its tier says, so a backlog
      // drains at one page per tick instead of one page per interval.
      const overdue =
        polledAt === null
          ? Number.MAX_SAFE_INTEGER
          : state?.behind === true
            ? Number.MAX_SAFE_INTEGER - 1
            : now - polledAt - interval;
      if (overdue < 0) continue;

      let hostMap = byTier.get(tag.tier);
      if (hostMap === undefined) {
        hostMap = new Map();
        byTier.set(tag.tier, hostMap);
      }
      const list = hostMap.get(host);
      if (list === undefined) hostMap.set(host, [{ host, tag, cursor: state?.minId ?? null, overdue }]);
      else list.push({ host, tag, cursor: state?.minId ?? null, overdue });
    }
  }

  const jobs: PollJob[] = [];
  const tiers = [...byTier.keys()].sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b]);

  for (const tier of tiers) {
    const hostMap = byTier.get(tier);
    if (hostMap === undefined) continue;

    // Hot tags are never batched, because a busy tag needs the whole limit of
    // 40 statuses to itself.
    const batchSize = tier === 'hot' ? 1 : Math.max(1, maxTagsPerBatch);

    const queues = new Map<string, PollJob[]>();
    for (const [host, candidates] of hostMap) {
      candidates.sort((a, b) => b.overdue - a.overdue || a.tag.id - b.tag.id);
      const queue: PollJob[] = [];
      for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        queue.push({
          host,
          tags: batch.map((candidate) => candidate.tag),
          minId: batchMinId(batch.map((candidate) => candidate.cursor)),
          tier,
        });
      }
      queues.set(host, queue);
    }

    // Round-robin across hosts until this tier is drained or the budget is.
    let served = true;
    while (served && jobs.length < maxRequests) {
      served = false;
      for (const host of hosts) {
        if (jobs.length >= maxRequests) break;
        const queue = queues.get(host);
        const job = queue?.shift();
        if (job === undefined) continue;
        jobs.push(job);
        served = true;
      }
    }

    if (jobs.length >= maxRequests) break;
  }

  return jobs;
}

// --- Tier assignment --------------------------------------------------------

export interface TierCandidate {
  id: number;
  /** Posts observed for this tag in the last hour. */
  postsPerHour: number;
  /** When a human last asked about it, or null. */
  lastQueryAt: number | null;
}

export interface TierLimits {
  now: number;
  /**
   * How many tags may be hot at once. A hot tag costs one request per instance
   * per minute, so this is the most expensive dial in the system and the
   * request budget sets it rather than taste.
   */
  maxHot: number;
  maxWarm: number;
  /** A query within this many seconds counts as live human interest. */
  queryFreshnessSeconds?: number;
}

/**
 * Decide each tag's polling tier.
 *
 * Two things earn frequency: how much a tag is actually producing, and whether
 * somebody is looking at it right now. The second matters as much as the first,
 * because a tag nobody has opened does not need minute-level freshness however
 * busy it is, and a quiet tag somebody is watching does.
 *
 * Tiers are assigned by ranking rather than by threshold, because the request
 * budget is fixed. A threshold would let a busy day promote thirty tags to hot
 * and blow the budget, so the top maxHot win and the rest fall through.
 */
export function assignTiers(
  candidates: readonly TierCandidate[],
  limits: TierLimits,
): Map<number, Tier> {
  const freshness = limits.queryFreshnessSeconds ?? 900;

  const scored = candidates.map((candidate) => {
    const queriedAgo =
      candidate.lastQueryAt === null ? Number.POSITIVE_INFINITY : limits.now - candidate.lastQueryAt;
    const beingWatched = queriedAgo <= freshness;
    return {
      id: candidate.id,
      // Human interest outranks volume outright rather than being blended into
      // it, so a quiet tag somebody has open still gets served promptly.
      score: (beingWatched ? 1_000_000 : 0) + candidate.postsPerHour,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.id - b.id);

  const tiers = new Map<number, Tier>();
  const maxHot = Math.max(0, limits.maxHot);
  const maxWarm = Math.max(0, limits.maxWarm);

  scored.forEach((entry, rank) => {
    // A tag with no activity and no interest is never promoted, however few
    // competitors it has. Ranking decides who gets a slot, not whether one is
    // warranted at all.
    if (entry.score === 0) {
      tiers.set(entry.id, 'cold');
      return;
    }
    if (rank < maxHot) tiers.set(entry.id, 'hot');
    else if (rank < maxHot + maxWarm) tiers.set(entry.id, 'warm');
    else tiers.set(entry.id, 'cold');
  });

  return tiers;
}
