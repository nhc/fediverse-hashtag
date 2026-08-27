import { describe, expect, it } from 'vitest';
import { assignTiers, type TierCandidate } from '../src/scheduler';

const NOW = 1_787_788_800;

function candidate(id: number, postsPerHour: number, lastQueryAt: number | null = null): TierCandidate {
  return { id, postsPerHour, lastQueryAt };
}

describe('assignTiers', () => {
  it('gives the hot slots to the busiest tags', () => {
    const tiers = assignTiers(
      [candidate(1, 500), candidate(2, 200), candidate(3, 5)],
      { now: NOW, maxHot: 1, maxWarm: 1 },
    );
    expect(tiers.get(1)).toBe('hot');
    expect(tiers.get(2)).toBe('warm');
    expect(tiers.get(3)).toBe('cold');
  });

  it('puts a tag somebody is watching ahead of a busier one nobody has opened', () => {
    // The point of the ranking. A quiet tag with a reader needs freshness more
    // than a busy tag with none.
    const tiers = assignTiers(
      [candidate(1, 10_000), candidate(2, 3, NOW - 30)],
      { now: NOW, maxHot: 1, maxWarm: 1 },
    );
    expect(tiers.get(2)).toBe('hot');
    expect(tiers.get(1)).toBe('warm');
  });

  it('lets human interest go stale', () => {
    const tiers = assignTiers(
      [candidate(1, 500), candidate(2, 3, NOW - 7200)],
      { now: NOW, maxHot: 1, maxWarm: 1, queryFreshnessSeconds: 900 },
    );
    expect(tiers.get(1)).toBe('hot');
    expect(tiers.get(2)).toBe('warm');
  });

  it('never promotes a tag with no activity and no interest', () => {
    // Ranking decides who gets a slot, not whether one is warranted. An empty
    // index must not spend the whole budget polling dead tags every minute.
    const tiers = assignTiers([candidate(1, 0), candidate(2, 0)], {
      now: NOW,
      maxHot: 4,
      maxWarm: 4,
    });
    expect(tiers.get(1)).toBe('cold');
    expect(tiers.get(2)).toBe('cold');
  });

  it('respects the hot ceiling however many tags qualify', () => {
    const candidates = Array.from({ length: 40 }, (_, i) => candidate(i + 1, 1000));
    const tiers = assignTiers(candidates, { now: NOW, maxHot: 3, maxWarm: 10 });
    const counts = { hot: 0, warm: 0, cold: 0 };
    for (const tier of tiers.values()) counts[tier] += 1;
    expect(counts).toEqual({ hot: 3, warm: 10, cold: 27 });
  });

  it('breaks ties by id, so a tick is reproducible', () => {
    const first = assignTiers([candidate(2, 100), candidate(1, 100)], {
      now: NOW,
      maxHot: 1,
      maxWarm: 0,
    });
    expect(first.get(1)).toBe('hot');
    expect(first.get(2)).toBe('cold');
  });

  it('copes with no candidates and with zero budget', () => {
    expect(assignTiers([], { now: NOW, maxHot: 3, maxWarm: 10 }).size).toBe(0);
    const none = assignTiers([candidate(1, 500)], { now: NOW, maxHot: 0, maxWarm: 0 });
    expect(none.get(1)).toBe('cold');
  });
});
