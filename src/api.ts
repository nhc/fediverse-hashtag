/**
 * The public API.
 *
 * One rule governs every response in this file: a count never travels without
 * the evidence for it. Field names say what they mean, so there is no `posts`
 * anywhere, only `posts_observed`, and every metrics payload carries the
 * instances that contributed, how many were healthy, and when the last
 * successful update happened.
 *
 * The other rule is that a figure which cannot be produced honestly is null
 * rather than zero, and clients are told to render it as unavailable.
 */

import {
  coverageQuality,
  effectivePollInterval,
  isCoverageComparable,
  minuteBucket,
  trend,
  weightedMedianPopcount,
} from './aggregate';
import {
  countTrackedTags,
  discoveryStats,
  distinctOriginCount,
  findTag,
  loadCandidates,
  tagOverview,
  healthSummary,
  instancesReporting,
  loadInstances,
  loadTagHistory,
  maskDistribution,
  originBreakdown,
  registerTagQuery,
  representativePosts,
  timeseries,
  windowCounts,
  candidateStats,
} from './db';
import {
  DEFAULT_MAX_AUTHORS_PER_SERVER,
  DEFAULT_MIN_AUTHORS,
  DEFAULT_MIN_ORIGIN_SERVERS,
  looksLikeTagSpam,
  MAX_TRACKED_TAGS,
  postsPerAuthor,
  rankTags,
  TAG_SPAM_ADVISORY,
  type DiscoveryOrder,
} from './discovery';
import { askServersAboutTag, ensureTagHistory } from './history';
import { casefoldTag } from './normalise';
import {
  evaluateCandidates,
  MAX_CANDIDATES,
  normaliseCandidates,
  summariseServerReports,
  unseenReading,
} from './suggest';
import { isCollectable, isMonitored } from './registry';
import { TIER_INTERVAL_SECONDS, type Env } from './types';

/** The claim the whole service has to keep true. */
export const STATEMENT =
  'Public hashtag activity observed by this index across participating and monitored servers.';

export const WINDOWS = [
  { key: '5m', seconds: 300 },
  { key: '1h', seconds: 3600 },
  { key: '24h', seconds: 86_400 },
] as const;

const MAX_TAG_LENGTH = 100;

export function json(body: unknown, status = 200, cacheSeconds = 15): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${cacheSeconds}`,
      'access-control-allow-origin': '*',
      'x-index-statement': STATEMENT,
    },
  });
}

/** Tags are casefolded and bounded. A hash prefix is accepted and stripped. */
export function normaliseTagInput(raw: string): string | null {
  const trimmed = decodeURIComponent(raw).trim().replace(/^#/, '');
  if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) return null;
  if (!/^[\p{L}\p{N}_]+$/u.test(trimmed)) return null;
  return casefoldTag(trimmed);
}

interface WindowPayload {
  posts_observed: number;
  authors_observed: number;
  boosts_observed: number;
  trend: number | null;
  coverage_comparable: boolean;
  instances_reporting: number;
}

async function windowPayload(
  env: Env,
  tagId: number,
  now: number,
  seconds: number,
  instancesMonitored: number,
): Promise<WindowPayload> {
  const [current, previous, currentReporting, previousReporting] = await Promise.all([
    windowCounts(env.DB, tagId, now - seconds, now),
    windowCounts(env.DB, tagId, now - seconds * 2, now - seconds),
    instancesReporting(env.DB, now - seconds, now),
    instancesReporting(env.DB, now - seconds * 2, now - seconds),
  ]);

  const comparable = isCoverageComparable({
    instancesMonitored,
    currentReporting,
    previousReporting,
  });

  return {
    posts_observed: current.postsObserved,
    authors_observed: current.authorsObserved,
    boosts_observed: current.boostsObserved,
    trend: trend(current.postsObserved, previous.postsObserved, comparable),
    coverage_comparable: comparable,
    instances_reporting: currentReporting,
  };
}

/**
 * Build the tag payload once, so the JSON API and the web page cannot drift
 * apart. Anything the page shows is something the API already publishes.
 */
export async function buildTagData(
  env: Env,
  rawTag: string,
  now: number,
): Promise<{ error: string; status: number } | Record<string, unknown>> {
  const name = normaliseTagInput(rawTag);
  if (name === null) return { error: 'not a usable hashtag', status: 400 };

  // A search is a signal, not just a read. It registers an unknown tag and counts
  // towards it earning a faster polling tier.
  //
  // Tracking is only granted if there is capacity. Without that check a search
  // added a polled tag regardless of the ceiling, which meant the cap on running
  // costs could be walked straight past by anybody crawling the public URL.
  const trackedCount = await countTrackedTags(env.DB);
  const tag = await registerTagQuery(
    env.DB,
    name,
    rawTag.replace(/^#/, ''),
    now,
    trackedCount < MAX_TRACKED_TAGS,
  );
  if (tag === null) return { error: 'could not register that hashtag', status: 500 };

  const instances = await loadInstances(env.DB);
  // The monitored set, not the currently-collectable one. See isMonitored.
  const monitored = instances.filter(isMonitored);
  const instancesMonitored = monitored.length;

  const windows: Record<string, WindowPayload> = {};
  for (const window of WINDOWS) {
    windows[window.key] = await windowPayload(env, tag.id, now, window.seconds, instancesMonitored);
  }

  const dayAgo = now - 86_400;
  const [masks, origins, uniqueOrigins, lastOk] = await Promise.all([
    maskDistribution(env.DB, tag.id, dayAgo, now),
    originBreakdown(env.DB, tag.id, dayAgo, now, 20),
    distinctOriginCount(env.DB, tag.id, dayAgo, now),
    lastSuccessfulUpdate(env, instances),
  ]);

  const medianSeen = weightedMedianPopcount(masks);
  const observedCount = windows['24h']?.posts_observed ?? 0;

  // A tag with no windowed data yet still gets a useful answer, from the daily
  // counters servers keep about themselves. Labelled separately, because it is
  // a different source at a different granularity and mixing them would be
  // exactly the sort of quiet dishonesty this index is trying to avoid.
  //
  // Fetched inside the request, which is the cost of answering a cold search
  // immediately rather than after the next collection tick. Two servers, short
  // timeout, cached afterwards, and a failure just leaves the section absent.
  let history: Awaited<ReturnType<typeof loadTagHistory>> = [];
  if (observedCount === 0) {
    await ensureTagHistory(env, tag.id, tag.name, now);
    history = await loadTagHistory(env.DB, tag.id);
  }

  return {
    tag: tag.name,
    display: tag.display ?? tag.name,
    as_of: new Date(now * 1000).toISOString(),
    completeness: 'partial',
    statement: STATEMENT,
    tracking: {
      // Said plainly, because a page that showed windows without saying the tag
      // is unpolled would imply collection had started when it had not.
      tracked: tag.tracked === 1,
      capacity_note:
        tag.tracked === 1
          ? null
          : `This index polls at most ${MAX_TRACKED_TAGS} hashtags at once and is ` +
            'currently at that limit, so this one is not being collected yet. It has ' +
            'been recorded as requested and goes to the front of the queue when a ' +
            'slot frees up. The daily counters below come from the servers themselves ' +
            'and are available regardless.',
      tier: tag.tier,
      poll_interval_seconds: effectivePollInterval(
        TIER_INTERVAL_SECONDS[tag.tier],
        Number.parseInt(env.CRON_PERIOD_SECONDS, 10) || 60,
      ),
      tier_requests_interval_seconds: TIER_INTERVAL_SECONDS[tag.tier],
      first_seen: new Date(tag.first_seen_at * 1000).toISOString(),
      newly_registered: tag.first_seen_at === now,
    },
    windows,
    coverage: {
      instances_monitored: instancesMonitored,
      instances_reporting: windows['24h']?.instances_reporting ?? 0,
      // Monitored servers that cannot be polled right now, which is a health
      // problem. A tags_only server is not degraded, it is differently capable,
      // and it is listed under its capability on the coverage page instead.
      instances_degraded: monitored
        .filter((instance) => !isCollectable(instance, now))
        .map((instance) => instance.host),
      reported_by: monitored.map((instance) => instance.host),
      median_instances_per_post: medianSeen,
      quality: coverageQuality(medianSeen, instancesMonitored),
      unique_origin_servers: uniqueOrigins,
      last_successful_update: lastOk === null ? null : new Date(lastOk * 1000).toISOString(),
    },
    origins: origins.map((origin) => ({
      host: origin.host,
      posts_observed: origin.postsObserved,
    })),
    instance_daily_counters:
      history.length === 0
        ? null
        : {
            note:
              'Daily totals from the servers own hashtag counters. Instance-local, ' +
              'daily granularity, and not comparable with the windows above.',
            days: history.map((entry) => ({
              host: entry.host,
              day: new Date(entry.day * 1000).toISOString().slice(0, 10),
              uses: entry.uses,
              accounts: entry.accounts,
            })),
          },
    methodology: '/coverage',
  };
}

export function isDataError(
  value: { error: string; status: number } | Record<string, unknown>,
): value is { error: string; status: number } {
  return typeof value.error === 'string' && typeof value.status === 'number';
}

export async function tagResponse(env: Env, rawTag: string, now: number): Promise<Response> {
  const data = await buildTagData(env, rawTag, now);
  if (isDataError(data)) return json({ error: data.error }, data.status);
  return json(data);
}

/** How many discovered tags the index will list. */
const DISCOVERY_LIMIT = 60;

export function parseOrder(raw: string | null): DiscoveryOrder {
  return raw === 'posts' || raw === 'name' ? raw : 'authors';
}

/**
 * Every tracked tag, plus what the index has discovered but is not yet watching.
 *
 * This is the discovery surface, and the ordering default is deliberate. Tags
 * are ranked by distinct authors rather than by post count, because a tag used
 * two hundred times by three accounts is one person shouting and a tag used
 * twenty times by twenty accounts is a conversation. Ranking by posts would put
 * the shouting first, so posts ordering is available but not the default.
 *
 * posts_per_author is published alongside every count so a reader can see which
 * they are looking at without taking the ranking on trust.
 */
export async function buildTagsData(
  env: Env,
  now: number,
  order: DiscoveryOrder = 'authors',
): Promise<Record<string, unknown>> {
  const [overview, discovered] = await Promise.all([
    tagOverview(env.DB, now),
    loadCandidates(env.DB, now - 48 * 3600, DEFAULT_MIN_AUTHORS, DISCOVERY_LIMIT),
  ]);

  const ranked = rankTags(
    overview.map((tag) => ({
      name: tag.name,
      display: tag.display ?? tag.name,
      tier: tag.tier,
      postsObserved: tag.posts24h,
      authorsObserved: tag.authors24h,
      posts_observed_1h: tag.posts1h,
      authors_observed_1h: tag.authors1h,
      origin_servers: tag.originServers24h,
      first_seen: new Date(tag.firstSeenAt * 1000).toISOString(),
    })),
    order,
  );

  return {
    as_of: new Date(now * 1000).toISOString(),
    completeness: 'partial',
    statement: STATEMENT,
    order,
    ranking_note:
      'Ranked by distinct authors over 24 hours, not by post count. A tag used ' +
      'many times by few accounts is one person posting, not a conversation. ' +
      'posts_per_author is given so you can tell which you are looking at.',
    tracked: {
      count: ranked.length,
      note: 'Tags the index is polling. Figures cover the last 24 hours unless noted.',
      tags: ranked.map((tag) => ({
        tag: tag.name,
        display: tag.display,
        tier: tag.tier,
        posts_observed: tag.postsObserved,
        authors_observed: tag.authorsObserved,
        posts_per_author: postsPerAuthor(tag.postsObserved, tag.authorsObserved),
        posts_observed_1h: tag.posts_observed_1h,
        authors_observed_1h: tag.authors_observed_1h,
        origin_servers: tag.origin_servers,
        first_seen: tag.first_seen,
        url: `/tag/${encodeURIComponent(tag.name)}`,
      })),
    },
    discovered: {
      count: discovered.length,
      note:
        'Tags seen on collected posts that the index is not yet polling. These have ' +
        'no windowed history yet. Ones meeting both thresholds are promoted ' +
        'automatically when a polling slot frees up.',
      promotion_rule: {
        min_distinct_authors: DEFAULT_MIN_AUTHORS,
        min_distinct_origin_servers: DEFAULT_MIN_ORIGIN_SERVERS,
        max_authors_per_server: DEFAULT_MAX_AUTHORS_PER_SERVER,
        why:
          'Two thresholds because one is not enough. Distinct authors stops a ' +
          'single person posting repeatedly. Distinct origin servers stops a ' +
          'publisher running many accounts on one or two servers, which the author ' +
          'threshold alone counts as a crowd. Measured on this index, every tag ' +
          'that turned out to be an automated feed concentrated its accounts on a ' +
          'few servers, at 7 to 30 authors per server, while every genuine ' +
          'community sat at 2.3 to 3.9. A publisher adds accounts without adding ' +
          'servers; a conversation spreads across servers as it gains people, so ' +
          'the ratio stays flat as the tag grows.',
        ranked_by: 'distinct origin servers, then distinct authors',
        advisory_tag_spam_threshold: TAG_SPAM_ADVISORY,
      },
      tags: discovered.map((candidate) => ({
        tag: candidate.name,
        authors_observed: candidate.distinctAuthors,
        origin_servers: candidate.distinctOriginServers,
        posts_per_author: candidate.postsPerAuthor,
        mean_tags_per_post: candidate.meanTagsPerPost,
        looks_like_tag_spam: looksLikeTagSpam(candidate.meanTagsPerPost),
        authors_per_server:
          candidate.distinctOriginServers > 0
            ? Math.round((candidate.distinctAuthors / candidate.distinctOriginServers) * 10) / 10
            : null,
        would_promote:
          candidate.distinctAuthors >= DEFAULT_MIN_AUTHORS &&
          candidate.distinctOriginServers >= DEFAULT_MIN_ORIGIN_SERVERS &&
          candidate.distinctAuthors / candidate.distinctOriginServers <=
            DEFAULT_MAX_AUTHORS_PER_SERVER,
        first_seen: new Date(candidate.firstSeen * 1000).toISOString(),
        url: `/tag/${encodeURIComponent(candidate.name)}`,
      })),
    },
    methodology: '/coverage',
  };
}

export async function tagsResponse(
  env: Env,
  now: number,
  order: DiscoveryOrder,
): Promise<Response> {
  return json(await buildTagsData(env, now, order), 200, 30);
}

export async function timeseriesResponse(env: Env, rawTag: string, now: number): Promise<Response> {
  const name = normaliseTagInput(rawTag);
  if (name === null) return json({ error: 'not a usable hashtag' }, 400);

  const tag = await findTag(env.DB, name);
  if (tag === null) return json({ error: 'that hashtag is not tracked yet' }, 404);

  const from = minuteBucket(now - 86_400);
  const to = minuteBucket(now) + 1;
  const points = await timeseries(env.DB, tag.id, from, to);

  return json({
    tag: tag.name,
    as_of: new Date(now * 1000).toISOString(),
    completeness: 'partial',
    statement: STATEMENT,
    unit: 'posts_observed per minute',
    points: points.map((point) => ({
      at: new Date(point.minute * 60 * 1000).toISOString(),
      posts_observed: point.posts,
      instances_reporting: point.instancesReporting,
    })),
  });
}

export async function postsResponse(env: Env, rawTag: string, now: number): Promise<Response> {
  const name = normaliseTagInput(rawTag);
  if (name === null) return json({ error: 'not a usable hashtag' }, 400);

  const tag = await findTag(env.DB, name);
  if (tag === null) return json({ error: 'that hashtag is not tracked yet' }, 404);

  const posts = await representativePosts(env.DB, tag.id, now - 86_400, 10);

  return json({
    tag: tag.name,
    as_of: new Date(now * 1000).toISOString(),
    note:
      'Links only. This index stores no post content, so a deleted post becomes a ' +
      'dead link rather than a copy. Posts marked sensitive are excluded.',
    posts: posts.map((post) => ({
      url: post.url,
      created_at: new Date(post.createdAt * 1000).toISOString(),
      origin_host: post.originHost,
    })),
  });
}

export async function instancesResponse(env: Env, now: number): Promise<Response> {
  const summaries = await healthSummary(env.DB, now - 3600);

  return json({
    as_of: new Date(now * 1000).toISOString(),
    note:
      'Capability is probed per server and re-probed weekly. It is never inferred ' +
      'from software version, because version does not predict it.',
    instances: summaries.map((summary) => ({
      host: summary.host,
      capability: summary.capability,
      opted_out: summary.optOut === 1,
      last_successful_poll:
        summary.lastOkAt === null ? null : new Date(summary.lastOkAt * 1000).toISOString(),
      consecutive_failures: summary.consecutiveFailures,
      paused_until:
        summary.backoffUntil === null || summary.backoffUntil <= now
          ? null
          : new Date(summary.backoffUntil * 1000).toISOString(),
      last_hour: {
        polls: summary.polls,
        failures: summary.failures,
        mean_latency_ms: summary.medianLatencyMs,
        lowest_ratelimit_headroom: summary.minRateLimitRemaining,
      },
    })),
  });
}

export async function coverageResponse(env: Env, now: number): Promise<Response> {
  const instances = await loadInstances(env.DB);
  const byCapability = new Map<string, string[]>();
  for (const instance of instances) {
    const key = instance.opt_out === 1 ? 'opted_out' : instance.capability;
    byCapability.set(key, [...(byCapability.get(key) ?? []), instance.host]);
  }

  return json({
    as_of: new Date(now * 1000).toISOString(),
    statement: STATEMENT,
    what_this_is:
      'A count of public posts carrying a hashtag that this index observed, on the ' +
      'servers it watches, during the window shown.',
    what_this_is_not:
      'A count of hashtag use across the Fediverse. No server holds a complete view ' +
      'of the network, so no such count can be produced, and the size of what is ' +
      'missing cannot be estimated reliably.',
    servers_by_capability: Object.fromEntries(byCapability),
    capability_meanings: {
      timeline: 'Public hashtag timelines readable without a token. Fully collected.',
      tags_only:
        'Hashtag timelines refused, daily tag counters readable. Used for corroboration only.',
      activitypub: 'Federates, but exposes no usable Mastodon API. Not collected.',
      blocked: 'Refuses this index, or the index declines to read it. Not collected.',
      unknown: 'Not yet probed.',
    },
    known_limitations: [
      'Coverage is partial by an amount that cannot be measured.',
      'Servers requiring authentication for public timelines are largely invisible, except where their posts reach a monitored server through federation.',
      'Deletions are not visible. Polling provides no deletion signal. No post content is stored and records expire after 25 hours.',
      'Edits are not tracked. A post is counted once, at its original timestamp.',
      'Monitored servers are weighted by their own federation reach, and the index cannot tell when a region of the network is missing entirely.',
      'Non-Mastodon platforms are covered only incidentally, when their posts reach a monitored Mastodon server.',
      'Counts can fall as well as rise, because retention expires and opted-out servers are removed retrospectively.',
    ],
    opt_out: {
      servers:
        'Email the contact address, or serve a robots.txt disallowing the collector token. ' +
        'Polling stops on the next tick and observations are removed at the next sweep.',
      authors:
        'Contact the address below. The handle is hashed and added to a suppression list ' +
        'that holds hashes only, and existing observations matching it are deleted.',
      contact: env.CONTACT,
      collector_user_agent: env.COLLECTOR_USER_AGENT,
    },
    methodology: '/coverage',
  });
}

export async function metaResponse(env: Env, now: number): Promise<Response> {
  const instances = await loadInstances(env.DB);
  const [lastOk, discovery] = await Promise.all([
    lastSuccessfulUpdate(env, instances),
    discoveryStats(env.DB, now),
  ]);

  return json({
    service: 'Fediverse Hashtag Activity Index',
    statement: STATEMENT,
    completeness: 'partial',
    as_of: new Date(now * 1000).toISOString(),
    last_successful_update: lastOk === null ? null : new Date(lastOk * 1000).toISOString(),
    windows: WINDOWS.map((window) => window.key),
    instances_monitored: instances.filter(isMonitored).length,
    discovery: {
      tracked: discovery.trackedCount,
      retired: discovery.retiredCount,
      queued_awaiting_capacity: discovery.queuedCount,
      pool_names: discovery.poolNames,
      pool_rows: discovery.poolRows,
      strongest_candidate_authors: discovery.strongestAuthors,
      ready_to_promote: discovery.readyToPromote,
      note:
        'A pool that stops growing is the thing to watch. Candidate writes are ' +
        'capped per tick, so progress can stall without anything erroring.',
    },
    contact: env.CONTACT,
    endpoints: [
      'GET /api/v1/tags',
      'GET /api/v1/tags/:tag',
      'GET /api/v1/tags/:tag/timeseries',
      'GET /api/v1/tags/:tag/posts',
      'GET /api/v1/instances',
      'GET /api/v1/coverage',
      'GET /api/v1/meta',
    ],
  });
}

async function lastSuccessfulUpdate(
  env: Env,
  instances: Awaited<ReturnType<typeof loadInstances>>,
): Promise<number | null> {
  void env;
  let latest: number | null = null;
  for (const instance of instances) {
    if (instance.last_ok_at === null) continue;
    if (latest === null || instance.last_ok_at > latest) latest = instance.last_ok_at;
  }
  return latest;
}

/**
 * Evaluate hashtags somebody is thinking of using, without registering any of
 * them as a query.
 *
 * Built for browser agents helping a person write a post. The agent reads the
 * draft and proposes candidates; this endpoint says what the index has seen of
 * each. It deliberately does not go through buildTagData, because a lookup is a
 * request to watch a tag and ten candidates would be ten requests, which is how
 * the tracked-set ceiling gets walked past by a helpful robot.
 *
 * GET /api/v1/evaluate?tags=cats,dogs,caturday
 */
export async function evaluateResponse(env: Env, rawTags: string | null, now: number): Promise<Response> {
  const candidates = normaliseCandidates((rawTags ?? '').split(','), casefoldTag);
  if (candidates.length === 0) {
    return json({ error: `give up to ${MAX_CANDIDATES} hashtags as ?tags=a,b,c` }, 400);
  }

  const [overview, instances] = await Promise.all([tagOverview(env.DB, now), loadInstances(env.DB)]);
  const trackedNames = new Set(overview.map((t) => t.name));
  const untracked = candidates.filter((c) => !trackedNames.has(c.tag)).map((c) => c.tag);
  const [discovered, lastOk] = await Promise.all([
    candidateStats(env.DB, untracked, now - 48 * 3600),
    lastSuccessfulUpdate(env, instances),
  ]);

  const monitored = instances.filter(isMonitored);
  const evaluated = evaluateCandidates(
    candidates,
    overview.map((t) => ({
      name: t.name,
      display: t.display,
      postsObserved: t.posts24h,
      authorsObserved: t.authors24h,
      originServers: t.originServers24h,
      posts1h: t.posts1h,
      authors1h: t.authors1h,
    })),
    discovered,
  );

  // For tags the index has never seen, ask the servers themselves. This is the
  // long tail: a niche post's every candidate can be unseen, and "no evidence"
  // is honest but useless. The servers' own daily counters say whether anybody
  // uses the tag at all. Fetched live, cached in the HTTP cache, no row minted.
  const withReports = await Promise.all(
    evaluated.map(async (candidate) => {
      if (candidate.standing !== 'unseen') return candidate;
      const summary = summariseServerReports(await askServersAboutTag(env, candidate.tag, now));
      return {
        ...candidate,
        reading: unseenReading(summary),
        ...(summary === null ? {} : { server_reported: summary }),
      };
    }),
  );

  return json({
    as_of: new Date(now * 1000).toISOString(),
    completeness: 'partial',
    statement: STATEMENT,
    note:
      'Ranked by distinct accounts using each tag, then by how many servers it ' +
      'reaches. This is evidence of who is already in a conversation, not a ' +
      'judgement of fit: the index stores no post content and cannot read yours. ' +
      'An unseen tag may be in wide use on servers this index does not monitor.',
    side_effects: { queries_registered: 0 },
    candidates: withReports,
    provenance: {
      instances_monitored: monitored.length,
      instances_healthy: monitored.filter((instance) => isCollectable(instance, now)).length,
      last_successful_update: lastOk === null ? null : new Date(lastOk * 1000).toISOString(),
      tracked_tags: overview.length,
      discovery_window_hours: 48,
    },
  });
}
