import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRACE_SECONDS,
  postsPerAuthor,
  rankTags,
  selectPromotions,
  selectRetirements,
  type Candidate,
  type TrackedTag,
} from '../src/discovery';

const NOW = 1_787_788_800;
const DAY = 86_400;

function candidate(name: string, distinctAuthors: number, firstSeen = NOW - 3600): Candidate {
  return { name, distinctAuthors, firstSeen };
}

function tracked(overrides: Partial<TrackedTag> = {}): TrackedTag {
  return {
    id: 1,
    name: 'cats',
    postsLast24h: 40,
    lastQueryAt: NOW - 60,
    firstSeenAt: NOW - 30 * DAY,
    ...overrides,
  };
}

describe('selectPromotions', () => {
  const limits = { now: NOW, trackedCount: 10, maxTracked: 20 };

  it('promotes a candidate with enough distinct authors', () => {
    expect(selectPromotions([candidate('mastocats', 9)], limits)).toEqual(['mastocats']);
  });

  it('refuses one person posting repeatedly, however much they post', () => {
    // The whole point of counting authors rather than uses. This candidate could
    // have hundreds of uses behind it and still should not earn a slot.
    expect(selectPromotions([candidate('myproject', 2)], limits)).toEqual([]);
  });

  it('ranks by distinct authors, not by name or arrival', () => {
    const promoted = selectPromotions(
      [candidate('quiet', 6), candidate('busy', 30), candidate('middling', 12)],
      { ...limits, maxTracked: 12 },
    );
    expect(promoted).toEqual(['busy', 'middling']);
  });

  it('never exceeds the free slots, because slots are the request budget', () => {
    const candidates = Array.from({ length: 50 }, (_, i) => candidate(`tag${i}`, 20 + i));
    const promoted = selectPromotions(candidates, { now: NOW, trackedCount: 18, maxTracked: 20 });
    expect(promoted).toHaveLength(2);
  });

  it('promotes nothing when the tracked set is already full', () => {
    expect(
      selectPromotions([candidate('mastocats', 100)], { now: NOW, trackedCount: 20, maxTracked: 20 }),
    ).toEqual([]);
  });

  it('promotes nothing when over the ceiling, rather than a negative slot count', () => {
    expect(
      selectPromotions([candidate('mastocats', 100)], { now: NOW, trackedCount: 25, maxTracked: 20 }),
    ).toEqual([]);
  });

  it('honours a blocklist whatever the numbers say', () => {
    const promoted = selectPromotions([candidate('spam', 500), candidate('cats', 10)], {
      ...limits,
      blocked: new Set(['spam']),
    });
    expect(promoted).toEqual(['cats']);
  });

  it('breaks ties by name, so a run is reproducible', () => {
    const promoted = selectPromotions([candidate('beta', 7), candidate('alpha', 7)], {
      ...limits,
      maxTracked: 11,
    });
    expect(promoted).toEqual(['alpha']);
  });

  it('respects a raised author threshold', () => {
    expect(selectPromotions([candidate('mastocats', 6)], { ...limits, minAuthors: 20 })).toEqual([]);
  });

  it('copes with an empty pool', () => {
    expect(selectPromotions([], limits)).toEqual([]);
  });
});

describe('selectRetirements', () => {
  const limits = { now: NOW };

  it('keeps a busy tag', () => {
    expect(selectRetirements([tracked()], limits)).toEqual([]);
  });

  it('retires a tag with no posts and nobody asking', () => {
    expect(
      selectRetirements([tracked({ postsLast24h: 0, lastQueryAt: NOW - 30 * DAY })], limits),
    ).toEqual([1]);
  });

  it('keeps a quiet tag somebody is still watching', () => {
    // Human interest alone justifies a slot. Somebody watching a hashtag that
    // rarely moves is a good reason to keep watching it.
    expect(
      selectRetirements([tracked({ postsLast24h: 0, lastQueryAt: NOW - 60 })], limits),
    ).toEqual([]);
  });

  it('keeps a tag that is producing posts even if nobody has asked', () => {
    expect(selectRetirements([tracked({ postsLast24h: 5, lastQueryAt: null })], limits)).toEqual([]);
  });

  it('leaves a newly tracked tag alone before it has been polled', () => {
    // Without the grace period a tag promoted seconds ago looks quiet, because
    // no tick has collected for it yet, and would be retired immediately.
    const fresh = tracked({ postsLast24h: 0, lastQueryAt: null, firstSeenAt: NOW - 60 });
    expect(selectRetirements([fresh], limits)).toEqual([]);

    const older = tracked({
      postsLast24h: 0,
      lastQueryAt: null,
      firstSeenAt: NOW - DEFAULT_GRACE_SECONDS - 1,
    });
    expect(selectRetirements([older], limits)).toEqual([1]);
  });

  it('retires a never-queried tag once it is quiet and out of grace', () => {
    expect(
      selectRetirements(
        [tracked({ postsLast24h: 0, lastQueryAt: null, firstSeenAt: NOW - 30 * DAY })],
        limits,
      ),
    ).toEqual([1]);
  });
});

describe('rankTags', () => {
  const tags = [
    { name: 'shouty', postsObserved: 200, authorsObserved: 3 },
    { name: 'community', postsObserved: 60, authorsObserved: 45 },
    { name: 'quiet', postsObserved: 8, authorsObserved: 7 },
  ];

  it('puts a conversation above one person posting a lot', () => {
    // 'shouty' has 200 posts from 3 accounts and lands last, below 'quiet' with
    // 8 posts from 7 accounts. That inversion against the raw totals is the
    // whole point of ranking on authors.
    expect(rankTags(tags).map((tag) => tag.name)).toEqual(['community', 'quiet', 'shouty']);
  });

  it('can rank by raw posts when asked', () => {
    expect(rankTags(tags, 'posts').map((tag) => tag.name)).toEqual(['shouty', 'community', 'quiet']);
  });

  it('can rank alphabetically', () => {
    expect(rankTags(tags, 'name').map((tag) => tag.name)).toEqual(['community', 'quiet', 'shouty']);
  });

  it('does not mutate its input', () => {
    const original = [...tags];
    rankTags(tags);
    expect(tags).toEqual(original);
  });
});

describe('postsPerAuthor', () => {
  it('exposes crowding, so a busy-looking tag can be read for what it is', () => {
    expect(postsPerAuthor(200, 3)).toBe(66.7);
    expect(postsPerAuthor(60, 45)).toBe(1.3);
  });

  it('is null with no authors, because that is not a ratio', () => {
    expect(postsPerAuthor(0, 0)).toBeNull();
    expect(postsPerAuthor(5, 0)).toBeNull();
  });
});
