/**
 * D1 access. Every SQL statement in the service lives here.
 *
 * Two habits worth keeping while reading it. Writes are batched, because the
 * point of merging a tick in memory first is that a new post costs one write
 * rather than one per instance. And window queries always filter on
 * (tag_id, created_at), which is the index that makes them cheap, because D1
 * bills for rows scanned rather than rows returned.
 */

import { cursorKey, type CursorState } from './scheduler';
import type { Capability, InstanceRow, TagRow, Tier } from './types';

/** D1 accepts numbers, strings, blobs and null. Enough for everything here. */
type Bind = number | string | ArrayBuffer | null;

/**
 * Statements per batch. D1 has no small hard limit, but a bounded batch keeps
 * any single failure from taking a whole tick's writes with it.
 */
const BATCH_SIZE = 50;

async function runBatched(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE));
  }
}

function blob(bytes: Uint8Array): ArrayBuffer {
  // Copy, so a view onto a larger buffer cannot smuggle extra bytes into D1.
  return bytes.slice().buffer as ArrayBuffer;
}

// --- Instances --------------------------------------------------------------

export async function loadInstances(db: D1Database): Promise<InstanceRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM instance ORDER BY host')
    .all<InstanceRow>();
  return results ?? [];
}

export async function upsertInstance(
  db: D1Database,
  host: string,
  bit: number | null,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO instance (host, bit, added_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(host) DO NOTHING`,
    )
    .bind(host, bit, now)
    .run();
}

export async function recordProbe(
  db: D1Database,
  host: string,
  software: string | null,
  version: string | null,
  capability: Capability,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE instance
          SET software = ?2, version = ?3, capability = ?4, probed_at = ?5
        WHERE host = ?1`,
    )
    .bind(host, software, version, capability, now)
    .run();
}

export interface InstanceHealthPatch {
  host: string;
  consecutiveFailures: number;
  backoffUntil: number | null;
  lastOkAt: number | null;
  capability: Capability | null;
}

export async function applyHealth(db: D1Database, patches: readonly InstanceHealthPatch[]): Promise<void> {
  const statements = patches.map((patch) =>
    db
      .prepare(
        `UPDATE instance
            SET consecutive_failures = ?2,
                backoff_until        = ?3,
                last_ok_at           = COALESCE(?4, last_ok_at),
                capability           = COALESCE(?5, capability)
          WHERE host = ?1`,
      )
      .bind(
        patch.host,
        patch.consecutiveFailures,
        patch.backoffUntil,
        patch.lastOkAt,
        patch.capability,
      ),
  );
  await runBatched(db, statements);
}

/**
 * Mark a server as opted out and forget what it told us.
 *
 * The observations go at the next retention sweep rather than here, because
 * deleting them inline could be a very large write on a busy server and the
 * sweep already runs hourly.
 */
export async function setOptOut(
  db: D1Database,
  host: string,
  reason: string,
): Promise<void> {
  await db
    .prepare('UPDATE instance SET opt_out = 1, opt_out_reason = ?2 WHERE host = ?1')
    .bind(host, reason)
    .run();
}

// --- Tags -------------------------------------------------------------------

export async function loadTags(db: D1Database): Promise<TagRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM tag WHERE blocked = 0 ORDER BY id')
    .all<TagRow>();
  return results ?? [];
}

export async function findTag(db: D1Database, name: string): Promise<TagRow | null> {
  return await db.prepare('SELECT * FROM tag WHERE name = ?1').bind(name).first<TagRow>();
}

/**
 * Register a tag if it is new, and record that somebody asked about it.
 *
 * Human interest is one of the two things that earns a tag a faster polling
 * tier, the other being observed volume, so a search is a signal and not just a
 * read.
 */
export async function registerTagQuery(
  db: D1Database,
  name: string,
  display: string,
  now: number,
): Promise<TagRow | null> {
  await db
    .prepare(
      `INSERT INTO tag (name, display, tier, first_seen_at, last_query_at, query_count)
       VALUES (?1, ?2, 'cold', ?3, ?3, 1)
       ON CONFLICT(name) DO UPDATE
          SET last_query_at = ?3,
              query_count   = query_count + 1,
              display       = COALESCE(tag.display, ?2)`,
    )
    .bind(name, display, now)
    .run();
  return await findTag(db, name);
}

export async function setTagTier(db: D1Database, tagId: number, tier: Tier): Promise<void> {
  await db.prepare('UPDATE tag SET tier = ?2 WHERE id = ?1').bind(tagId, tier).run();
}

// --- Cursors ----------------------------------------------------------------

interface CursorRow {
  host: string;
  tag_id: number;
  min_id: string | null;
  polled_at: number | null;
  behind: number;
}

export async function loadCursors(db: D1Database): Promise<Map<string, CursorState>> {
  const { results } = await db
    .prepare('SELECT host, tag_id, min_id, polled_at, behind FROM cursor')
    .all<CursorRow>();

  const cursors = new Map<string, CursorState>();
  for (const row of results ?? []) {
    cursors.set(cursorKey(row.host, row.tag_id), {
      minId: row.min_id,
      polledAt: row.polled_at,
      behind: row.behind === 1,
    });
  }
  return cursors;
}

export interface CursorPatch {
  host: string;
  tagId: number;
  minId: string | null;
  polledAt: number;
  behind: boolean;
}

export async function saveCursors(db: D1Database, patches: readonly CursorPatch[]): Promise<void> {
  const statements = patches.map((patch) =>
    db
      .prepare(
        `INSERT INTO cursor (host, tag_id, min_id, polled_at, behind, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4)
         ON CONFLICT(host, tag_id) DO UPDATE
            SET min_id     = COALESCE(excluded.min_id, cursor.min_id),
                polled_at  = excluded.polled_at,
                behind     = excluded.behind,
                updated_at = excluded.updated_at`,
      )
      .bind(patch.host, patch.tagId, patch.minId, patch.polledAt, patch.behind ? 1 : 0),
  );
  await runBatched(db, statements);
}

// --- Observations -----------------------------------------------------------

export interface ObservationWrite {
  tagId: number;
  uri: string;
  url: string | null;
  originHost: string;
  authorHash: Uint8Array;
  createdAt: number;
  observedAt: number;
  seenMask: number;
  isBoost: boolean;
  sensitive: boolean;
  language: string | null;
}

/**
 * Write a tick's observations.
 *
 * The conflict clause is the whole deduplication story. A post already known
 * for this tag has its mask widened by the instances that reported it this
 * time, and nothing else about it changes. Re-delivery is therefore free and
 * expected rather than an error to guard against, and the first observation
 * timestamp is never overwritten by a later sighting.
 */
export async function upsertObservations(
  db: D1Database,
  rows: readonly ObservationWrite[],
): Promise<void> {
  const statements = rows.map((row) =>
    db
      .prepare(
        `INSERT INTO observation
           (tag_id, uri, url, origin_host, author_hash, created_at, observed_at,
            seen_mask, is_boost, sensitive, language)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(tag_id, uri) DO UPDATE
            SET seen_mask = observation.seen_mask | excluded.seen_mask`,
      )
      .bind(
        row.tagId,
        row.uri,
        row.url,
        row.originHost,
        blob(row.authorHash),
        row.createdAt,
        row.observedAt,
        row.seenMask,
        row.isBoost ? 1 : 0,
        row.sensitive ? 1 : 0,
        row.language,
      ),
  );
  await runBatched(db, statements);
}

export async function loadSuppressedAuthors(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT author_hash FROM author_suppression')
    .all<{ author_hash: ArrayBuffer }>();

  const hashes = new Set<string>();
  for (const row of results ?? []) {
    let hex = '';
    for (const byte of new Uint8Array(row.author_hash)) hex += byte.toString(16).padStart(2, '0');
    hashes.add(hex);
  }
  return hashes;
}

export async function suppressAuthor(
  db: D1Database,
  hash: Uint8Array,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO author_suppression (author_hash, added_at) VALUES (?1, ?2)
       ON CONFLICT(author_hash) DO NOTHING`,
    )
    .bind(blob(hash), now)
    .run();
  await db.prepare('DELETE FROM observation WHERE author_hash = ?1').bind(blob(hash)).run();
}

// --- Windowed reads ---------------------------------------------------------

export interface WindowCounts {
  postsObserved: number;
  authorsObserved: number;
  boostsObserved: number;
}

export async function windowCounts(
  db: D1Database,
  tagId: number,
  from: number,
  to: number,
): Promise<WindowCounts> {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN is_boost = 0 THEN 1 ELSE 0 END)                    AS posts,
         COUNT(DISTINCT CASE WHEN is_boost = 0 THEN author_hash END)      AS authors,
         SUM(CASE WHEN is_boost = 1 THEN 1 ELSE 0 END)                    AS boosts
       FROM observation
       WHERE tag_id = ?1 AND created_at >= ?2 AND created_at < ?3`,
    )
    .bind(tagId, from, to)
    .first<{ posts: number | null; authors: number | null; boosts: number | null }>();

  return {
    postsObserved: row?.posts ?? 0,
    authorsObserved: row?.authors ?? 0,
    boostsObserved: row?.boosts ?? 0,
  };
}

/**
 * The distribution of seen_mask values in a window.
 *
 * Grouped rather than listed, because the median only needs the distribution
 * and there are at most 2^instances distinct masks. That keeps this a handful
 * of rows instead of one per post.
 */
export async function maskDistribution(
  db: D1Database,
  tagId: number,
  from: number,
  to: number,
): Promise<{ mask: number; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT seen_mask AS mask, COUNT(*) AS count
         FROM observation
        WHERE tag_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND is_boost = 0
        GROUP BY seen_mask`,
    )
    .bind(tagId, from, to)
    .all<{ mask: number; count: number }>();
  return results ?? [];
}

export async function originBreakdown(
  db: D1Database,
  tagId: number,
  from: number,
  to: number,
  limit = 20,
): Promise<{ host: string; postsObserved: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT origin_host AS host, COUNT(*) AS posts
         FROM observation
        WHERE tag_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND is_boost = 0
        GROUP BY origin_host
        ORDER BY posts DESC, host ASC
        LIMIT ?4`,
    )
    .bind(tagId, from, to, limit)
    .all<{ host: string; posts: number }>();
  return (results ?? []).map((row) => ({ host: row.host, postsObserved: row.posts }));
}

export async function distinctOriginCount(
  db: D1Database,
  tagId: number,
  from: number,
  to: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT origin_host) AS n
         FROM observation
        WHERE tag_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND is_boost = 0`,
    )
    .bind(tagId, from, to)
    .first<{ n: number | null }>();
  return row?.n ?? 0;
}

/**
 * Permalinks to representative posts.
 *
 * Links only, because no content is stored. Sensitive posts are excluded
 * outright rather than hidden behind a click, and a deleted post becomes a dead
 * link rather than a copy that outlives its deletion. See docs/privacy.md.
 */
export async function representativePosts(
  db: D1Database,
  tagId: number,
  from: number,
  limit = 10,
): Promise<{ url: string; createdAt: number; originHost: string; seenMask: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT url, created_at, origin_host, seen_mask
         FROM observation
        WHERE tag_id = ?1
          AND created_at >= ?2
          AND is_boost = 0
          AND sensitive = 0
          AND url IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ?3`,
    )
    .bind(tagId, from, limit)
    .all<{ url: string; created_at: number; origin_host: string; seen_mask: number }>();

  return (results ?? []).map((row) => ({
    url: row.url,
    createdAt: row.created_at,
    originHost: row.origin_host,
    seenMask: row.seen_mask,
  }));
}

/** Distinct hosts that polled successfully in a window, from the poll log. */
export async function instancesReporting(
  db: D1Database,
  from: number,
  to: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT host) AS n
         FROM poll_log
        WHERE at >= ?1 AND at < ?2 AND status = 200`,
    )
    .bind(from, to)
    .first<{ n: number | null }>();
  return row?.n ?? 0;
}

export async function hostsReportingForTag(
  db: D1Database,
  tagId: number,
  from: number,
  to: number,
): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT seen_mask AS mask
         FROM observation
        WHERE tag_id = ?1 AND created_at >= ?2 AND created_at < ?3`,
    )
    .bind(tagId, from, to)
    .all<{ mask: number }>();
  return (results ?? []).map((row) => row.mask);
}

// --- Rollups, logging and retention -----------------------------------------

/**
 * Recompute the per-minute rollups for these tags.
 *
 * Recomputed rather than incremented, and that is the whole point. A post can
 * be observed again in a later tick when a second instance reports it, so
 * adding to a running total would count it twice. Reading the count back out of
 * the observation table makes the rollup idempotent, which matters because the
 * collector is built to expect duplicate delivery rather than to prevent it.
 *
 * The lookback exists because posts arrive late. A post written two minutes ago
 * that only reached a monitored server now belongs in its own minute, not this
 * one, so recent minutes are revisited rather than sealed.
 */
export async function refreshRollups(
  db: D1Database,
  tagIds: readonly number[],
  sinceSeconds: number,
  instancesReporting: number,
): Promise<void> {
  const statements = tagIds.map((tagId) =>
    db
      .prepare(
        `INSERT INTO tag_minute (tag_id, minute, posts, instances_reporting)
         SELECT tag_id, created_at / 60, COUNT(*), ?3
           FROM observation
          WHERE tag_id = ?1 AND created_at >= ?2 AND is_boost = 0
          GROUP BY tag_id, created_at / 60
         ON CONFLICT(tag_id, minute) DO UPDATE
            SET posts               = excluded.posts,
                instances_reporting = MAX(tag_minute.instances_reporting,
                                          excluded.instances_reporting)`,
      )
      .bind(tagId, sinceSeconds, instancesReporting),
  );
  await runBatched(db, statements);
}

export async function timeseries(
  db: D1Database,
  tagId: number,
  fromMinute: number,
  toMinute: number,
): Promise<{ minute: number; posts: number; instancesReporting: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT minute, posts, instances_reporting
         FROM tag_minute
        WHERE tag_id = ?1 AND minute >= ?2 AND minute < ?3
        ORDER BY minute`,
    )
    .bind(tagId, fromMinute, toMinute)
    .all<{ minute: number; posts: number; instances_reporting: number }>();

  return (results ?? []).map((row) => ({
    minute: row.minute,
    posts: row.posts,
    instancesReporting: row.instances_reporting,
  }));
}

export interface PollLogEntry {
  host: string;
  at: number;
  status: number;
  tags: number;
  newObservations: number;
  latencyMs: number;
  rateLimitRemaining: number | null;
}

export async function recordPolls(db: D1Database, entries: readonly PollLogEntry[]): Promise<void> {
  const statements = entries.map((entry) =>
    db
      .prepare(
        `INSERT INTO poll_log
           (host, at, status, tags, new_observations, latency_ms, ratelimit_remaining)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        entry.host,
        entry.at,
        entry.status,
        entry.tags,
        entry.newObservations,
        entry.latencyMs,
        entry.rateLimitRemaining,
      ),
  );
  await runBatched(db, statements);
}

export interface InstanceHealthSummary {
  host: string;
  capability: Capability;
  optOut: number;
  lastOkAt: number | null;
  consecutiveFailures: number;
  backoffUntil: number | null;
  polls: number;
  failures: number;
  medianLatencyMs: number | null;
  minRateLimitRemaining: number | null;
}

export async function healthSummary(
  db: D1Database,
  since: number,
): Promise<InstanceHealthSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT i.host,
              i.capability,
              i.opt_out               AS optOut,
              i.last_ok_at            AS lastOkAt,
              i.consecutive_failures  AS consecutiveFailures,
              i.backoff_until         AS backoffUntil,
              COUNT(p.id)                                          AS polls,
              -- The p.id guard matters. This is a LEFT JOIN, so a server with
              -- no polls in the window has a NULL status, and comparing NULL
              -- to 200 is not true, which would score every quiet server a
              -- failure.
              SUM(CASE WHEN p.id IS NULL     THEN 0
                       WHEN p.status = 200   THEN 0
                       ELSE 1 END)                                 AS failures,
              AVG(p.latency_ms)                                    AS avgLatency,
              MIN(p.ratelimit_remaining)                           AS minRateLimit
         FROM instance i
         LEFT JOIN poll_log p ON p.host = i.host AND p.at >= ?1
        GROUP BY i.host
        ORDER BY i.host`,
    )
    .bind(since)
    .all<{
      host: string;
      capability: Capability;
      optOut: number;
      lastOkAt: number | null;
      consecutiveFailures: number;
      backoffUntil: number | null;
      polls: number;
      failures: number | null;
      avgLatency: number | null;
      minRateLimit: number | null;
    }>();

  return (results ?? []).map((row) => ({
    host: row.host,
    capability: row.capability,
    optOut: row.optOut,
    lastOkAt: row.lastOkAt,
    consecutiveFailures: row.consecutiveFailures,
    backoffUntil: row.backoffUntil,
    polls: row.polls,
    failures: row.failures ?? 0,
    medianLatencyMs: row.avgLatency === null ? null : Math.round(row.avgLatency),
    minRateLimitRemaining: row.minRateLimit,
  }));
}

export async function saveTagHistory(
  db: D1Database,
  tagId: number,
  host: string,
  days: readonly { day: number; uses: number; accounts: number }[],
  now: number,
): Promise<void> {
  const statements = days.map((entry) =>
    db
      .prepare(
        `INSERT INTO tag_history (tag_id, host, day, uses, accounts, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(tag_id, host, day) DO UPDATE
            SET uses = excluded.uses,
                accounts = excluded.accounts,
                fetched_at = excluded.fetched_at`,
      )
      .bind(tagId, host, entry.day, entry.uses, entry.accounts, now),
  );
  await runBatched(db, statements);
}

export async function loadTagHistory(
  db: D1Database,
  tagId: number,
): Promise<{ host: string; day: number; uses: number; accounts: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT host, day, uses, accounts FROM tag_history
        WHERE tag_id = ?1 ORDER BY day DESC, host ASC`,
    )
    .bind(tagId)
    .all<{ host: string; day: number; uses: number; accounts: number }>();
  return results ?? [];
}

/**
 * Posts observed per tag in the last hour, for deciding polling tiers.
 *
 * Returned for every tracked tag including the silent ones, because a tag that
 * has gone quiet needs demoting as much as a busy one needs promoting.
 */
export async function postsPerHourByTag(
  db: D1Database,
  now: number,
): Promise<Map<number, number>> {
  const { results } = await db
    .prepare(
      `SELECT t.id AS id, COUNT(o.uri) AS posts
         FROM tag t
         LEFT JOIN observation o
                ON o.tag_id = t.id AND o.created_at >= ?1 AND o.is_boost = 0
        WHERE t.blocked = 0
        GROUP BY t.id`,
    )
    .bind(now - 3600)
    .all<{ id: number; posts: number }>();

  const counts = new Map<number, number>();
  for (const row of results ?? []) counts.set(row.id, row.posts);
  return counts;
}

export interface SweepResult {
  observations: number;
  pollLog: number;
  rollups: number;
  optedOut: number;
}

/**
 * The retention sweep.
 *
 * Short retention is a privacy measure, a cost measure and a limit on the
 * damage undetected deletions can do, all at once. It also removes what an
 * opted-out server told us, which is why opting out is honoured here as well as
 * at collection time.
 */
export async function sweep(
  db: D1Database,
  now: number,
  retentionHours: number,
): Promise<SweepResult> {
  const observationCutoff = now - retentionHours * 3600;
  const pollLogCutoff = now - 7 * 24 * 3600;
  const rollupCutoff = Math.floor((now - 30 * 24 * 3600) / 60);

  const observations = await db
    .prepare('DELETE FROM observation WHERE created_at < ?1')
    .bind(observationCutoff)
    .run();

  const optedOut = await db
    .prepare(
      `DELETE FROM observation
        WHERE origin_host IN (SELECT host FROM instance WHERE opt_out = 1)`,
    )
    .run();

  const pollLog = await db.prepare('DELETE FROM poll_log WHERE at < ?1').bind(pollLogCutoff).run();
  const rollups = await db
    .prepare('DELETE FROM tag_minute WHERE minute < ?1')
    .bind(rollupCutoff)
    .run();

  return {
    observations: observations.meta.changes ?? 0,
    pollLog: pollLog.meta.changes ?? 0,
    rollups: rollups.meta.changes ?? 0,
    optedOut: optedOut.meta.changes ?? 0,
  };
}

export type { Bind };
