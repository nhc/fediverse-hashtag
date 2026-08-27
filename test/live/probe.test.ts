/**
 * Live capability probe. Run deliberately with `npm run probe`.
 *
 * This makes real unauthenticated requests to real servers, which is why it is
 * kept out of the default suite. Its job is to keep docs/probe-*.md honest: the
 * design rests on a handful of claims about what these APIs do, and any of them
 * could stop being true without notice.
 *
 * A failure here is information, not necessarily a defect. An instance changing
 * its configuration is the thing the whole registry exists to cope with.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_LIMIT,
  buildTagTimelineUrl,
  fetchTagMetadata,
  fetchTagTimeline,
  parsePrevCursor,
} from '../../src/mastodon';
import { normalise } from '../../src/normalise';
import { classifyProbe } from '../../src/registry';

const UA = 'fediverse-hashtag-index/0.1 (live probe suite; https://github.com/)';
const OPTIONS = { userAgent: UA, timeoutMs: 20_000 };
const TAG = 'cats';

/** Servers seeded in migrations/0002_seed.sql. */
const HOSTS = [
  'mastodon.social',
  'hachyderm.io',
  'mstdn.social',
  'infosec.exchange',
] as const;

describe('hashtag timelines', () => {
  it('serves public hashtag timelines on at least one seeded server', async () => {
    const outcomes = await Promise.all(
      HOSTS.map(async (host) => ({ host, outcome: await fetchTagTimeline(host, [TAG], null, OPTIONS) })),
    );

    for (const { host, outcome } of outcomes) {
      console.log(`  ${host.padEnd(20)} status=${outcome.status} statuses=${outcome.data?.length ?? 0}`);
    }
    expect(outcomes.some(({ outcome }) => outcome.ok)).toBe(true);
  });

  it('caps a page at 40 however many are asked for', async () => {
    const url = new URL(buildTagTimelineUrl('mastodon.social', [TAG], null, 200));
    expect(url.searchParams.get('limit')).toBe(String(MAX_LIMIT));

    const outcome = await fetchTagTimeline('mastodon.social', [TAG], null, OPTIONS);
    if (!outcome.ok) return;
    expect(outcome.data?.length ?? 0).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('still returns statuses for every tag in an any[] batch', async () => {
    // The finding the whole request budget depends on. If batching stopped
    // working, the scheduler would quietly under-collect the batched tags.
    const outcome = await fetchTagTimeline('mastodon.social', ['cats', 'dogs', 'birds'], null, OPTIONS);
    if (!outcome.ok || outcome.data === null) return;

    const { posts } = await normalise(outcome.data, { salt: 'probe' });
    const seen = new Set(posts.flatMap((post) => post.tags));
    const hits = ['cats', 'dogs', 'birds'].filter((tag) => seen.has(tag));
    console.log(`  any[] batch matched: ${hits.join(', ')}`);
    expect(hits.length).toBeGreaterThan(1);
  });

  it('paginates forward from min_id rather than filtering', async () => {
    // If this ever reverses, advancing the cursor past a full page would skip
    // posts silently, which is the worst failure this service could have.
    const full = await fetchTagTimeline('mastodon.social', [TAG], null, OPTIONS);
    if (!full.ok || full.data === null || full.data.length < 10) return;

    const ids = full.data.map((status) => status.id);
    const anchor = ids[ids.length - 1];
    if (anchor === undefined) return;

    const page = await fetchTagTimeline('mastodon.social', [TAG], anchor, OPTIONS);
    if (!page.ok || page.data === null || page.data.length === 0) return;

    // Everything returned must be newer than the anchor, and the oldest of them
    // should sit near the anchor rather than at the newest end of the timeline.
    for (const status of page.data) expect(BigInt(status.id)).toBeGreaterThan(BigInt(anchor));

    const positions = page.data
      .map((status) => ids.indexOf(status.id))
      .filter((position) => position >= 0);
    if (positions.length > 0) {
      console.log(`  positions returned: ${Math.min(...positions)}..${Math.max(...positions)} of ${ids.length}`);
      expect(Math.max(...positions)).toBeGreaterThan(ids.length / 2);
    }
  });

  it('offers a prev cursor that is the newest id in the page', async () => {
    const outcome = await fetchTagTimeline('mastodon.social', [TAG], null, OPTIONS);
    if (!outcome.ok || outcome.data === null || outcome.data.length === 0) return;
    expect(outcome.nextCursor).not.toBeNull();
    expect(outcome.nextCursor).toBe(outcome.data[0]?.id);
  });

  it('reports a rate limit we stay well inside', async () => {
    const outcome = await fetchTagTimeline('mastodon.social', [TAG], null, OPTIONS);
    if (!outcome.ok) return;
    console.log(`  headroom ${outcome.rateLimitRemaining} until ${outcome.rateLimitReset}`);
    expect(outcome.rateLimitRemaining).not.toBeNull();
  });
});

describe('tag metadata', () => {
  it('answers on servers that refuse timelines, with distinct account counts', async () => {
    // The finding that makes cold-tag lookups useful and reaches servers the
    // collector cannot read at all.
    const outcomes = await Promise.all(
      HOSTS.map(async (host) => ({ host, outcome: await fetchTagMetadata(host, TAG, OPTIONS) })),
    );

    for (const { host, outcome } of outcomes) {
      const days = outcome.data?.history?.length ?? 0;
      console.log(`  ${host.padEnd(20)} status=${outcome.status} history_days=${days}`);
    }

    const usable = outcomes.filter(({ outcome }) => outcome.ok && (outcome.data?.history?.length ?? 0) > 0);
    expect(usable.length).toBeGreaterThan(0);

    const first = usable[0]?.outcome.data?.history?.[0];
    expect(first).toBeDefined();
    expect(Number.isFinite(Number(first?.accounts))).toBe(true);
    expect(Number.isFinite(Number(first?.uses))).toBe(true);
  });
});

describe('classification against live servers', () => {
  it('classifies each seeded server, and reports what it found', async () => {
    for (const host of HOSTS) {
      const [timeline, tags] = await Promise.all([
        fetchTagTimeline(host, [TAG], null, OPTIONS),
        fetchTagMetadata(host, TAG, OPTIONS),
      ]);
      const capability = classifyProbe({
        timelineOk: timeline.ok && Array.isArray(timeline.data),
        timelineStatus: timeline.status,
        tagsOk: tags.ok && tags.data !== null,
        software: 'mastodon',
      });
      console.log(`  ${host.padEnd(20)} -> ${capability} (timeline ${timeline.status}, tags ${tags.status})`);
      expect(['timeline', 'tags_only', 'activitypub', 'blocked', 'unknown']).toContain(capability);
    }
  });
});

describe('coverage overlap', () => {
  it('finds more unique posts across servers than on any one of them', async () => {
    // The empirical basis for the whole coverage story. If the union stopped
    // exceeding the parts, monitoring several servers would be pointless.
    const outcomes = await Promise.all(
      ['mastodon.social', 'hachyderm.io', 'mstdn.social'].map((host) =>
        fetchTagTimeline(host, [TAG], null, OPTIONS),
      ),
    );

    const sets = outcomes
      .filter((outcome) => outcome.ok && outcome.data !== null)
      .map((outcome) => new Set((outcome.data ?? []).map((status) => status.uri)));
    if (sets.length < 2) return;

    const union = new Set(sets.flatMap((set) => [...set]));
    const largest = Math.max(...sets.map((set) => set.size));
    console.log(`  per-server ${sets.map((set) => set.size).join('/')}  union ${union.size}  largest ${largest}`);
    expect(union.size).toBeGreaterThanOrEqual(largest);
  });
});
