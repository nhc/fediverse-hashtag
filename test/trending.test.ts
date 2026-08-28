import { describe, expect, it } from 'vitest';
import { direction, MAX_TRENDING, rankTrending, type TrendingInput } from '../src/trending';

const tag = (over: Partial<TrendingInput> & { name: string }): TrendingInput => ({
  display: null,
  authors1h: 0,
  authorsPrev1h: 0,
  posts1h: 0,
  authors24h: 0,
  originServers24h: 0,
  ...over,
});

describe('direction', () => {
  it('refuses when coverage is not comparable, and says why', () => {
    const d = direction(100, 10, false);
    expect(d.direction).toBe('not_comparable');
    expect(d.change).toBeNull();
    expect(d.reason).toContain('coverage');
  });

  it('will not call a direction on a handful of authors', () => {
    expect(direction(4, 1, true).direction).toBe('insufficient');
    expect(direction(2, 4, true).direction).toBe('insufficient');
  });

  it('calls up, down and flat with a band around zero', () => {
    expect(direction(20, 10, true)).toMatchObject({ direction: 'up', change: 1 });
    expect(direction(10, 20, true)).toMatchObject({ direction: 'down', change: -0.5 });
    expect(direction(21, 20, true).direction).toBe('flat');
  });

  it('is up without a ratio when the previous hour was empty', () => {
    expect(direction(8, 0, true)).toMatchObject({ direction: 'up', change: null });
  });
});

describe('rankTrending', () => {
  it('ranks by authors this hour, drops silent tags, and caps the list', () => {
    const tags = [
      tag({ name: 'quiet' }),
      tag({ name: 'a', authors1h: 5, originServers24h: 2 }),
      tag({ name: 'b', authors1h: 9 }),
      tag({ name: 'c', authors1h: 5, originServers24h: 7 }),
    ];
    expect(rankTrending(tags, true, 10).map((t) => t.tag)).toEqual(['b', 'c', 'a']);
    expect(rankTrending(tags, true, 2)).toHaveLength(2);
    expect(rankTrending(tags, true, 99)).toHaveLength(Math.min(3, MAX_TRENDING));
  });

  it('carries not_comparable onto every entry when coverage shifted', () => {
    const out = rankTrending([tag({ name: 'x', authors1h: 50, authorsPrev1h: 10 })], false);
    expect(out[0]?.trend.direction).toBe('not_comparable');
  });

  it('rounds change to two places', () => {
    const out = rankTrending([tag({ name: 'x', authors1h: 10, authorsPrev1h: 7 })], true);
    expect(out[0]?.trend.change).toBe(0.43);
  });
});
