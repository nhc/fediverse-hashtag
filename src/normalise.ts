/**
 * Turn Mastodon statuses into the handful of fields this index stores.
 *
 * Everything discarded here is discarded on purpose: content, media, display
 * names, avatars, profile data, engagement counts. The output is what counting
 * needs and nothing else. See docs/privacy.md.
 */

import type { MastodonStatus, NormalisedPost } from './types';

export interface NormaliseOptions {
  salt: string;
  /** Hashes of authors who have opted out. Matching posts are dropped. */
  suppressed?: Set<string>;
}

export interface NormaliseResult {
  posts: NormalisedPost[];
  /** Counted for the status page. An index should show what it threw away. */
  skipped: {
    nonPublic: number;
    malformed: number;
    suppressed: number;
  };
}

/**
 * The host component of an ActivityPub object id.
 *
 * This is the reliable origin, unlike account.acct, which omits the domain for
 * accounts local to the instance being polled. Using acct would attribute every
 * local post to whichever server we happened to ask.
 */
export function originHost(uri: string): string | null {
  try {
    const { hostname, protocol } = new URL(uri);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    return hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Sixteen bytes of SHA-256(salt || acct). Enough to count, not enough to identify. */
export async function authorHash(salt: string, acct: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`${salt} ${acct.toLowerCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  // slice, not subarray: this has to own its sixteen bytes. A subarray would
  // still be a view onto the full 32-byte digest, and binding that as a BLOB
  // would store all of it.
  return new Uint8Array(digest).slice(0, 16);
}

/** Hex, for use as a Set or Map key. */
export function hashKey(hash: Uint8Array): string {
  let out = '';
  for (const byte of hash) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Tags are case-insensitive on Mastodon, so the index keys on a casefolded name. */
export function casefoldTag(name: string): string {
  return name.normalize('NFKC').toLowerCase();
}

export async function normalise(
  statuses: readonly MastodonStatus[],
  options: NormaliseOptions,
): Promise<NormaliseResult> {
  const posts: NormalisedPost[] = [];
  const skipped = { nonPublic: 0, malformed: 0, suppressed: 0 };

  for (const wrapper of statuses) {
    // A boost carries none of its own tags, so the post that matched the query
    // is always the inner one. Tag timelines return originals in practice, but
    // a boost arriving here should still be attributed to the original post
    // rather than to whoever promoted it.
    const isBoost = wrapper?.reblog != null;
    const status = isBoost ? wrapper.reblog : wrapper;

    if (!status || typeof status.uri !== 'string' || typeof status.created_at !== 'string') {
      skipped.malformed += 1;
      continue;
    }

    // Public only, and for a boost both the boost and the original must be
    // public. Anything unlisted, followers-only or direct is not ours to count.
    if (status.visibility !== 'public' || (isBoost && wrapper.visibility !== 'public')) {
      skipped.nonPublic += 1;
      continue;
    }

    const host = originHost(status.uri);
    const createdAt = Math.floor(new Date(status.created_at).getTime() / 1000);
    if (host === null || !Number.isFinite(createdAt)) {
      skipped.malformed += 1;
      continue;
    }

    const acct = status.account?.acct;
    if (typeof acct !== 'string' || acct.length === 0) {
      skipped.malformed += 1;
      continue;
    }

    const hash = await authorHash(options.salt, acct);
    if (options.suppressed?.has(hashKey(hash))) {
      skipped.suppressed += 1;
      continue;
    }

    const tags = [
      ...new Set(
        (status.tags ?? [])
          .map((tag) => (typeof tag?.name === 'string' ? casefoldTag(tag.name) : ''))
          .filter((name) => name.length > 0),
      ),
    ];

    posts.push({
      uri: status.uri,
      url: typeof status.url === 'string' ? status.url : null,
      originHost: host,
      authorHash: hash,
      createdAt,
      isBoost,
      sensitive: status.sensitive === true,
      language: typeof status.language === 'string' ? status.language : null,
      tags,
    });
  }

  return { posts, skipped };
}
