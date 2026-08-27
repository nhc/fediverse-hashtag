/**
 * Talking to Mastodon-compatible servers.
 *
 * Only unauthenticated public endpoints are used. This index holds no tokens
 * and never reaches content a logged-out visitor could not see. Every request
 * identifies the collector and gives a contact address, because a server admin
 * who wants it to stop should be able to find out who to tell.
 *
 * The URL building and header parsing are pure and exported separately, since
 * they are where the mistakes that silently lose posts would live.
 */

import type { MastodonStatus, MastodonTagMetadata } from './types';

/** Mastodon caps a hashtag timeline page at 40 whatever you ask for. */
export const MAX_LIMIT = 40;

/** Bodies larger than this are refused rather than parsed. */
const MAX_BODY_BYTES = 4_000_000;

const DEFAULT_TIMEOUT_MS = 12_000;

export interface RequestOptions {
  userAgent: string;
  timeoutMs?: number;
}

export interface FetchOutcome<T> {
  ok: boolean;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
  data: T | null;
  /** Bytes of body read, so the caller can hold a parse budget. */
  bytes: number;
  latencyMs: number;
  rateLimitRemaining: number | null;
  /** Unix seconds when the rate-limit window resets. */
  rateLimitReset: number | null;
  /** The newest id in the page, ready to become the next cursor. */
  nextCursor: string | null;
  error: string | null;
}

/**
 * Build a hashtag timeline URL.
 *
 * The first tag goes in the path and the rest become any[] parameters, which is
 * how one request covers several tags. The limit of 40 is shared across the
 * batch, so callers must only batch tags of similar volume.
 */
export function buildTagTimelineUrl(
  host: string,
  tags: readonly string[],
  minId: string | null,
  limit = MAX_LIMIT,
): string {
  const [first, ...rest] = tags;
  if (first === undefined) throw new Error('a tag timeline request needs at least one tag');

  const url = new URL(`https://${host}/api/v1/timelines/tag/${encodeURIComponent(first)}`);
  for (const tag of rest) url.searchParams.append('any[]', tag);
  url.searchParams.set('limit', String(Math.min(Math.max(1, limit), MAX_LIMIT)));
  if (minId !== null) url.searchParams.set('min_id', minId);
  return url.toString();
}

/**
 * The min_id from a Link header's rel="prev", which is the newest id in the
 * page and therefore exactly the next cursor. Preferred over deriving one from
 * the statuses, because it is what the server itself nominates.
 */
export function parsePrevCursor(linkHeader: string | null): string | null {
  if (linkHeader === null) return null;
  for (const part of linkHeader.split(',')) {
    if (!/rel\s*=\s*"?prev"?/.test(part)) continue;
    const match = /<([^>]+)>/.exec(part);
    if (match?.[1] === undefined) continue;
    try {
      return new URL(match[1]).searchParams.get('min_id');
    } catch {
      return null;
    }
  }
  return null;
}

/** Mastodon reports the reset as an ISO timestamp, not as seconds remaining. */
export function parseRateLimitReset(value: string | null): number | null {
  if (value === null) return null;
  const millis = Date.parse(value);
  if (Number.isFinite(millis)) return Math.floor(millis / 1000);
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.floor(seconds) : null;
}

function parseIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The newest id present in a page, as a fallback when there is no Link header. */
export function newestId(statuses: readonly MastodonStatus[]): string | null {
  let newest: string | null = null;
  for (const status of statuses) {
    const id = status?.id;
    if (typeof id !== 'string' || !/^\d+$/.test(id)) continue;
    if (newest === null || BigInt(id) > BigInt(newest)) newest = id;
  }
  return newest;
}

async function request<T>(url: string, options: RequestOptions): Promise<FetchOutcome<T>> {
  const started = Date.now();
  const base: FetchOutcome<T> = {
    ok: false,
    status: 0,
    data: null,
    bytes: 0,
    latencyMs: 0,
    rateLimitRemaining: null,
    rateLimitReset: null,
    nextCursor: null,
    error: null,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': options.userAgent, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    return { ...base, latencyMs: Date.now() - started, error: String(cause) };
  }

  const outcome: FetchOutcome<T> = {
    ...base,
    status: response.status,
    latencyMs: Date.now() - started,
    rateLimitRemaining: parseIntOrNull(response.headers.get('x-ratelimit-remaining')),
    rateLimitReset: parseRateLimitReset(response.headers.get('x-ratelimit-reset')),
    nextCursor: parsePrevCursor(response.headers.get('link')),
  };

  // A redirect to a login page is how Pixelfed and some others refuse us. It is
  // an answer, not an error, and the registry classifies on it.
  if (response.status >= 300 && response.status < 400) {
    return { ...outcome, error: `redirect to ${response.headers.get('location') ?? 'unknown'}` };
  }
  if (!response.ok) {
    return { ...outcome, error: `http ${response.status}` };
  }

  const declared = parseIntOrNull(response.headers.get('content-length'));
  if (declared !== null && declared > MAX_BODY_BYTES) {
    return { ...outcome, error: `body too large: ${declared} bytes` };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    return { ...outcome, latencyMs: Date.now() - started, error: String(cause) };
  }

  outcome.bytes = body.length;
  outcome.latencyMs = Date.now() - started;

  if (body.length > MAX_BODY_BYTES) {
    return { ...outcome, error: `body too large: ${body.length} bytes` };
  }

  try {
    return { ...outcome, ok: true, data: JSON.parse(body) as T };
  } catch (cause) {
    return { ...outcome, error: `unparseable json: ${String(cause)}` };
  }
}

export async function fetchTagTimeline(
  host: string,
  tags: readonly string[],
  minId: string | null,
  options: RequestOptions,
): Promise<FetchOutcome<MastodonStatus[]>> {
  const outcome = await request<MastodonStatus[]>(
    buildTagTimelineUrl(host, tags, minId),
    options,
  );

  if (outcome.ok && !Array.isArray(outcome.data)) {
    return { ...outcome, ok: false, data: null, error: 'expected an array of statuses' };
  }
  // Fall back to the page contents when the server sent no Link header.
  if (outcome.ok && outcome.nextCursor === null && outcome.data !== null) {
    return { ...outcome, nextCursor: newestId(outcome.data) };
  }
  return outcome;
}

/**
 * Seven days of daily counts for a tag, with distinct account numbers.
 *
 * Readable on every Mastodon host probed, including one that refuses timelines,
 * so this is both the answer for a cold tag search and the only signal available
 * from servers the collector otherwise cannot read. Daily granularity and
 * instance-local, so it is never mixed with the index's own windows.
 */
export async function fetchTagMetadata(
  host: string,
  tag: string,
  options: RequestOptions,
): Promise<FetchOutcome<MastodonTagMetadata>> {
  return request<MastodonTagMetadata>(
    `https://${host}/api/v1/tags/${encodeURIComponent(tag)}`,
    options,
  );
}

export interface NodeInfoSoftware {
  software: string | null;
  version: string | null;
}

/**
 * Software name and version via nodeinfo, which works across ActivityPub
 * implementations rather than only Mastodon. Used to record what a server is,
 * never to decide what it will allow. Capability is probed. See registry.ts.
 */
export async function fetchNodeInfo(
  host: string,
  options: RequestOptions,
): Promise<NodeInfoSoftware> {
  const discovery = await request<{ links?: { rel?: string; href?: string }[] }>(
    `https://${host}/.well-known/nodeinfo`,
    options,
  );
  const links = discovery.data?.links;
  if (!discovery.ok || !Array.isArray(links)) return { software: null, version: null };

  const preferred =
    links.find((link) => typeof link?.href === 'string' && /2\.[01]$/.test(link.rel ?? '')) ??
    links.find((link) => typeof link?.href === 'string');
  if (preferred?.href === undefined) return { software: null, version: null };

  const document = await request<{ software?: { name?: string; version?: string } }>(
    preferred.href,
    options,
  );
  return {
    software: document.data?.software?.name ?? null,
    version: document.data?.software?.version ?? null,
  };
}
