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

/** The tracked set: tags actually being polled. */
export async function loadTags(db: D1Database): Promise<TagRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM tag WHERE blocked = 0 AND tracked = 1 ORDER BY id')
    .all<TagRow>();
  return results ?? [];
}

export async function findTag(db: D1Database, name: string): Promise<TagRow | null> {
  return await db.prepare('SELECT * FROM tag WHERE name = ?1').bind(name).first<TagRow>();
}

/** How many tags are being polled right now. The ceiling is checked against this. */
export async function countTrackedTags(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM tag WHERE tracked = 1 AND blocked = 0')
    .first<{ n: number | null }>();
  return row?.n ?? 0;
}

/**
 * Register a tag if it is new, and record that somebody asked about it.
 *
 * Human interest is one of the two things that earns a tag a faster polling
 * tier, the other being observed volume, so a search is a signal and not just a
 * read.
 *
 * `allowTracking` is what stops a search bypassing the tracked-set ceiling. The
 * first version of this left `tracked` to its column default of 1, so anybody
 * who searched added a polled tag regardless of capacity, and a crawler on the
 * public URL could have grown the set without limit. A tag registered with
 * tracking refused is still recorded and still counted as interest, so it goes to
 * the front of the queue when a slot frees up.
 *
 * On conflict `tracked` is deliberately left alone: searching must never quietly
 * promote an untracked tag, nor retire a tracked one.
 */
export async function registerTagQuery(
  db: D1Database,
  name: string,
  display: string,
  now: number,
  allowTracking: boolean,
): Promise<TagRow | null> {
  await db
    .prepare(
      `INSERT INTO tag (name, display, tier, first_seen_at, last_query_at, query_count, tracked)
       VALUES (?1, ?2, 'cold', ?3, ?3, 1, ?4)
       ON CONFLICT(name) DO UPDATE
          SET last_query_at = ?3,
              query_count   = query_count + 1,
              display       = COALESCE(tag.display, ?2)`,
    )
    .bind(name, display, now, allowTracking ? 1 : 0)
    .run();
  return await findTag(db, name);
}

/**
 * Tags people have asked for that the index is not polling.
 *
 * These jump the queue at the next discovery pass, because somebody asking is a
 * stronger signal than a tag turning up beside another one.
 */
export async function queriedUntrackedTags(
  db: D1Database,
  since: number,
  limit = 50,
): Promise<{ name: string; lastQueryAt: number; queryCount: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT name, last_query_at AS lastQueryAt, query_count AS queryCount
         FROM tag
        WHERE tracked = 0 AND blocked = 0 AND last_query_at IS NOT NULL AND last_query_at >= ?1
        ORDER BY last_query_at DESC, query_count DESC
        LIMIT ?2`,
    )
    .bind(since, limit)
    .all<{ name: string; lastQueryAt: number; queryCount: number }>();
  return results ?? [];
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

// --- Discovery --------------------------------------------------------------

/**
 * Record co-occurring tags the index is not yet tracking.
 *
 * Keyed on (name, author_hash), so the row count per name is an exact distinct
 * author count. That is the signal worth having: it separates a conversation
 * from one account posting repeatedly, and no amount of use-counting can.
 *
 * The caller caps how many of these are written per tick. Recording every
 * co-occurring tag would be several hundred writes a minute, which is the free
 * tier's entire daily allowance before lunch.
 */
export async function recordCandidates(
  db: D1Database,
  rows: readonly {
    name: string;
    authorHash: Uint8Array;
    originHost: string;
    tagsOnPost: number;
  }[],
  now: number,
): Promise<void> {
  const statements = rows.map((row) =>
    db
      .prepare(
        `INSERT INTO tag_candidate (name, author_hash, first_seen, origin_host, tags_on_post)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(name, author_hash) DO NOTHING`,
      )
      .bind(row.name, blob(row.authorHash), now, row.originHost, row.tagsOnPost),
  );
  await runBatched(db, statements);
}

/**
 * Discovered tags, ranked by how many different people are using them.
 *
 * Already-tracked names are excluded in SQL rather than filtered afterwards, so
 * the LIMIT applies to genuine candidates and a busy tracked tag cannot crowd
 * real discoveries out of the page.
 */
export async function loadCandidates(
  db: D1Database,
  since: number,
  minAuthors: number,
  limit = 50,
): Promise<
  {
    name: string;
    distinctAuthors: number;
    distinctOriginServers: number;
    meanTagsPerPost: number | null;
    firstSeen: number;
  }[]
> {
  // Ordered by server breadth, matching how promotion ranks, so the LIMIT keeps
  // the candidates most likely to be promoted rather than merely the loudest.
  const { results } = await db
    .prepare(
      `SELECT c.name                            AS name,
              COUNT(*)                          AS authors,
              COUNT(DISTINCT c.origin_host)     AS servers,
              AVG(c.tags_on_post)               AS mean_tags,
              MIN(c.first_seen)                 AS first_seen
         FROM tag_candidate c
        WHERE c.first_seen >= ?1
          AND c.name NOT IN (SELECT name FROM tag WHERE tracked = 1 OR blocked = 1)
        GROUP BY c.name
       HAVING COUNT(*) >= ?2
        ORDER BY servers DESC, authors DESC, name ASC
        LIMIT ?3`,
    )
    .bind(since, minAuthors, limit)
    .all<{
      name: string;
      authors: number;
      servers: number;
      mean_tags: number | null;
      first_seen: number;
    }>();

  return (results ?? []).map((row) => ({
    name: row.name,
    distinctAuthors: row.authors,
    distinctOriginServers: row.servers,
    meanTagsPerPost: row.mean_tags === null ? null : Math.round(row.mean_tags * 10) / 10,
    firstSeen: row.first_seen,
  }));
}

/**
 * Tracked tags with their observed server breadth, for re-judging tags admitted
 * before the origin floor existed.
 *
 * Read from observation rather than the candidate pool, because for a tracked tag
 * the observations are the better evidence: they are the posts actually collected
 * rather than sightings alongside something else.
 */
export async function trackedBreadth(
  db: D1Database,
  now: number,
): Promise<
  {
    id: number;
    name: string;
    postsLast24h: number;
    originServersLast24h: number;
    lastQueryAt: number | null;
  }[]
> {
  const { results } = await db
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.last_query_at AS lastQueryAt,
              COUNT(o.uri)                  AS posts,
              COUNT(DISTINCT o.origin_host) AS servers
         FROM tag t
         LEFT JOIN observation o
                ON o.tag_id = t.id AND o.is_boost = 0 AND o.created_at >= ?1
        WHERE t.tracked = 1 AND t.blocked = 0
        GROUP BY t.id`,
    )
    .bind(now - 86_400)
    .all<{ id: number; name: string; lastQueryAt: number | null; posts: number; servers: number }>();

  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    postsLast24h: row.posts,
    originServersLast24h: row.servers,
    lastQueryAt: row.lastQueryAt,
  }));
}

/** Start tracking a discovered tag. Reversible: retirement only clears a flag. */
export async function promoteTag(db: D1Database, name: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tag (name, display, tier, first_seen_at, tracked)
       VALUES (?1, ?1, 'cold', ?2, 1)
       ON CONFLICT(name) DO UPDATE
          SET tracked = 1, retired_at = NULL`,
    )
    .bind(name, now)
    .run();
}

/**
 * Stop polling a tag, keeping its row and history.
 *
 * Retiring rather than deleting means a tag that comes back does not start from
 * nothing, and the decision can be read later rather than only inferred from an
 * absence.
 */
export async function retireTags(
  db: D1Database,
  tagIds: readonly number[],
  now: number,
): Promise<void> {
  const statements = tagIds.map((id) =>
    db.prepare('UPDATE tag SET tracked = 0, retired_at = ?2 WHERE id = ?1').bind(id, now),
  );
  await runBatched(db, statements);
}

export interface TagOverview {
  id: number;
  name: string;
  display: string | null;
  tier: Tier;
  firstSeenAt: number;
  lastQueryAt: number | null;
  posts24h: number;
  authors24h: number;
  posts1h: number;
  authors1h: number;
  originServers24h: number;
}

/**
 * Every tracked tag with its activity, for the discovery page.
 *
 * One query with conditional aggregates rather than one query per tag. The tag
 * count is bounded by the request budget, but the page would still be dozens of
 * round trips otherwise.
 */
export async function tagOverview(db: D1Database, now: number): Promise<TagOverview[]> {
  const dayAgo = now - 86_400;
  const hourAgo = now - 3600;

  const { results } = await db
    .prepare(
      `SELECT t.id            AS id,
              t.name          AS name,
              t.display       AS display,
              t.tier          AS tier,
              t.first_seen_at AS firstSeenAt,
              t.last_query_at AS lastQueryAt,
              COUNT(o.uri)                                                  AS posts24,
              COUNT(DISTINCT o.author_hash)                                 AS authors24,
              COUNT(DISTINCT o.origin_host)                                 AS origins24,
              COUNT(CASE WHEN o.created_at >= ?2 THEN 1 END)                AS posts1h,
              COUNT(DISTINCT CASE WHEN o.created_at >= ?2
                                  THEN o.author_hash END)                   AS authors1h
         FROM tag t
         LEFT JOIN observation o
                ON o.tag_id = t.id AND o.is_boost = 0 AND o.created_at >= ?1
        WHERE t.tracked = 1 AND t.blocked = 0
        GROUP BY t.id
        ORDER BY t.name`,
    )
    .bind(dayAgo, hourAgo)
    .all<{
      id: number;
      name: string;
      display: string | null;
      tier: Tier;
      firstSeenAt: number;
      lastQueryAt: number | null;
      posts24: number;
      authors24: number;
      origins24: number;
      posts1h: number;
      authors1h: number;
    }>();

  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    display: row.display,
    tier: row.tier,
    firstSeenAt: row.firstSeenAt,
    lastQueryAt: row.lastQueryAt,
    posts24h: row.posts24,
    authors24h: row.authors24,
    posts1h: row.posts1h,
    authors1h: row.authors1h,
    originServers24h: row.origins24,
  }));
}

/**
 * Health of the discovery pool.
 *
 * Exposed because a pool that stops growing is the failure mode to watch for.
 * Candidate writes are capped per tick and spent on the tags seen most often,
 * which will often be tags whose author pairs are already stored, so progress
 * can stall without anything erroring. Published on /api/v1/meta so that is
 * visible rather than something only a database query would reveal.
 */
export async function discoveryStats(
  db: D1Database,
  now: number,
): Promise<{
  poolNames: number;
  poolRows: number;
  strongestAuthors: number;
  readyToPromote: number;
  trackedCount: number;
  retiredCount: number;
  queuedCount: number;
}> {
  const pool = await db
    .prepare(
      `SELECT COUNT(DISTINCT name) AS names, COUNT(*) AS rows
         FROM tag_candidate WHERE first_seen >= ?1`,
    )
    .bind(now - 48 * 3600)
    .first<{ names: number | null; rows: number | null }>();

  const strength = await db
    .prepare(
      `SELECT MAX(authors) AS strongest,
              SUM(CASE WHEN authors >= 5 THEN 1 ELSE 0 END) AS ready
         FROM (SELECT COUNT(*) AS authors
                 FROM tag_candidate
                WHERE first_seen >= ?1
                  AND name NOT IN (SELECT name FROM tag WHERE tracked = 1 OR blocked = 1)
                GROUP BY name)`,
    )
    .bind(now - 48 * 3600)
    .first<{ strongest: number | null; ready: number | null }>();

  // tracked = 0 covers two different situations and they must not be conflated:
  // a tag that was polled and gave its slot back, and a tag somebody asked for
  // that never got a slot because the index was full. retired_at tells them apart.
  const tags = await db
    .prepare(
      `SELECT SUM(CASE WHEN tracked = 1 THEN 1 ELSE 0 END) AS tracked,
              SUM(CASE WHEN tracked = 0 AND retired_at IS NOT NULL THEN 1 ELSE 0 END) AS retired,
              SUM(CASE WHEN tracked = 0 AND retired_at IS NULL THEN 1 ELSE 0 END) AS queued
         FROM tag WHERE blocked = 0`,
    )
    .first<{ tracked: number | null; retired: number | null; queued: number | null }>();

  return {
    poolNames: pool?.names ?? 0,
    poolRows: pool?.rows ?? 0,
    strongestAuthors: strength?.strongest ?? 0,
    readyToPromote: strength?.ready ?? 0,
    trackedCount: tags?.tracked ?? 0,
    retiredCount: tags?.retired ?? 0,
    queuedCount: tags?.queued ?? 0,
  };
}

/** Tracked tags with the figures retirement decisions need. */
export async function trackedForRetirement(
  db: D1Database,
  now: number,
): Promise<{ id: number; name: string; postsLast24h: number; lastQueryAt: number | null; firstSeenAt: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.last_query_at AS lastQueryAt,
              t.first_seen_at AS firstSeenAt, COUNT(o.uri) AS posts
         FROM tag t
         LEFT JOIN observation o ON o.tag_id = t.id AND o.created_at >= ?1
        WHERE t.tracked = 1 AND t.blocked = 0
        GROUP BY t.id`,
    )
    .bind(now - 86_400)
    .all<{ id: number; name: string; lastQueryAt: number | null; firstSeenAt: number; posts: number }>();

  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    postsLast24h: row.posts,
    lastQueryAt: row.lastQueryAt,
    firstSeenAt: row.firstSeenAt,
  }));
}

// --- Rollups, logging and retention -----------------------------------------

/**
 * Recompute the per-minute rollups for the buckets a tick actually touched.
 *
 * Recomputed rather than incremented, because a post is observed again whenever
 * a second instance reports it and adding to a running total would count it
 * twice. Reading the count back out makes the rollup idempotent, which matters
 * because the collector expects duplicate delivery rather than preventing it.
 *
 * The caller passes exactly the (tag, minute) pairs that received a post this
 * tick. The first version recomputed a ten-minute lookback for every affected
 * tag on every tick, to catch posts arriving late. That works, but it rewrites
 * eleven buckets a minute per tag whether anything changed or not: about 71,000
 * writes a day at fourteen tags, and roughly 2.4 million at the tracked ceiling
 * of 150, which would have taken the service past its D1 allowance and started
 * costing money.
 *
 * Targeting touched buckets keeps the late-arrival behaviour exactly as it was.
 * A post created five minutes ago still lands in its own minute, and that bucket
 * is still recomputed, because the post arriving is what marks it as touched.
 */
export async function refreshRollups(
  db: D1Database,
  buckets: readonly { tagId: number; minute: number }[],
  instancesReporting: number,
): Promise<void> {
  const statements = buckets.map((bucket) =>
    db
      .prepare(
        `INSERT INTO tag_minute (tag_id, minute, posts, instances_reporting)
         SELECT ?1, ?2, COUNT(*), ?3
           FROM observation
          WHERE tag_id = ?1
            AND created_at >= ?2 * 60
            AND created_at <  (?2 + 1) * 60
            AND is_boost = 0
         ON CONFLICT(tag_id, minute) DO UPDATE
            SET posts               = excluded.posts,
                instances_reporting = MAX(tag_minute.instances_reporting,
                                          excluded.instances_reporting)`,
      )
      .bind(bucket.tagId, bucket.minute, instancesReporting),
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
  candidates: number;
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

  // The discovery pool is kept a little longer than observations, because a tag
  // needs time to accumulate enough different authors to be worth promoting.
  const candidates = await db
    .prepare('DELETE FROM tag_candidate WHERE first_seen < ?1')
    .bind(now - 48 * 3600)
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
    candidates: candidates.meta.changes ?? 0,
  };
}

export type { Bind };
