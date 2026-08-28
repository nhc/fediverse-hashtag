/**
 * The Worker. The cron handler collects, the fetch handler serves.
 *
 * Both live in one script because at this scale a queue and a second service
 * would be complexity without a job. If the collector ever needs to outgrow a
 * minute of wall time, that is the moment to split it, and not before.
 */

import {
  buildTagData,
  buildTagsData,
  coverageResponse,
  instancesResponse,
  isDataError,
  json,
  metaResponse,
  postsResponse,
  parseOrder,
  STATEMENT,
  tagResponse,
  tagsResponse,
  timeseriesResponse,
  evaluateResponse,
  trendingResponse,
} from './api';
import { collectTick, configFromEnv } from './collect';
import {
  countTrackedTags,
  healthSummary,
  loadCandidates,
  loadInstances,
  loadTags,
  postsPerHourByTag,
  promoteTag,
  queriedUntrackedTags,
  representativePosts,
  retireTags,
  setTagTier,
  sweep,
  timeseries,
  trackedBreadth,
  trackedForRetirement,
  hourlyPostsByTag,
  tagOverview,
} from './db';
import {
  DEFAULT_MIN_AUTHORS,
  MAX_TRACKED_TAGS,
  selectExcessRetirements,
  selectNonCommunityRetirements,
  selectPromotionsWithQueried,
  selectRetirements,
} from './discovery';
import { probeOneDueInstance } from './probe';
import { assignTiers } from './scheduler';
import {
  coveragePage,
  explorePage,
  html,
  notFoundPage,
  searchPage,
  statusPage,
  tagPage,
  tagsPage,
  webmcpPage,
  type ExploreView,
  type TagView,
  type TagsView,
} from './ui';
import { minuteBucket } from './aggregate';
import type { Env, Tier } from './types';

/**
 * Hot and warm ceilings.
 *
 * A hot tag costs one request per instance per minute, so with eight instances
 * and a budget of 48 requests a tick, three hot tags is a quarter of everything
 * the collector has. These are the most expensive numbers in the service.
 */
const MAX_HOT_TAGS = 3;
const MAX_WARM_TAGS = 40;



export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const minute = new Date(now * 1000).getUTCMinutes();

    // Collection first, because it is the job. Maintenance afterwards, out of
    // the request budget the collector holds in reserve.
    const report = await collectTick(env, now);
    console.log(JSON.stringify({ event: 'tick', ...report }));

    // Awaited rather than handed to waitUntil, and that is deliberate. A probe
    // writes the capability the next tick reads, so deferring it past the end
    // of the invocation lets tick N+1 load the registry before tick N's result
    // lands, and every tick then re-probes the same host forever. Waiting on
    // the network costs no CPU, so ordering is free here.
    //
    // Each maintenance step is wrapped separately so one failing cannot skip
    // the others. The tick's own data is already written by this point.
    try {
      if (minute % 5 === 0) await retierTags(env, now);
    } catch (cause) {
      console.log(JSON.stringify({ event: 'retier_failed', error: String(cause) }));
    }

    try {
      if (minute % 10 === 0) await runDiscovery(env, now);
    } catch (cause) {
      console.log(JSON.stringify({ event: 'discovery_failed', error: String(cause) }));
    }

    try {
      const probe = await probeOneDueInstance(env, now);
      if (probe !== null) console.log(JSON.stringify({ event: 'probe', ...probe }));
    } catch (cause) {
      console.log(JSON.stringify({ event: 'probe_failed', error: String(cause) }));
    }

    try {
      if (minute === 0) {
        const swept = await sweep(env.DB, now, configFromEnv(env).retentionHours);
        console.log(JSON.stringify({ event: 'sweep', ...swept }));
      }
    } catch (cause) {
      console.log(JSON.stringify({ event: 'sweep_failed', error: String(cause) }));
    }
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const now = Math.floor(Date.now() / 1000);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'this index is read-only' }, 405);
    }

    try {
      // --- JSON API ---
      if (path === '/api/v1/meta') return await metaResponse(env, now);
      if (path === '/api/v1/tags') {
        return await tagsResponse(env, now, parseOrder(url.searchParams.get('order')));
      }
      if (path === '/api/v1/trending') {
        return await trendingResponse(env, url.searchParams.get('limit'), now);
      }
      if (path === '/api/v1/evaluate') {
        return await evaluateResponse(env, url.searchParams.get('tags'), now);
      }
      if (path === '/api/v1/instances') return await instancesResponse(env, now);
      if (path === '/api/v1/coverage') return await coverageResponse(env, now);

      const apiTag = /^\/api\/v1\/tags\/([^/]+)(\/timeseries|\/posts)?$/.exec(path);
      if (apiTag !== null) {
        const [, rawTag, suffix] = apiTag;
        if (rawTag === undefined) return json({ error: 'no hashtag given' }, 400);
        if (suffix === '/timeseries') return await timeseriesResponse(env, rawTag, now);
        if (suffix === '/posts') return await postsResponse(env, rawTag, now);
        return await tagResponse(env, rawTag, now);
      }

      // --- Web pages ---
      if (path === '/') return html(searchPage(STATEMENT));
      if (path === '/tags') return await renderTagsPage(env, now, url);
      if (path === '/explore') return await renderExplorePage(env, now);

      if (path === '/tag') {
        const query = url.searchParams.get('q');
        if (query === null || query.trim().length === 0) return Response.redirect(`${url.origin}/`, 302);
        return Response.redirect(
          `${url.origin}/tag/${encodeURIComponent(query.trim().replace(/^#/, ''))}`,
          302,
        );
      }

      const pageTag = /^\/tag\/([^/]+)$/.exec(path);
      if (pageTag?.[1] !== undefined) return await renderTagPage(env, pageTag[1], now);

      if (path === '/coverage' || path === '/methodology') return await renderCoveragePage(env, now);
      if (path === '/status') return await renderStatusPage(env, now);

      if (path === '/webmcp') return html(webmcpPage(STATEMENT));

      if (path === '/robots.txt') {
        return new Response('User-agent: *\nAllow: /\n', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }

      return html(notFoundPage(STATEMENT), 404);
    } catch (cause) {
      console.log(JSON.stringify({ event: 'request_failed', path, error: String(cause) }));
      return path.startsWith('/api/')
        ? json({ error: 'something went wrong producing that figure' }, 500)
        : html(notFoundPage(STATEMENT), 500);
    }
  },
};

/**
 * Reassign polling tiers.
 *
 * Runs every five minutes rather than every tick, because a tag flipping
 * between tiers minute to minute would keep resetting its own cursor cadence
 * and never settle.
 */
async function retierTags(env: Env, now: number): Promise<void> {
  const [tags, rates] = await Promise.all([loadTags(env.DB), postsPerHourByTag(env.DB, now)]);

  const tiers = assignTiers(
    tags.map((tag) => ({
      id: tag.id,
      postsPerHour: rates.get(tag.id) ?? 0,
      lastQueryAt: tag.last_query_at,
    })),
    { now, maxHot: MAX_HOT_TAGS, maxWarm: MAX_WARM_TAGS },
  );

  let changed = 0;
  for (const tag of tags) {
    const next = tiers.get(tag.id);
    if (next === undefined || next === tag.tier) continue;
    await setTagTier(env.DB, tag.id, next);
    changed += 1;
  }
  if (changed > 0) console.log(JSON.stringify({ event: 'retier', changed }));
}

async function renderTagPage(env: Env, rawTag: string, now: number): Promise<Response> {
  const data = await buildTagData(env, rawTag, now);
  if (isDataError(data)) return html(notFoundPage(STATEMENT), data.status);

  const tagId = await tagIdFor(env, data);
  const series =
    tagId === null
      ? []
      : (await timeseries(env.DB, tagId, minuteBucket(now - 86_400), minuteBucket(now) + 1)).map(
          (point) => ({
            at: new Date(point.minute * 60 * 1000).toISOString(),
            postsObserved: point.posts,
          }),
        );

  // Read from D1 rather than re-parsing this service's own JSON. The round trip
  // was where the snake_case API fields met the camelCase view type, and the
  // cast between them hid the mismatch until the page threw.
  const posts =
    tagId === null
      ? []
      : (await representativePosts(env.DB, tagId, now - 86_400, 10)).map((post) => ({
          url: post.url,
          createdAt: new Date(post.createdAt * 1000).toISOString(),
          originHost: post.originHost,
        }));

  const windows = data['windows'] as Record<
    string,
    { posts_observed: number; authors_observed: number; trend: number | null; coverage_comparable: boolean }
  >;
  const coverage = data['coverage'] as {
    instances_monitored: number;
    instances_reporting: number;
    median_instances_per_post: number | null;
    quality: TagView['quality'];
    unique_origin_servers: number;
    last_successful_update: string | null;
  };
  const tracking = data['tracking'] as {
    tier: Tier;
    poll_interval_seconds: number;
    tracked: boolean;
    capacity_note: string | null;
  };
  const dailyCounters = data['instance_daily_counters'] as
    | { days: TagView['dailyCounters'] }
    | null;

  const view: TagView = {
    tag: String(data['tag']),
    display: String(data['display']),
    asOf: String(data['as_of']),
    tracked: tracking.tracked,
    capacityNote: tracking.capacity_note,
    tier: tracking.tier,
    pollIntervalSeconds: tracking.poll_interval_seconds,
    windows: Object.entries(windows).map(([key, value]) => ({
      key,
      postsObserved: value.posts_observed,
      authorsObserved: value.authors_observed,
      trend: value.trend,
      coverageComparable: value.coverage_comparable,
    })),
    instancesMonitored: coverage.instances_monitored,
    instancesReporting: coverage.instances_reporting,
    medianInstancesPerPost: coverage.median_instances_per_post,
    quality: coverage.quality,
    uniqueOriginServers: coverage.unique_origin_servers,
    lastSuccessfulUpdate: coverage.last_successful_update,
    origins: (data['origins'] as { host: string; posts_observed: number }[]).map((origin) => ({
      host: origin.host,
      postsObserved: origin.posts_observed,
    })),
    posts,
    series,
    dailyCounters: dailyCounters?.days ?? null,
    statement: STATEMENT,
  };

  return html(tagPage(view));
}

async function tagIdFor(env: Env, data: Record<string, unknown>): Promise<number | null> {
  const tags = await loadTags(env.DB);
  return tags.find((tag) => tag.name === data['tag'])?.id ?? null;
}

async function renderCoveragePage(env: Env, now: number): Promise<Response> {
  const response = await coverageResponse(env, now);
  const data = (await response.json()) as {
    servers_by_capability: Record<string, string[]>;
    capability_meanings: Record<string, string>;
    known_limitations: string[];
  };

  return html(
    coveragePage({
      statement: STATEMENT,
      contact: env.CONTACT,
      userAgent: env.COLLECTOR_USER_AGENT,
      serversByCapability: data.servers_by_capability,
      capabilityMeanings: data.capability_meanings,
      limitations: data.known_limitations,
    }),
    200,
    300,
  );
}

async function renderStatusPage(env: Env, now: number): Promise<Response> {
  const [summaries, instances] = await Promise.all([
    healthSummary(env.DB, now - 3600),
    loadInstances(env.DB),
  ]);
  const optedOut = new Set(
    instances.filter((instance) => instance.opt_out === 1).map((instance) => instance.host),
  );

  return html(
    statusPage({
      statement: STATEMENT,
      asOf: new Date(now * 1000).toISOString(),
      instances: summaries.map((summary) => ({
        host: summary.host,
        capability: summary.capability,
        optedOut: optedOut.has(summary.host),
        lastSuccessfulPoll:
          summary.lastOkAt === null ? null : new Date(summary.lastOkAt * 1000).toISOString(),
        consecutiveFailures: summary.consecutiveFailures,
        pausedUntil:
          summary.backoffUntil === null || summary.backoffUntil <= now
            ? null
            : new Date(summary.backoffUntil * 1000).toISOString(),
        polls: summary.polls,
        failures: summary.failures,
        meanLatencyMs: summary.medianLatencyMs,
        lowestHeadroom: summary.minRateLimitRemaining,
      })),
    }),
  );
}

/**
 * Promote discovered tags and retire spent ones.
 *
 * Runs every ten minutes. Promotion is the point of the discovery pool, and
 * retirement is what makes promotion possible: the tracked set is capped by the
 * request budget, so a tag that has gone quiet has to give its slot back before
 * a new one can have it.
 */
async function runDiscovery(env: Env, now: number): Promise<void> {
  const [tracked, breadth] = await Promise.all([
    trackedForRetirement(env.DB, now),
    trackedBreadth(env.DB, now),
  ]);

  // Retire first, so slots freed this round are available to promote into.
  const quiet = selectRetirements(tracked, { now });

  // Then tags that turned out to be publishers rather than communities. The
  // origin floor has to work backwards too: the farms admitted before the rule
  // existed are busy, so the quiet rule would never reach them and they would
  // hold scarce slots while genuine candidates queue behind.
  const narrow = selectNonCommunityRetirements(breadth, { now }).filter(
    (id) => !quiet.includes(id),
  );

  // Then bring the set back to the ceiling if it is over. This is what makes the
  // ceiling an actual limit rather than only a brake on promotion: it can be
  // breached by other paths, and lowering it should take effect rather than just
  // stopping growth.
  const dropped = new Set([...quiet, ...narrow]);
  const remaining = tracked.filter((tag) => !dropped.has(tag.id));
  const excess = selectExcessRetirements(remaining, { now, maxTracked: MAX_TRACKED_TAGS });

  const retiring = [...quiet, ...narrow, ...excess];
  if (retiring.length > 0) {
    await retireTags(env.DB, retiring, now);
    console.log(
      JSON.stringify({
        event: 'retire',
        quiet: quiet.length,
        notCommunity: narrow.length,
        overCeiling: excess.length,
      }),
    );
  }

  // Tags people asked for but could not be tracked at the time jump the queue.
  const [wanted, candidates] = await Promise.all([
    queriedUntrackedTags(env.DB, now - 7 * 24 * 3600, 50),
    loadCandidates(env.DB, now - 48 * 3600, DEFAULT_MIN_AUTHORS, 100),
  ]);

  const promoting = selectPromotionsWithQueried(wanted, candidates, {
    now,
    trackedCount: await countTrackedTags(env.DB),
    maxTracked: MAX_TRACKED_TAGS,
  });

  for (const name of promoting) await promoteTag(env.DB, name, now);
  if (promoting.length > 0) {
    console.log(JSON.stringify({ event: 'promote', tags: promoting }));
  }
}

async function renderExplorePage(env: Env, now: number): Promise<Response> {
  const overview = await tagOverview(env.DB, now);
  const hourly = await hourlyPostsByTag(
    env.DB,
    now,
    overview.map((tag) => tag.id),
  );
  const view: ExploreView = {
    statement: STATEMENT,
    asOf: new Date(now * 1000).toISOString(),
    tags: overview.map((tag) => ({
      id: tag.id,
      name: tag.name,
      display: tag.display ?? tag.name,
      tier: tag.tier,
      posts24h: tag.posts24h,
      authors24h: tag.authors24h,
      originServers: tag.originServers24h,
      hourly: hourly.get(tag.id) ?? new Array<number>(24).fill(0),
    })),
  };
  return html(explorePage(view), 200, 30);
}

async function renderTagsPage(env: Env, now: number, url: URL): Promise<Response> {
  const order = parseOrder(url.searchParams.get('order'));
  const data = await buildTagsData(env, now, order);

  const tracked = data['tracked'] as {
    note: string;
    tags: {
      tag: string;
      display: string;
      tier: string;
      posts_observed: number;
      authors_observed: number;
      posts_per_author: number | null;
      posts_observed_1h: number;
      authors_observed_1h: number;
      origin_servers: number;
    }[];
  };
  const discovered = data['discovered'] as {
    note: string;
    promotion_rule: { min_distinct_authors: number; min_distinct_origin_servers: number; why: string };
    tags: {
      tag: string;
      authors_observed: number;
      origin_servers: number;
      mean_tags_per_post: number | null;
      looks_like_tag_spam: boolean;
      would_promote: boolean;
    }[];
  };

  const view: TagsView = {
    statement: STATEMENT,
    asOf: String(data['as_of']),
    order,
    rankingNote: String(data['ranking_note']),
    trackedNote: tracked.note,
    discoveredNote: discovered.note,
    tracked: tracked.tags.map((tag) => ({
      tag: tag.tag,
      display: tag.display,
      tier: tag.tier,
      postsObserved: tag.posts_observed,
      authorsObserved: tag.authors_observed,
      postsPerAuthor: tag.posts_per_author,
      posts1h: tag.posts_observed_1h,
      authors1h: tag.authors_observed_1h,
      originServers: tag.origin_servers,
    })),
    discovered: discovered.tags.map((tag) => ({
      tag: tag.tag,
      authorsObserved: tag.authors_observed,
      originServers: tag.origin_servers,
      meanTagsPerPost: tag.mean_tags_per_post,
      wouldPromote: tag.would_promote,
      looksLikeTagSpam: tag.looks_like_tag_spam,
    })),
    promotionRule: {
      minAuthors: discovered.promotion_rule.min_distinct_authors,
      minOriginServers: discovered.promotion_rule.min_distinct_origin_servers,
      why: discovered.promotion_rule.why,
    },
  };

  return html(tagsPage(view), 200, 30);
}
