import { describe, expect, it } from 'vitest';
import {
  MAX_INSTANCES,
  classifyProbe,
  isMonitored,
  healthAfterPoll,
  isActivityPubSoftware,
  isCollectable,
  nextBackoffSeconds,
  nextFreeBit,
  reclassifyOnFailure,
} from '../src/registry';
import type { InstanceRow } from '../src/types';

const NOW = 1_787_788_800;

function instance(overrides: Partial<InstanceRow> = {}): InstanceRow {
  return {
    host: 'a.example',
    software: 'mastodon',
    version: '4.7.0',
    capability: 'timeline',
    bit: 0,
    opt_out: 0,
    opt_out_reason: null,
    probed_at: NOW - 3600,
    last_ok_at: NOW - 60,
    consecutive_failures: 0,
    backoff_until: null,
    added_at: NOW - 86_400,
    ...overrides,
  };
}

describe('classifyProbe', () => {
  it('is fully usable when timelines answer', () => {
    expect(
      classifyProbe({ timelineOk: true, timelineStatus: 200, tagsOk: true, software: 'mastodon' }),
    ).toBe('timeline');
  });

  it('is tags_only when timelines are refused but tag metadata answers', () => {
    // This is the infosec.exchange case from the probe: 422 on the timeline,
    // 200 with seven days of history on /api/v1/tags/.
    expect(
      classifyProbe({ timelineOk: false, timelineStatus: 422, tagsOk: true, software: 'mastodon' }),
    ).toBe('tags_only');
  });

  it('does not infer capability from a recent version number', () => {
    // The probe found a 4.8 development build refusing what 4.7.0 allowed, so a
    // newer version must never imply a better answer.
    expect(
      classifyProbe({
        timelineOk: false,
        timelineStatus: 422,
        tagsOk: false,
        software: 'mastodon',
      }),
    ).toBe('activitypub');
  });

  it('records a federating server we cannot read as activitypub, not blocked', () => {
    // Pixelfed redirects both endpoints to a login page, but it still federates
    // and its posts reach us through Mastodon timelines.
    expect(
      classifyProbe({ timelineOk: false, timelineStatus: 302, tagsOk: false, software: 'pixelfed' }),
    ).toBe('activitypub');
  });

  it('blocks something that answers but is not part of the network', () => {
    expect(
      classifyProbe({ timelineOk: false, timelineStatus: 404, tagsOk: false, software: 'nginx' }),
    ).toBe('blocked');
  });

  it('leaves a server that never answered as unknown rather than condemning it', () => {
    expect(
      classifyProbe({ timelineOk: false, timelineStatus: 0, tagsOk: false, software: null }),
    ).toBe('unknown');
  });
});

describe('isActivityPubSoftware', () => {
  it('recognises the implementations we might meet', () => {
    for (const name of ['mastodon', 'Pixelfed', ' MISSKEY ', 'lemmy', 'peertube']) {
      expect(isActivityPubSoftware(name)).toBe(true);
    }
  });

  it('does not recognise a plain web server or nothing at all', () => {
    expect(isActivityPubSoftware('nginx')).toBe(false);
    expect(isActivityPubSoftware(null)).toBe(false);
  });
});

describe('reclassifyOnFailure', () => {
  it('treats the auth-required statuses as a settings change', () => {
    for (const status of [401, 403, 422]) expect(reclassifyOnFailure(status)).toBe('tags_only');
  });

  it('does not condemn a server over one missing tag', () => {
    // 404 means that server has never seen the tag, not that it refuses us.
    expect(reclassifyOnFailure(404)).toBeNull();
  });

  it('does not reclassify on transient trouble', () => {
    for (const status of [0, 429, 500, 502, 503]) expect(reclassifyOnFailure(status)).toBeNull();
  });
});

describe('nextBackoffSeconds', () => {
  it('doubles from a minute', () => {
    expect(nextBackoffSeconds(1)).toBe(60);
    expect(nextBackoffSeconds(2)).toBe(120);
    expect(nextBackoffSeconds(3)).toBe(240);
  });

  it('caps at an hour, so a dead server costs one request an hour', () => {
    expect(nextBackoffSeconds(20)).toBe(3600);
  });

  it('is zero when nothing has failed', () => {
    expect(nextBackoffSeconds(0)).toBe(0);
  });
});

describe('healthAfterPoll', () => {
  const base = {
    consecutiveFailures: 0,
    now: NOW,
    rateLimitRemaining: 299,
    rateLimitReset: NOW + 120,
    rateLimitFloor: 30,
  };

  it('clears the failure count on success', () => {
    const health = healthAfterPoll({ ...base, consecutiveFailures: 3, status: 200, ok: true });
    expect(health.consecutiveFailures).toBe(0);
    expect(health.backoffUntil).toBeNull();
    expect(health.lastOkAt).toBe(NOW);
  });

  it('pauses until the reported reset when headroom runs low', () => {
    const health = healthAfterPoll({ ...base, status: 200, ok: true, rateLimitRemaining: 12 });
    expect(health.backoffUntil).toBe(NOW + 120);
    expect(health.consecutiveFailures).toBe(0);
    expect(health.reason).toContain('below floor');
  });

  it('waits exactly as long as a 429 asked, without counting it as an outage', () => {
    // Being throttled is the server correcting our pace, not misbehaving. It
    // must not trigger exponential backoff.
    const health = healthAfterPoll({ ...base, consecutiveFailures: 2, status: 429, ok: false });
    expect(health.backoffUntil).toBe(NOW + 120);
    expect(health.consecutiveFailures).toBe(2);
  });

  it('backs off exponentially on a real failure', () => {
    const health = healthAfterPoll({ ...base, consecutiveFailures: 2, status: 503, ok: false });
    expect(health.consecutiveFailures).toBe(3);
    expect(health.backoffUntil).toBe(NOW + 240);
    expect(health.capability).toBeNull();
  });

  it('drops to tags_only when unauthenticated access is switched off', () => {
    const health = healthAfterPoll({ ...base, status: 422, ok: false });
    expect(health.capability).toBe('tags_only');
  });

  it('falls back to a minute when a 429 carries no reset header', () => {
    const health = healthAfterPoll({ ...base, status: 429, ok: false, rateLimitReset: null });
    expect(health.backoffUntil).toBe(NOW + 60);
  });
});

describe('isCollectable', () => {
  it('accepts a healthy opted-in instance serving timelines', () => {
    expect(isCollectable(instance(), NOW)).toBe(true);
  });

  it('refuses an opted-out server immediately', () => {
    expect(isCollectable(instance({ opt_out: 1 }), NOW)).toBe(false);
  });

  it('refuses anything not serving timelines', () => {
    for (const capability of ['tags_only', 'activitypub', 'blocked', 'unknown'] as const) {
      expect(isCollectable(instance({ capability }), NOW)).toBe(false);
    }
  });

  it('respects an active backoff and releases it once it expires', () => {
    expect(isCollectable(instance({ backoff_until: NOW + 60 }), NOW)).toBe(false);
    expect(isCollectable(instance({ backoff_until: NOW - 1 }), NOW)).toBe(true);
  });

  it('refuses an instance with no mask bit, since its coverage could not be recorded', () => {
    expect(isCollectable(instance({ bit: null }), NOW)).toBe(false);
  });
});

describe('nextFreeBit', () => {
  it('takes the lowest free position, keeping the mask dense', () => {
    expect(nextFreeBit([0, 1, 3])).toBe(2);
  });

  it('starts at zero', () => {
    expect(nextFreeBit([])).toBe(0);
  });

  it('is null once full', () => {
    expect(nextFreeBit(Array.from({ length: MAX_INSTANCES }, (_, i) => i))).toBeNull();
  });

  it('stays inside what a mask can survive being read back as a number', () => {
    expect(MAX_INSTANCES).toBeLessThanOrEqual(52);
    expect(2 ** MAX_INSTANCES).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('isMonitored', () => {
  it('counts an opted-in timeline server that is merely paused', () => {
    // The distinction that keeps coverage coherent. A host paused by backoff is
    // still monitored, so a count of instances reporting over a window can
    // never exceed the monitored total.
    const paused = instance({ backoff_until: NOW + 300 });
    expect(isCollectable(paused, NOW)).toBe(false);
    expect(isMonitored(paused)).toBe(true);
  });

  it('excludes an opted-out server', () => {
    expect(isMonitored(instance({ opt_out: 1 }))).toBe(false);
  });

  it('excludes a server that does not serve timelines', () => {
    // tags_only is not degraded, it is differently capable, and it contributes
    // no observations, so it is not part of the coverage denominator.
    expect(isMonitored(instance({ capability: 'tags_only' }))).toBe(false);
  });

  it('excludes a server with no mask bit, whose coverage could not be recorded', () => {
    expect(isMonitored(instance({ bit: null }))).toBe(false);
  });
});
