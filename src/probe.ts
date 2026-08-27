/**
 * Finding out what each server will actually let us read.
 *
 * The whole reason this file exists is that capability cannot be inferred. On
 * 27 August 2026 a server running a 4.8 development build refused
 * unauthenticated timeline requests while 4.7.0 servers beside it allowed them.
 * So every instance is asked, and asked again weekly, because a server can
 * change its mind without telling anybody.
 *
 * One instance is probed per tick. That is slow on purpose: probing is
 * maintenance, and it must never compete with collection.
 *
 * A probe costs up to PROBE_MAX_REQUESTS, and those are on top of whatever the
 * collector spent, so the collection budget is sized to leave room. See the
 * arithmetic on MAX_REQUESTS_PER_TICK in wrangler.jsonc.
 */

import { loadInstances, recordProbe, setOptOut, upsertInstance } from './db';
import { fetchNodeInfo, fetchTagMetadata, fetchTagTimeline } from './mastodon';
import { classifyProbe, nextFreeBit } from './registry';
import { ROBOTS_TOKEN, robotsPermitsCollection } from './robots';
import type { Capability, Env } from './types';

/** How long a probe result is trusted before the server is asked again. */
export const REPROBE_AFTER_SECONDS = 7 * 24 * 3600;

/**
 * Worst-case requests for one probe: robots.txt, nodeinfo discovery, the
 * nodeinfo document, a hashtag timeline and the tag metadata. The collection
 * budget has to leave this much room, or a probe tick breaches the free tier's
 * cap of fifty external subrequests per invocation.
 */
export const PROBE_MAX_REQUESTS = 5;

/**
 * A tag that exists nearly everywhere, used only to ask whether the endpoint
 * answers. Nothing collected during a probe is stored.
 */
const CANARY_TAG = 'cats';

export interface ProbeResult {
  host: string;
  capability: Capability;
  software: string | null;
  version: string | null;
  optedOut: boolean;
  note: string | null;
}

/**
 * Ask a server what it is and what it allows.
 *
 * robots.txt is checked first, because if the answer there is no then the other
 * questions should not be asked at all.
 */
export async function probeHost(host: string, userAgent: string): Promise<ProbeResult> {
  const base: ProbeResult = {
    host,
    capability: 'unknown',
    software: null,
    version: null,
    optedOut: false,
    note: null,
  };

  const robots = await fetchRobots(host, userAgent);
  if (robots !== null && !robotsPermitsCollection(robots, ROBOTS_TOKEN)) {
    return { ...base, capability: 'blocked', optedOut: true, note: 'robots.txt disallows this collector' };
  }

  const { software, version } = await fetchNodeInfo(host, { userAgent });

  const [timeline, tags] = await Promise.all([
    fetchTagTimeline(host, [CANARY_TAG], null, { userAgent }),
    fetchTagMetadata(host, CANARY_TAG, { userAgent }),
  ]);

  const capability = classifyProbe({
    timelineOk: timeline.ok && Array.isArray(timeline.data),
    timelineStatus: timeline.status,
    tagsOk: tags.ok && tags.data !== null,
    software,
  });

  return {
    ...base,
    capability,
    software,
    version,
    note: timeline.ok ? null : (timeline.error ?? `http ${timeline.status}`),
  };
}

async function fetchRobots(host: string, userAgent: string): Promise<string | null> {
  try {
    const response = await fetch(`https://${host}/robots.txt`, {
      headers: { 'User-Agent': userAgent, Accept: 'text/plain' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const body = await response.text();
    // A robots.txt that is really an HTML error page tells us nothing.
    return body.length > 100_000 || /^\s*</.test(body) ? null : body;
  } catch {
    return null;
  }
}

/**
 * Probe the single most overdue instance, if any is due.
 *
 * Returns null when there is nothing to do, which is the normal case: with a
 * weekly re-probe and one probe per tick, a registry of a dozen servers is
 * almost always up to date.
 */
export async function probeOneDueInstance(env: Env, now: number): Promise<ProbeResult | null> {
  const instances = await loadInstances(env.DB);
  const due = instances
    .filter((instance) => instance.opt_out === 0)
    .filter(
      (instance) =>
        instance.probed_at === null || now - instance.probed_at >= REPROBE_AFTER_SECONDS,
    )
    // Least recently probed first, with the host as a tie-break so a registry
    // of never-probed servers is worked through in a fixed order rather than
    // whatever order the rows arrived in.
    .sort((a, b) => (a.probed_at ?? 0) - (b.probed_at ?? 0) || a.host.localeCompare(b.host));

  const target = due[0];
  if (target === undefined) return null;

  const result = await probeHost(target.host, env.COLLECTOR_USER_AGENT);

  if (result.optedOut) {
    await setOptOut(env.DB, target.host, result.note ?? 'opted out');
  }
  await recordProbe(env.DB, target.host, result.software, result.version, result.capability, now);

  return result;
}

/**
 * Add a host to the registry, assigning it a mask bit.
 *
 * The bit is what lets a post record which servers reported it, so an instance
 * without one is never collected from. Bits are handed out lowest-first, which
 * keeps the mask dense as instances come and go.
 */
export async function addInstance(env: Env, host: string, now: number): Promise<boolean> {
  const instances = await loadInstances(env.DB);
  if (instances.some((instance) => instance.host === host)) return false;

  const taken = instances.map((instance) => instance.bit).filter((bit): bit is number => bit !== null);
  const bit = nextFreeBit(taken);
  if (bit === null) return false;

  await upsertInstance(env.DB, host, bit, now);
  return true;
}
