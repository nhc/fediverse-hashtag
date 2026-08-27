import { describe, expect, it } from 'vitest';
import {
  batchMinId,
  compareSnowflake,
  cursorKey,
  planTick,
  type CursorState,
  type PlanInput,
  type SchedulableTag,
} from '../src/scheduler';
import type { Tier } from '../src/types';

const NOW = 1_787_788_800;

function tag(id: number, tier: Tier, name = `tag${id}`): SchedulableTag {
  return { id, name, tier };
}

function plan(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    now: NOW,
    hosts: ['a.example'],
    tags: [tag(1, 'hot')],
    cursors: new Map(),
    maxRequests: 48,
    maxTagsPerBatch: 4,
    ...overrides,
  };
}

/** Every host and tag polled just now, so nothing is due unless made due. */
function freshCursors(
  hosts: readonly string[],
  tags: readonly SchedulableTag[],
  polledAt: number,
  minId: string | null = '100',
): Map<string, CursorState> {
  const cursors = new Map<string, CursorState>();
  for (const host of hosts) for (const t of tags) cursors.set(cursorKey(host, t.id), { minId, polledAt });
  return cursors;
}

describe('compareSnowflake', () => {
  it('compares beyond the safe integer range', () => {
    expect(compareSnowflake('117168066166883357', '117168066166883358')).toBe(-1);
    expect(compareSnowflake('117168066166883358', '117168066166883357')).toBe(1);
    expect(compareSnowflake('117168066166883357', '117168066166883357')).toBe(0);
  });

  it('does not fall back to string ordering on differing lengths', () => {
    // String comparison would put '9' after '10'. Numerically it is before.
    expect(compareSnowflake('9', '10')).toBe(-1);
  });

  it('sorts a malformed id last, so it loses a min and forces a full fetch', () => {
    expect(compareSnowflake('nonsense', '10')).toBe(1);
    expect(compareSnowflake('10', 'nonsense')).toBe(-1);
  });
});

describe('batchMinId', () => {
  it('picks the oldest cursor, so no tag in the batch is skipped past', () => {
    expect(batchMinId(['500', '100', '900'])).toBe('100');
  });

  it('returns null when any tag has never been polled', () => {
    expect(batchMinId(['500', null, '900'])).toBeNull();
  });

  it('returns null for an empty batch', () => {
    expect(batchMinId([])).toBeNull();
  });
});

describe('planTick', () => {
  it('does not poll a tag before its tier interval has elapsed', () => {
    const tags = [tag(1, 'warm')];
    const jobs = planTick(
      plan({ tags, cursors: freshCursors(['a.example'], tags, NOW - 60) }),
    );
    expect(jobs).toEqual([]);
  });

  it('polls a warm tag once its five minutes are up', () => {
    const tags = [tag(1, 'warm')];
    const jobs = planTick(
      plan({ tags, cursors: freshCursors(['a.example'], tags, NOW - 300) }),
    );
    expect(jobs).toHaveLength(1);
  });

  it('polls a never-seen tag straight away', () => {
    const jobs = planTick(plan({ tags: [tag(1, 'cold')], cursors: new Map() }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.minId).toBeNull();
  });

  it('never batches hot tags, because a busy tag needs the whole limit', () => {
    const tags = [tag(1, 'hot'), tag(2, 'hot'), tag(3, 'hot')];
    const jobs = planTick(plan({ tags }));
    expect(jobs).toHaveLength(3);
    for (const job of jobs) expect(job.tags).toHaveLength(1);
  });

  it('batches warm tags up to the configured size', () => {
    const tags = [tag(1, 'warm'), tag(2, 'warm'), tag(3, 'warm'), tag(4, 'warm'), tag(5, 'warm')];
    const jobs = planTick(plan({ tags, maxTagsPerBatch: 4 }));
    expect(jobs.map((job) => job.tags.length)).toEqual([4, 1]);
  });

  it('does not batch across tiers, since tier is the proxy for volume', () => {
    const tags = [tag(1, 'warm'), tag(2, 'cold')];
    const jobs = planTick(plan({ tags }));
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.tier).toBe('warm');
    expect(jobs[1]!.tier).toBe('cold');
  });

  it('uses the oldest cursor in a batch', () => {
    const tags = [tag(1, 'warm'), tag(2, 'warm')];
    const cursors = new Map<string, CursorState>([
      [cursorKey('a.example', 1), { minId: '900', polledAt: NOW - 400 }],
      [cursorKey('a.example', 2), { minId: '100', polledAt: NOW - 400 }],
    ]);
    const jobs = planTick(plan({ tags, cursors }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.minId).toBe('100');
  });

  it('runs every hot job before any warm one', () => {
    const tags = [tag(1, 'warm'), tag(2, 'warm'), tag(3, 'hot')];
    const jobs = planTick(plan({ hosts: ['a.example', 'b.example'], tags }));
    const firstWarm = jobs.findIndex((job) => job.tier === 'warm');
    const lastHot = jobs.map((job) => job.tier).lastIndexOf('hot');
    expect(lastHot).toBeLessThan(firstWarm);
  });

  it('never exceeds the request budget', () => {
    const tags = Array.from({ length: 40 }, (_, i) => tag(i + 1, 'hot'));
    const jobs = planTick(plan({ hosts: ['a.example', 'b.example', 'c.example'], tags, maxRequests: 10 }));
    expect(jobs).toHaveLength(10);
  });

  it('returns nothing when the budget is zero', () => {
    expect(planTick(plan({ maxRequests: 0 }))).toEqual([]);
  });

  it('shares a tight budget across hosts rather than draining one', () => {
    // Six due hot tags on each of three hosts, but only six requests. Coverage
    // depends on breadth, so each host should get two rather than one host six.
    const tags = Array.from({ length: 6 }, (_, i) => tag(i + 1, 'hot'));
    const hosts = ['a.example', 'b.example', 'c.example'];
    const jobs = planTick(plan({ hosts, tags, maxRequests: 6 }));

    expect(jobs).toHaveLength(6);
    const perHost = new Map<string, number>();
    for (const job of jobs) perHost.set(job.host, (perHost.get(job.host) ?? 0) + 1);
    expect([...perHost.values()]).toEqual([2, 2, 2]);
  });

  it('serves the most overdue tag first within a tier', () => {
    const tags = [tag(1, 'warm'), tag(2, 'warm')];
    const cursors = new Map<string, CursorState>([
      [cursorKey('a.example', 1), { minId: '100', polledAt: NOW - 310 }],
      [cursorKey('a.example', 2), { minId: '100', polledAt: NOW - 900 }],
    ]);
    const jobs = planTick(plan({ tags, cursors, maxTagsPerBatch: 1 }));
    expect(jobs[0]!.tags[0]!.id).toBe(2);
  });

  it('is deterministic, so a tick can be reasoned about and tested', () => {
    const tags = [tag(3, 'warm'), tag(1, 'hot'), tag(2, 'cold')];
    const hosts = ['c.example', 'a.example', 'b.example'];
    const first = planTick(plan({ hosts, tags }));
    const second = planTick(plan({ hosts, tags }));
    expect(first).toEqual(second);
  });

  it('produces no jobs when there are no hosts to ask', () => {
    expect(planTick(plan({ hosts: [] }))).toEqual([]);
  });
});
