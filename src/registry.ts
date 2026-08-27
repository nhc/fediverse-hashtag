/**
 * What each server is, what it will let us read, and whether to ask it now.
 *
 * The rule this module exists to enforce is that capability is probed and never
 * inferred. The probe on 27 August 2026 found a server running a 4.8
 * development build refusing unauthenticated timeline requests while 4.7.0
 * servers beside it allowed them, so software version predicts nothing.
 *
 * Pure functions only. Storage lives in db.ts.
 */

import type { Capability, InstanceRow } from './types';

/**
 * The hard ceiling on monitored instances, set by the seen_mask round trip
 * rather than by the mask column.
 *
 * SQLite would hold 63 bits happily, and the bitwise OR that merges a mask
 * happens in SQL. The limit is JavaScript: D1 hands integers back as numbers,
 * which are only exact to 2^53, and a mask read back inexactly would corrupt
 * every coverage figure derived from it. Fifty-two bits stays comfortably
 * inside that, and is far beyond the eight instances the MVP monitors.
 */
export const MAX_INSTANCES = 52;

const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_CAP_SECONDS = 3600;

/**
 * Software that speaks ActivityPub but may not speak the Mastodon API. Used
 * only to distinguish a federating server we cannot read yet from one that is
 * simply refusing us, which is a difference worth showing on the coverage page.
 */
const ACTIVITYPUB_SOFTWARE = new Set([
  'mastodon',
  'hometown',
  'glitchsoc',
  'pleroma',
  'akkoma',
  'misskey',
  'sharkey',
  'firefish',
  'iceshrimp',
  'gotosocial',
  'pixelfed',
  'peertube',
  'lemmy',
  'mbin',
  'kbin',
  'friendica',
  'hubzilla',
  'bookwyrm',
  'writefreely',
  'funkwhale',
  'castopod',
  'wordpress',
]);

export function isActivityPubSoftware(software: string | null): boolean {
  if (software === null) return false;
  return ACTIVITYPUB_SOFTWARE.has(software.trim().toLowerCase());
}

export interface ProbeSignals {
  /** Whether the hashtag timeline returned a usable array of statuses. */
  timelineOk: boolean;
  /** HTTP status from the timeline attempt. 0 means the request never landed. */
  timelineStatus: number;
  /** Whether /api/v1/tags/:id returned usable metadata. */
  tagsOk: boolean;
  software: string | null;
}

/**
 * Classify a server from what it actually did.
 *
 * A server that serves timelines is fully usable. One that refuses timelines
 * but serves tag metadata is still worth keeping, because its daily counters
 * are a second opinion on volume and the only signal available from servers the
 * collector cannot otherwise read. A server that never answered at all is left
 * unknown rather than condemned on one bad minute.
 */
export function classifyProbe(signals: ProbeSignals): Capability {
  if (signals.timelineOk) return 'timeline';
  if (signals.tagsOk) return 'tags_only';
  if (signals.timelineStatus === 0) return 'unknown';
  if (isActivityPubSoftware(signals.software)) return 'activitypub';
  return 'blocked';
}

/**
 * Whether a failed poll means the server has been reconfigured rather than
 * having a bad moment.
 *
 * 401, 403 and 422 are how Mastodon says unauthenticated API access is switched
 * off. That is a settings change, so retrying timelines is pointless and the
 * instance drops to tags_only until the next full probe. Everything else,
 * including 404 for a tag that server has never seen, is transient or specific
 * to the request and must not reclassify the whole server.
 */
export function reclassifyOnFailure(status: number): Capability | null {
  return status === 401 || status === 403 || status === 422 ? 'tags_only' : null;
}

/**
 * Exponential backoff, capped at an hour. A server that is struggling is never
 * hammered, and a server that is down costs one request an hour rather than one
 * a minute.
 */
export function nextBackoffSeconds(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  const seconds = BACKOFF_BASE_SECONDS * 2 ** (consecutiveFailures - 1);
  return Math.min(BACKOFF_CAP_SECONDS, seconds);
}

export interface HealthInput {
  /** Current consecutive failure count, before this poll is accounted for. */
  consecutiveFailures: number;
  now: number;
  status: number;
  ok: boolean;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
  /** Pause the host when reported headroom falls below this. */
  rateLimitFloor: number;
}

export interface HealthUpdate {
  consecutiveFailures: number;
  backoffUntil: number | null;
  lastOkAt: number | null;
  capability: Capability | null;
  reason: string | null;
}

/**
 * Turn one poll outcome into the instance's next health state.
 *
 * Rate limiting is handled before failure counting, because being throttled is
 * not the server misbehaving. It is the server telling us our own pace is wrong,
 * and the right response is to wait exactly as long as it asked rather than to
 * treat it as an outage and back off exponentially.
 */
export function healthAfterPoll(input: HealthInput): HealthUpdate {
  const { now, status, ok } = input;

  if (status === 429) {
    return {
      consecutiveFailures: input.consecutiveFailures,
      backoffUntil: input.rateLimitReset ?? now + BACKOFF_BASE_SECONDS,
      lastOkAt: null,
      capability: null,
      reason: 'rate limited',
    };
  }

  if (ok) {
    // Respect the reported headroom before it runs out, rather than waiting to
    // be refused. The floor exists because the limit is per IP and this index
    // may be sharing that IP with traffic it cannot see.
    const remaining = input.rateLimitRemaining;
    const lowHeadroom = remaining !== null && remaining < input.rateLimitFloor;
    return {
      consecutiveFailures: 0,
      backoffUntil: lowHeadroom ? (input.rateLimitReset ?? now + BACKOFF_BASE_SECONDS) : null,
      lastOkAt: now,
      capability: null,
      reason: lowHeadroom ? `headroom ${remaining} below floor ${input.rateLimitFloor}` : null,
    };
  }

  const failures = input.consecutiveFailures + 1;
  const capability = reclassifyOnFailure(status);
  return {
    consecutiveFailures: failures,
    backoffUntil: now + nextBackoffSeconds(failures),
    lastOkAt: null,
    capability,
    reason: capability !== null ? `http ${status}, unauthenticated access refused` : `http ${status}`,
  };
}

/**
 * Whether this instance is part of the monitored set.
 *
 * Distinct from isCollectable, and the distinction matters for every coverage
 * figure. Monitored means the index intends to poll this server: it is opted in,
 * it serves timelines, and it has a mask bit. Collectable means it can be polled
 * *this tick*, which a temporary backoff can prevent.
 *
 * Coverage compares a count of instances reporting over a window against the
 * monitored total. Using the collectable set as the denominator mixes a snapshot
 * with a window, and a host that answered earlier and is paused now makes
 * reporting exceed monitored, which is incoherent on its face.
 */
export function isMonitored(instance: InstanceRow): boolean {
  return instance.opt_out === 0 && instance.capability === 'timeline' && instance.bit !== null;
}

/** Whether this instance should be polled for hashtag timelines right now. */
export function isCollectable(instance: InstanceRow, now: number): boolean {
  if (instance.opt_out !== 0) return false;
  if (instance.capability !== 'timeline') return false;
  if (instance.bit === null) return false;
  if (instance.backoff_until !== null && instance.backoff_until > now) return false;
  return true;
}

/**
 * The lowest unused mask position, or null when full. Lowest rather than next
 * keeps the mask dense as instances come and go, so a popcount stays meaningful.
 */
export function nextFreeBit(taken: Iterable<number>): number | null {
  const used = new Set(taken);
  for (let bit = 0; bit < MAX_INSTANCES; bit += 1) if (!used.has(bit)) return bit;
  return null;
}
