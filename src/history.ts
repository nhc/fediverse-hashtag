/**
 * Daily hashtag counters, read from /api/v1/tags/:id.
 *
 * This exists so that searching a hashtag the index has never tracked returns
 * something useful instead of an empty page. The endpoint answered on every
 * Mastodon host probed on 27 August 2026, including one that refuses hashtag
 * timelines outright, so it reaches servers the collector cannot otherwise read
 * at all.
 *
 * What comes back is a different kind of number to everything else in the
 * service: each server's own count, at daily granularity, covering seven days.
 * It is stored and presented separately and never merged into the index's own
 * windows. Mixing them would be precisely the quiet dishonesty this design is
 * trying to avoid.
 */

import { loadInstances, loadTagHistory, saveTagHistory } from './db';
import { fetchTagMetadata } from './mastodon';
import type { Env } from './types';

/**
 * Servers asked per cold-tag lookup.
 *
 * Kept to two because this runs inside a page request rather than a cron tick.
 * The point is a useful answer quickly, not a complete survey, and the result is
 * cached so the second visitor pays nothing.
 */
const MAX_SOURCES = 2;

/** Counters older than this are refetched rather than reused. */
const FRESH_FOR_SECONDS = 6 * 3600;

/**
 * Fetch and store daily counters for a tag, unless recent ones are already held.
 *
 * Returns true when something was stored. Failures are swallowed: a cold-tag
 * lookup that cannot reach anybody should still render the page.
 */
export async function ensureTagHistory(
  env: Env,
  tagId: number,
  tagName: string,
  now: number,
): Promise<boolean> {
  const existing = await loadTagHistory(env.DB, tagId);
  const freshest = existing.reduce((latest, entry) => Math.max(latest, entry.day), 0);
  if (existing.length > 0 && now - freshest < FRESH_FOR_SECONDS) return false;

  const instances = await loadInstances(env.DB);
  const sources = instances
    .filter((instance) => instance.opt_out === 0)
    // tags_only servers are first-class here. Being unable to read their
    // timelines is exactly why their counters are worth having.
    .filter(
      (instance) => instance.capability === 'timeline' || instance.capability === 'tags_only',
    )
    .filter((instance) => instance.backoff_until === null || instance.backoff_until <= now)
    .sort((a, b) => a.host.localeCompare(b.host))
    .slice(0, MAX_SOURCES);

  if (sources.length === 0) return false;

  const results = await Promise.all(
    sources.map(async (instance) => {
      try {
        const outcome = await fetchTagMetadata(instance.host, tagName, {
          userAgent: env.COLLECTOR_USER_AGENT,
          timeoutMs: 6000,
        });
        if (!outcome.ok || outcome.data === null) return null;
        return { host: instance.host, history: outcome.data.history ?? [] };
      } catch {
        return null;
      }
    }),
  );

  let stored = false;
  for (const result of results) {
    if (result === null || result.history.length === 0) continue;

    const days = result.history
      .map((entry) => ({
        day: Number.parseInt(entry.day, 10),
        uses: Number.parseInt(entry.uses, 10),
        accounts: Number.parseInt(entry.accounts, 10),
      }))
      // The counts arrive as strings, and a server sending something odd should
      // be skipped rather than stored as NaN.
      .filter(
        (entry) =>
          Number.isFinite(entry.day) &&
          Number.isFinite(entry.uses) &&
          Number.isFinite(entry.accounts),
      );

    if (days.length === 0) continue;
    await saveTagHistory(env.DB, tagId, result.host, days, now);
    stored = true;
  }

  return stored;
}

/**
 * Ask servers about a tag without giving it a row in the database.
 *
 * For evaluating hashtags somebody might use. The stored history above is keyed
 * by tag id, and the only way to mint one is to register a query, which is the
 * signal an evaluation must not send. So this path stores nothing in D1 and
 * caches in the Worker's HTTP cache instead, keyed by tag, for six hours. A
 * miss costs two small fetches; a failure returns nothing rather than throwing.
 */
export async function askServersAboutTag(
  env: Env,
  tagName: string,
  now: number,
): Promise<{ host: string; days: { day: number; uses: number; accounts: number }[] }[]> {
  const cacheKey = new Request(
    `https://cache.invalid/tag-history/${encodeURIComponent(tagName)}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  try {
    const hit = await cache.match(cacheKey);
    if (hit !== undefined) return (await hit.json()) as Awaited<ReturnType<typeof askServersAboutTag>>;
  } catch {
    // No cache in this runtime. Fetch every time.
  }

  const instances = await loadInstances(env.DB);
  const sources = instances
    .filter((instance) => instance.opt_out === 0)
    .filter(
      (instance) => instance.capability === 'timeline' || instance.capability === 'tags_only',
    )
    .filter((instance) => instance.backoff_until === null || instance.backoff_until <= now)
    .sort((a, b) => a.host.localeCompare(b.host))
    .slice(0, MAX_SOURCES);

  const reports = await Promise.all(
    sources.map(async (instance) => {
      try {
        const outcome = await fetchTagMetadata(instance.host, tagName, {
          userAgent: env.COLLECTOR_USER_AGENT,
          timeoutMs: 4000,
        });
        if (!outcome.ok || outcome.data === null) return null;
        const days = (outcome.data.history ?? [])
          .map((entry) => ({
            day: Number.parseInt(entry.day, 10),
            uses: Number.parseInt(entry.uses, 10),
            accounts: Number.parseInt(entry.accounts, 10),
          }))
          .filter(
            (entry) =>
              Number.isFinite(entry.day) &&
              Number.isFinite(entry.uses) &&
              Number.isFinite(entry.accounts),
          );
        return { host: instance.host, days };
      } catch {
        return null;
      }
    }),
  );
  const result = reports.filter((r): r is NonNullable<typeof r> => r !== null);

  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json', 'cache-control': `max-age=${FRESH_FOR_SECONDS}` },
      }),
    );
  } catch {
    // Uncacheable here. Fine.
  }
  return result;
}
