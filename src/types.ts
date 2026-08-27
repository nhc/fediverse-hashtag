/**
 * Shared types. Mastodon shapes describe only the fields this index reads,
 * which is deliberately a small subset. Anything not listed here is not
 * stored, and mostly is not even looked at.
 */

export interface Env {
  DB: D1Database;

  COLLECTOR_USER_AGENT: string;
  CONTACT: string;
  MAX_REQUESTS_PER_TICK: string;
  MAX_PARSE_BYTES_PER_TICK: string;
  MAX_TAGS_PER_BATCH: string;
  RATELIMIT_FLOOR: string;
  RETENTION_HOURS: string;
  MAX_CANDIDATE_WRITES_PER_TICK: string;
  CRON_PERIOD_SECONDS: string;

  /**
   * Secret. Salts the author hash, so distinct-author counts work without this
   * service holding a list of handles. Rotating it discontinues author counts,
   * so it is not rotated casually. Set with:
   *   npx wrangler secret put AUTHOR_SALT
   */
  AUTHOR_SALT: string;
}

/** What an instance will actually let this index read. Probed, never inferred. */
export type Capability = 'timeline' | 'tags_only' | 'activitypub' | 'blocked' | 'unknown';

/** How often a tag is polled. Earned by observed volume and human interest. */
export type Tier = 'hot' | 'warm' | 'cold';

export const TIER_INTERVAL_SECONDS: Record<Tier, number> = {
  hot: 60,
  warm: 300,
  cold: 1800,
};

/** Priority when the request budget runs short. Lower goes first. */
export const TIER_ORDER: Record<Tier, number> = { hot: 0, warm: 1, cold: 2 };

// --- Mastodon API, only the parts we read ------------------------------------

export interface MastodonAccount {
  /** Local accounts have no domain here, so origin comes from the uri instead. */
  acct: string;
}

export interface MastodonTag {
  name: string;
}

export interface MastodonStatus {
  id: string;
  uri: string;
  url: string | null;
  created_at: string;
  visibility: string;
  language: string | null;
  sensitive: boolean;
  reblog: MastodonStatus | null;
  account: MastodonAccount;
  tags: MastodonTag[];
}

export interface MastodonTagHistoryDay {
  day: string;
  uses: string;
  accounts: string;
}

export interface MastodonTagMetadata {
  name: string;
  history?: MastodonTagHistoryDay[];
}

// --- Internal shapes --------------------------------------------------------

/** A public post, reduced to what counting needs. */
export interface NormalisedPost {
  /** ActivityPub object id. The dedup key across every instance. */
  uri: string;
  url: string | null;
  originHost: string;
  authorHash: Uint8Array;
  createdAt: number;
  isBoost: boolean;
  sensitive: boolean;
  language: string | null;
  /** Every casefolded tag on the post. The collector keeps only tracked ones. */
  tags: string[];
}

export interface InstanceRow {
  host: string;
  software: string | null;
  version: string | null;
  capability: Capability;
  bit: number | null;
  opt_out: number;
  opt_out_reason: string | null;
  probed_at: number | null;
  last_ok_at: number | null;
  consecutive_failures: number;
  backoff_until: number | null;
  added_at: number;
}

export interface TagRow {
  id: number;
  name: string;
  display: string | null;
  tier: Tier;
  first_seen_at: number;
  last_query_at: number | null;
  query_count: number;
  blocked: number;
}
