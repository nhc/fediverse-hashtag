/**
 * One collection tick.
 *
 * The shape that matters: every instance's view of this minute is merged in
 * memory before anything is written, keyed on the ActivityPub object id. Eight
 * servers reporting the same post therefore cost one row write rather than
 * eight, and the mask recording which of them saw it is assembled on the way
 * through. That merge is what makes the coverage figures affordable.
 */

import {
  applyHealth,
  loadCursors,
  recordCandidates,
  loadInstances,
  loadSuppressedAuthors,
  loadTags,
  recordPolls,
  refreshRollups,
  saveCursors,
  upsertObservations,
  type CursorPatch,
  type InstanceHealthPatch,
  type ObservationWrite,
  type PollLogEntry,
} from './db';
import { MAX_LIMIT, fetchTagTimeline } from './mastodon';
import { hashKey, normalise } from './normalise';
import { healthAfterPoll, isCollectable } from './registry';
import { planTick, type PollJob, type SchedulableTag } from './scheduler';
import type { Env, NormalisedPost } from './types';

/**
 * Simultaneous outbound connections. Workers caps this at six per invocation,
 * so asking for more only queues them.
 */
const CONCURRENCY = 6;

/** Minutes of rollup to recompute, so posts arriving late land in their own minute. */
const ROLLUP_LOOKBACK_SECONDS = 600;

export interface CollectConfig {
  userAgent: string;
  salt: string;
  maxRequests: number;
  maxParseBytes: number;
  maxTagsPerBatch: number;
  rateLimitFloor: number;
  retentionHours: number;
  maxCandidateWrites: number;
}

export interface TickReport {
  at: number;
  jobsPlanned: number;
  jobsRun: number;
  jobsDeferred: number;
  bytesParsed: number;
  hostsOk: number;
  hostsFailed: number;
  postsObserved: number;
  observationsWritten: number;
  /** Distinct untracked tags seen this tick, before the write cap is applied. */
  candidatesSeen: number;
  candidatesWritten: number;
  skipped: { nonPublic: number; malformed: number; suppressed: number };
  note: string | null;
}

export function configFromEnv(env: Env): CollectConfig {
  const number = (value: string, fallback: number): number => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    userAgent: env.COLLECTOR_USER_AGENT,
    salt: env.AUTHOR_SALT,
    maxRequests: number(env.MAX_REQUESTS_PER_TICK, 43),
    maxParseBytes: number(env.MAX_PARSE_BYTES_PER_TICK, 2_000_000),
    maxTagsPerBatch: number(env.MAX_TAGS_PER_BATCH, 4),
    rateLimitFloor: number(env.RATELIMIT_FLOOR, 30),
    retentionHours: number(env.RETENTION_HOURS, 25),
    maxCandidateWrites: number(env.MAX_CANDIDATE_WRITES_PER_TICK, 60),
  };
}

interface MergedObservation {
  tagId: number;
  post: NormalisedPost;
  /** BigInt because the mask can exceed the 32 bits JavaScript bitwise ops use. */
  mask: bigint;
}

export async function collectTick(env: Env, now: number): Promise<TickReport> {
  const config = configFromEnv(env);
  const report: TickReport = {
    at: now,
    jobsPlanned: 0,
    jobsRun: 0,
    jobsDeferred: 0,
    bytesParsed: 0,
    hostsOk: 0,
    hostsFailed: 0,
    postsObserved: 0,
    observationsWritten: 0,
    candidatesSeen: 0,
    candidatesWritten: 0,
    skipped: { nonPublic: 0, malformed: 0, suppressed: 0 },
    note: null,
  };

  if (!config.salt) {
    report.note = 'AUTHOR_SALT is not set, so nothing was collected';
    return report;
  }

  const [instances, tags, cursors, suppressed] = await Promise.all([
    loadInstances(env.DB),
    loadTags(env.DB),
    loadCursors(env.DB),
    loadSuppressedAuthors(env.DB),
  ]);

  const collectable = instances.filter((instance) => isCollectable(instance, now));
  if (collectable.length === 0 || tags.length === 0) {
    report.note =
      collectable.length === 0
        ? 'no instances are currently collectable'
        : 'no tags are being tracked';
    return report;
  }

  const bitByHost = new Map<string, number>();
  for (const instance of collectable) if (instance.bit !== null) bitByHost.set(instance.host, instance.bit);

  // Every tracked tag, so a post fetched for one tag also credits the other
  // tracked tags it carries. That is free coverage: the request has already
  // been paid for, and the write is idempotent.
  const tagIdByName = new Map<string, number>();
  for (const tag of tags) tagIdByName.set(tag.name, tag.id);

  const schedulable: SchedulableTag[] = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    tier: tag.tier,
  }));

  const jobs = planTick({
    now,
    hosts: [...bitByHost.keys()],
    tags: schedulable,
    cursors,
    maxRequests: config.maxRequests,
    maxTagsPerBatch: config.maxTagsPerBatch,
  });
  report.jobsPlanned = jobs.length;

  const merged = new Map<string, MergedObservation>();

  // Tags seen on collected posts that the index is not yet tracking. This is
  // the discovery pool, and it costs nothing to gather: the request has already
  // been paid for and the tags are sitting in the response.
  const candidates = new Map<string, { authors: Map<string, Uint8Array>; occurrences: number }>();
  const cursorPatches: CursorPatch[] = [];
  const pollEntries: PollLogEntry[] = [];
  const failuresByHost = new Map<string, number>();
  const healthByHost = new Map<string, InstanceHealthPatch>();
  const affectedTagIds = new Set<number>();
  const succeededHosts = new Set<string>();
  const failedHosts = new Set<string>();

  for (const instance of collectable) failuresByHost.set(instance.host, instance.consecutive_failures);

  let index = 0;
  while (index < jobs.length) {
    // The parse budget is checked between waves rather than before each parse,
    // because the client parses as it reads. A wave can therefore overshoot by
    // at most six responses, which is well under a millisecond of CPU.
    if (report.bytesParsed >= config.maxParseBytes) break;

    const wave = jobs.slice(index, index + CONCURRENCY);
    index += wave.length;

    const outcomes = await Promise.all(
      wave.map(async (job) => ({
        job,
        outcome: await fetchTagTimeline(
          job.host,
          job.tags.map((tag) => tag.name),
          job.minId,
          { userAgent: config.userAgent },
        ),
      })),
    );

    for (const { job, outcome } of outcomes) {
      report.jobsRun += 1;
      report.bytesParsed += outcome.bytes;

      pollEntries.push({
        host: job.host,
        at: now,
        status: outcome.status,
        tags: job.tags.length,
        newObservations: 0,
        latencyMs: outcome.latencyMs,
        rateLimitRemaining: outcome.rateLimitRemaining,
      });

      const before = failuresByHost.get(job.host) ?? 0;
      const health = healthAfterPoll({
        consecutiveFailures: before,
        now,
        status: outcome.status,
        ok: outcome.ok,
        rateLimitRemaining: outcome.rateLimitRemaining,
        rateLimitReset: outcome.rateLimitReset,
        rateLimitFloor: config.rateLimitFloor,
      });
      failuresByHost.set(job.host, health.consecutiveFailures);
      healthByHost.set(job.host, {
        host: job.host,
        consecutiveFailures: health.consecutiveFailures,
        backoffUntil: health.backoffUntil,
        lastOkAt: health.lastOkAt,
        capability: health.capability,
      });

      if (!outcome.ok || outcome.data === null) {
        failedHosts.add(job.host);
        // The cursor is deliberately left alone. A failed poll must not look
        // like a successful empty one, or the gap it left would never be read.
        continue;
      }

      succeededHosts.add(job.host);
      const statuses = outcome.data;
      const { posts, skipped } = await normalise(statuses, { salt: config.salt, suppressed });
      report.skipped.nonPublic += skipped.nonPublic;
      report.skipped.malformed += skipped.malformed;
      report.skipped.suppressed += skipped.suppressed;
      report.postsObserved += posts.length;

      const bit = bitByHost.get(job.host);
      const mask = bit === undefined ? 0n : 1n << BigInt(bit);

      for (const post of posts) {
        for (const name of post.tags) {
          const tagId = tagIdByName.get(name);

          if (tagId === undefined) {
            // Not tracked, so it becomes a discovery candidate rather than being
            // thrown away. Authors are deduplicated by hash within the tick, so
            // one person using a tag three times counts once.
            const entry = candidates.get(name);
            if (entry === undefined) {
              candidates.set(name, {
                authors: new Map([[hashKey(post.authorHash), post.authorHash]]),
                occurrences: 1,
              });
            } else {
              entry.authors.set(hashKey(post.authorHash), post.authorHash);
              entry.occurrences += 1;
            }
            continue;
          }

          const key = `${tagId}\n${post.uri}`;
          const existing = merged.get(key);
          if (existing === undefined) merged.set(key, { tagId, post, mask });
          else existing.mask |= mask;
          affectedTagIds.add(tagId);
        }
      }

      recordCursorAdvance(cursorPatches, job, outcome.nextCursor, statuses.length, now);
    }
  }

  report.jobsDeferred = jobs.length - index;
  report.hostsOk = succeededHosts.size;
  report.hostsFailed = failedHosts.size;

  const writes: ObservationWrite[] = [...merged.values()].map((entry) => ({
    tagId: entry.tagId,
    uri: entry.post.uri,
    url: entry.post.url,
    originHost: entry.post.originHost,
    authorHash: entry.post.authorHash,
    createdAt: entry.post.createdAt,
    observedAt: now,
    seenMask: Number(entry.mask),
    isBoost: entry.post.isBoost,
    sensitive: entry.post.sensitive,
    language: entry.post.language,
  }));
  report.observationsWritten = writes.length;

  // Discovery writes are capped, because recording every co-occurring tag would
  // be several hundred rows a minute and the free tier allows 100,000 a day in
  // total. Tags that appeared most often in this tick go first, on the grounds
  // that a tag showing up repeatedly is likelier to matter than one seen once.
  report.candidatesSeen = candidates.size;
  const candidateWrites: { name: string; authorHash: Uint8Array }[] = [];
  const ranked = [...candidates.entries()].sort(
    (a, b) => b[1].occurrences - a[1].occurrences || a[0].localeCompare(b[0]),
  );
  for (const [name, entry] of ranked) {
    if (candidateWrites.length >= config.maxCandidateWrites) break;
    for (const authorHash of entry.authors.values()) {
      if (candidateWrites.length >= config.maxCandidateWrites) break;
      candidateWrites.push({ name, authorHash });
    }
  }
  report.candidatesWritten = candidateWrites.length;

  if (writes.length > 0) await upsertObservations(env.DB, writes);
  if (candidateWrites.length > 0) await recordCandidates(env.DB, candidateWrites, now);
  if (cursorPatches.length > 0) await saveCursors(env.DB, cursorPatches);
  if (pollEntries.length > 0) await recordPolls(env.DB, pollEntries);
  if (healthByHost.size > 0) await applyHealth(env.DB, [...healthByHost.values()]);
  if (affectedTagIds.size > 0) {
    await refreshRollups(
      env.DB,
      [...affectedTagIds],
      now - ROLLUP_LOOKBACK_SECONDS,
      succeededHosts.size,
    );
  }

  if (report.jobsDeferred > 0) {
    report.note = `parse budget reached, ${report.jobsDeferred} jobs deferred to the next tick`;
  }

  return report;
}

/**
 * Advance the cursor for every tag in the job.
 *
 * A full page means there is a backlog rather than a loss, because min_id
 * paginates forward from the cursor. The behind flag makes the pair due again
 * next tick, so a backlog drains a page a minute instead of a page an interval.
 *
 * An empty page leaves min_id as it was and only moves polled_at, which is why
 * saveCursors coalesces a null min_id rather than writing it.
 */
export function recordCursorAdvance(
  into: CursorPatch[],
  job: PollJob,
  nextCursor: string | null,
  returned: number,
  now: number,
): void {
  const behind = returned >= MAX_LIMIT;
  for (const tag of job.tags) {
    into.push({ host: job.host, tagId: tag.id, minId: nextCursor, polledAt: now, behind });
  }
}
