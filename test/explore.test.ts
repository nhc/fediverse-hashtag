import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME,
  SHOUTING_THRESHOLD,
  logScale,
  logTicks,
  rhythmPath,
  scatterPoints,
  stripOrder,
  thresholdY,
  type ExploreTag,
} from '../src/explore';

function tag(over: Partial<ExploreTag> & { name: string }): ExploreTag {
  return {
    id: 1,
    display: over.name,
    tier: 'warm',
    posts24h: 10,
    authors24h: 10,
    originServers: 3,
    hourly: new Array<number>(24).fill(0),
    ...over,
  };
}

describe('scatterPoints', () => {
  it('leaves silent tags off rather than drawing them at the origin', () => {
    const points = scatterPoints([tag({ name: 'a', authors24h: 0, posts24h: 0 }), tag({ name: 'b' })]);
    expect(points.map((p) => p.tag.name)).toEqual(['b']);
  });

  it('puts the conversation to the right and the megaphone above', () => {
    const conversation = tag({ name: 'talk', posts24h: 40, authors24h: 40 });
    const megaphone = tag({ name: 'shout', posts24h: 200, authors24h: 2 });
    const [talk, shout] = scatterPoints([conversation, megaphone]);
    expect(talk!.x).toBeGreaterThan(shout!.x);
    expect(shout!.y).toBeLessThan(talk!.y); // smaller y is higher on screen
    expect(shout!.postsPerAuthor).toBe(100);
  });

  it('keeps every dot inside the frame', () => {
    const tags = [1, 5, 50, 5000].map((n, i) =>
      tag({ name: `t${i}`, authors24h: n, posts24h: n * (i + 1), originServers: i * 10 + 1 }),
    );
    for (const p of scatterPoints(tags)) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(0);
      expect(p.x + p.r).toBeLessThanOrEqual(DEFAULT_FRAME.width);
      expect(p.y - p.r).toBeGreaterThanOrEqual(0);
      expect(p.y + p.r).toBeLessThanOrEqual(DEFAULT_FRAME.height);
    }
  });

  it('sizes dots by server count, more servers larger', () => {
    const [few, many] = scatterPoints([
      tag({ name: 'few', originServers: 1 }),
      tag({ name: 'many', originServers: 9 }),
    ]);
    expect(many!.r).toBeGreaterThan(few!.r);
  });
});

describe('thresholdY', () => {
  it('separates tags above and below the shouting line', () => {
    const below = tag({ name: 'below', posts24h: 20, authors24h: 10 }); // 2 per author
    const above = tag({ name: 'above', posts24h: 100, authors24h: 10 }); // 10 per author
    const line = thresholdY([below, above]);
    const [b, a] = scatterPoints([below, above]);
    expect(line).not.toBeNull();
    expect(b!.y).toBeGreaterThan(line!);
    expect(a!.y).toBeLessThan(line!);
    expect(SHOUTING_THRESHOLD).toBe(5);
  });

  it('is null with nothing to place', () => {
    expect(thresholdY([])).toBeNull();
  });
});

describe('logScale and logTicks', () => {
  it('maps the ends of the domain to the ends of the range', () => {
    expect(logScale(1, 1, 100, 0, 10)).toBe(0);
    expect(logScale(100, 1, 100, 0, 10)).toBe(10);
  });

  it('collapses a degenerate domain to the middle', () => {
    expect(logScale(7, 7, 7, 0, 10)).toBe(5);
  });

  it('produces 1-2-5 ticks up to the maximum', () => {
    expect(logTicks(60)).toEqual([1, 2, 5, 10, 20, 50]);
    expect(logTicks(0)).toEqual([1]);
  });
});

describe('rhythmPath', () => {
  it('normalises to the series peak and spans the width', () => {
    const path = rhythmPath([0, 4, 2], 100, 30);
    expect(path).toBe('0,29 50,1 100,15');
  });

  it('draws a flat floor for a silent day rather than dividing by zero', () => {
    const path = rhythmPath([0, 0, 0], 100, 30);
    expect(path).toBe('0,29 50,29 100,29');
  });
});

describe('stripOrder', () => {
  it('groups by tier then busiest first', () => {
    const order = stripOrder([
      tag({ name: 'c-cold', tier: 'cold', authors24h: 99 }),
      tag({ name: 'a-hot-small', tier: 'hot', authors24h: 1 }),
      tag({ name: 'b-hot-big', tier: 'hot', authors24h: 50 }),
      tag({ name: 'd-warm', tier: 'warm', authors24h: 5 }),
    ]).map((t) => t.name);
    expect(order).toEqual(['b-hot-big', 'a-hot-small', 'd-warm', 'c-cold']);
  });
});
