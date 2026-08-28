import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRACE_SECONDS,
  DEFAULT_MAX_AUTHORS_PER_SERVER,
  DEFAULT_MIN_ORIGIN_SERVERS,
  looksLikeTagSpam,
  MAX_TRACKED_TAGS,
  selectNonCommunityRetirements,
  selectExcessRetirements,
  selectPromotionsWithQueried,
  postsPerAuthor,
  rankTags,
  selectPromotions,
  selectRetirements,
  type Candidate,
  type TrackedTag,
} from '../src/discovery';

const NOW = 1_787_788_800;
const DAY = 86_400;

/**
 * Server breadth defaults to a comfortably passing value, so tests written about
 * the author floor keep testing the author floor. Breadth has its own tests.
 */
function candidate(
  name: string,
  distinctAuthors: number,
  distinctOriginServers = 20,
  postsPerAuthor: number | null = 2,
  meanTagsPerPost: number | null = 3,
): Candidate {
  return {
    name,
    distinctAuthors,
    distinctOriginServers,
    postsPerAuthor,
    meanTagsPerPost,
    firstSeen: NOW - 3600,
  };
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

describe('selectPromotionsWithQueried', () => {
  const limits = { now: NOW, trackedCount: 10, maxTracked: 12 };

  it('takes a tag somebody asked for ahead of a stronger pool candidate', () => {
    // Somebody is waiting on the answer, and a pool candidate is not.
    const promoted = selectPromotionsWithQueried(
      [{ name: 'asked', lastQueryAt: NOW - 30, queryCount: 1 }],
      [candidate('found', 90)],
      { ...limits, maxTracked: 11 },
    );
    expect(promoted).toEqual(['asked']);
  });

  it('fills remaining slots from the pool once requests are satisfied', () => {
    const promoted = selectPromotionsWithQueried(
      [{ name: 'asked', lastQueryAt: NOW - 30, queryCount: 1 }],
      [candidate('found', 90), candidate('weaker', 8)],
      { now: NOW, trackedCount: 10, maxTracked: 13 },
    );
    expect(promoted).toEqual(['asked', 'found', 'weaker']);
  });

  it('promotes a requested tag even with no distinct-author evidence', () => {
    // A request is its own justification. The author threshold exists to filter
    // co-occurrence noise, and a human typing the tag is not that.
    expect(
      selectPromotionsWithQueried(
        [{ name: 'obscure', lastQueryAt: NOW, queryCount: 1 }],
        [],
        limits,
      ),
    ).toEqual(['obscure']);
  });

  it('never exceeds the free slots', () => {
    const asked = Array.from({ length: 20 }, (_, i) => ({
      name: `t${i}`,
      lastQueryAt: NOW - i,
      queryCount: 1,
    }));
    expect(selectPromotionsWithQueried(asked, [], limits)).toHaveLength(2);
  });

  it('promotes nothing when full', () => {
    expect(
      selectPromotionsWithQueried(
        [{ name: 'asked', lastQueryAt: NOW, queryCount: 1 }],
        [candidate('found', 90)],
        { now: NOW, trackedCount: 50, maxTracked: 50 },
      ),
    ).toEqual([]);
  });

  it('does not promote the same name twice from both sources', () => {
    const promoted = selectPromotionsWithQueried(
      [{ name: 'both', lastQueryAt: NOW, queryCount: 1 }],
      [candidate('both', 90)],
      { now: NOW, trackedCount: 10, maxTracked: 13 },
    );
    expect(promoted).toEqual(['both']);
  });

  it('honours the blocklist on requested tags too', () => {
    expect(
      selectPromotionsWithQueried(
        [{ name: 'spam', lastQueryAt: NOW, queryCount: 99 }],
        [],
        { ...limits, blocked: new Set(['spam']) },
      ),
    ).toEqual([]);
  });

  it('prefers the most recently asked for', () => {
    const promoted = selectPromotionsWithQueried(
      [
        { name: 'older', lastQueryAt: NOW - 600, queryCount: 5 },
        { name: 'newer', lastQueryAt: NOW - 10, queryCount: 1 },
      ],
      [],
      { now: NOW, trackedCount: 10, maxTracked: 11 },
    );
    expect(promoted).toEqual(['newer']);
  });
});

describe('selectExcessRetirements', () => {
  const many = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) =>
      tracked({ id: from + i + 1, name: `t${from + i}`, postsLast24h: i, lastQueryAt: null }),
    );

  it('does nothing when inside the ceiling', () => {
    expect(selectExcessRetirements(many(10), { now: NOW, maxTracked: 50 })).toEqual([]);
  });

  it('drops exactly the overflow', () => {
    // The case that caught this out live: the set reached 51 because a search
    // bypassed the ceiling, and nothing brought it back down.
    const ids = selectExcessRetirements(many(51), { now: NOW, maxTracked: 50 });
    expect(ids).toHaveLength(1);
  });

  it('drops the quietest first', () => {
    const ids = selectExcessRetirements(many(52), { now: NOW, maxTracked: 50 });
    expect(ids).toEqual([1, 2]);
  });

  it('never drops a tag somebody asked about recently', () => {
    const set = [
      tracked({ id: 1, name: 'asked', postsLast24h: 0, lastQueryAt: NOW - 60 }),
      tracked({ id: 2, name: 'quiet', postsLast24h: 1, lastQueryAt: null }),
    ];
    expect(selectExcessRetirements(set, { now: NOW, maxTracked: 1 })).toEqual([2]);
  });

  it('takes effect when the ceiling is lowered, not just when growth happens', () => {
    const ids = selectExcessRetirements(many(50), { now: NOW, maxTracked: 25 });
    expect(ids).toHaveLength(25);
  });

  it('exports a ceiling the search path and promoter share', () => {
    expect(MAX_TRACKED_TAGS).toBe(50);
  });
});

describe('the origin-server floor', () => {
  const limits = { now: NOW, trackedCount: 0, maxTracked: 10 };

  it('refuses a news farm that clears the author floor', () => {
    // #headlines as measured live: 60 distinct authors, but on 2 servers. The
    // author floor passes it, which is exactly the hole this closes.
    expect(selectPromotions([candidate('headlines', 60, 2)], limits)).toEqual([]);
  });

  it('refuses the other farms found live, on their real figures', () => {
    const farms = [
      candidate('featurednews', 14, 2),
      candidate('topstories', 23, 3),
      candidate('republiquefrancaise', 17, 1),
      candidate('actualites', 20, 2),
    ];
    expect(selectPromotions(farms, limits)).toEqual([]);
  });

  it('admits the genuine communities found live, on their real figures', () => {
    const real = [
      candidate('photography', 161, 65),
      candidate('news', 249, 69),
      candidate('music', 116, 49),
    ];
    expect(selectPromotions(real, limits).sort()).toEqual(['music', 'news', 'photography']);
  });

  it('ranks on server breadth rather than author count', () => {
    // Breadth is what the index measures, and with slots scarce the tag alive
    // across more of the network earns the slot.
    const promoted = selectPromotions(
      [candidate('deep', 200, 6), candidate('broad', 40, 50)],
      { ...limits, maxTracked: 1 },
    );
    expect(promoted).toEqual(['broad']);
  });

  it('still applies the author floor, so breadth alone is not enough', () => {
    expect(selectPromotions([candidate('thin', 2, 40)], limits)).toEqual([]);
  });

  it('sits exactly on the boundary as documented', () => {
    // Lowered from 4 to 3 once authors-per-server took over the job of spotting
    // publishers. The floor now only excludes tags confined to one or two
    // servers, and keeping it low is what lets small communities through.
    expect(DEFAULT_MIN_ORIGIN_SERVERS).toBe(3);
    expect(selectPromotions([candidate('edge', 9, 3)], limits)).toEqual(['edge']);
    expect(selectPromotions([candidate('edge', 9, 2)], limits)).toEqual([]);
  });

  it('can have the floor overridden for a single-server tag', () => {
    // Ratio still applies, so the candidate has to be plausible on that too.
    expect(
      selectPromotions([candidate('local', 5, 1)], { ...limits, minOriginServers: 1 }),
    ).toEqual(['local']);
  });
});

describe('selectNonCommunityRetirements', () => {
  const breadth = (o: Partial<Parameters<typeof selectNonCommunityRetirements>[0][number]> = {}) => ({
    id: 1,
    name: 'headlines',
    postsLast24h: 375,
    authorsLast24h: 60,
    originServersLast24h: 2,
    lastQueryAt: null,
    ...o,
  });

  it('retires a busy tag that turns out to be a publisher', () => {
    // The reason this exists. The farms already admitted are busy, so the
    // quiet-tag rule would never touch them and they would hold slots forever.
    expect(selectNonCommunityRetirements([breadth()], { now: NOW })).toEqual([1]);
  });

  it('keeps a broad tag however busy', () => {
    expect(
      selectNonCommunityRetirements(
        [breadth({ originServersLast24h: 65, postsLast24h: 234, authorsLast24h: 161 })],
        { now: NOW },
      ),
    ).toEqual([]);
  });

  it('retires a farm that spread across enough servers to pass the breadth floor', () => {
    // #headlines crept from 2 servers to 4 and cleared the floor, but it was
    // still 67 authors on 4 servers: 16.8 per server.
    expect(
      selectNonCommunityRetirements(
        [breadth({ originServersLast24h: 4, postsLast24h: 1273, authorsLast24h: 67 })],
        { now: NOW },
      ),
    ).toEqual([1]);
  });

  it('keeps the busiest genuine tag, which the posts-per-author rule would have dropped', () => {
    // #news: 384 authors on 99 servers, 3.9 per server. Its posts-per-author had
    // climbed to 13.9, which is why that signal had to go.
    expect(
      selectNonCommunityRetirements(
        [breadth({ name: 'news', originServersLast24h: 99, postsLast24h: 5334, authorsLast24h: 384 })],
        { now: NOW },
      ),
    ).toEqual([]);
  });

  it('will not judge a tag with too few posts to judge on', () => {
    // Narrow breadth on three posts means the tag is new, not that it is a
    // broadcast. Retiring for that would punish quiet tags for being quiet.
    expect(
      selectNonCommunityRetirements([breadth({ postsLast24h: 3 })], { now: NOW }),
    ).toEqual([]);
  });

  it('never retires a tag somebody asked about recently', () => {
    expect(
      selectNonCommunityRetirements([breadth({ lastQueryAt: NOW - 60 })], { now: NOW }),
    ).toEqual([]);
  });

  it('retires one whose request has gone stale', () => {
    expect(
      selectNonCommunityRetirements([breadth({ lastQueryAt: NOW - 30 * DAY })], { now: NOW }),
    ).toEqual([1]);
  });
});

describe('looksLikeTagSpam', () => {
  it('flags a broadcast template but not a person tagging generously', () => {
    expect(looksLikeTagSpam(14)).toBe(true);
    expect(looksLikeTagSpam(4)).toBe(false);
    expect(looksLikeTagSpam(9)).toBe(false);
  });

  it('says nothing when there is nothing to judge', () => {
    expect(looksLikeTagSpam(null)).toBe(false);
  });
});

describe('the authors-per-server ceiling', () => {
  const limits = { now: NOW, trackedCount: 0, maxTracked: 10 };

  it('refuses a farm concentrating accounts on few servers', () => {
    // #headlines at both sampling points: 60 authors on 2 servers, then 67 on 4.
    expect(selectPromotions([candidate('headlines', 60, 2)], limits)).toEqual([]);
    expect(selectPromotions([candidate('headlines', 67, 4)], limits)).toEqual([]);
  });

  it('admits the busiest genuine tag, which the previous rule would have retired', () => {
    // #news at 384 authors on 99 servers: ratio 3.9. The posts-per-author rule
    // put it at 13.9 and would have dropped the best tag in the index.
    expect(selectPromotions([candidate('news', 384, 99)], limits)).toEqual(['news']);
  });

  it('admits a small genuine community a raised breadth floor would have excluded', () => {
    // #buddhism: 7 authors on 3 servers, ratio 2.3.
    expect(selectPromotions([candidate('buddhism', 7, 3)], limits)).toEqual(['buddhism']);
  });

  it('separates every observed tag correctly, in one pass', () => {
    const promoted = selectPromotions(
      [
        candidate('headlines', 67, 4),
        candidate('topstories', 33, 4),
        candidate('featurednews', 14, 2),
        candidate('republiquefrancaise', 17, 1),
        candidate('news', 384, 99),
        candidate('photography', 161, 65),
        candidate('buddhism', 7, 3),
        candidate('unitedkingdom', 40, 17),
      ],
      { ...limits, maxTracked: 20 },
    );
    expect(promoted.sort()).toEqual(['buddhism', 'news', 'photography', 'unitedkingdom']);
  });

  it('sits in the gap between the two clusters', () => {
    expect(DEFAULT_MAX_AUTHORS_PER_SERVER).toBe(5);
    expect(selectPromotions([candidate('edge', 50, 10)], limits)).toEqual(['edge']);
    expect(selectPromotions([candidate('edge', 51, 10)], limits)).toEqual([]);
  });

  it('holds still as a tag grows, which the previous two signals did not', () => {
    // The property that matters. A community adds authors and servers together,
    // so the ratio does not drift with observation time.
    const early = candidate('growing', 20, 6);
    const later = candidate('growing', 200, 60);
    expect(selectPromotions([early], limits)).toEqual(['growing']);
    expect(selectPromotions([later], limits)).toEqual(['growing']);
  });
});
