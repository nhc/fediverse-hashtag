-- Fediverse Hashtag Activity Index, initial schema.
--
-- The guiding rule is to store the minimum needed to count, and nothing that
-- would make this service a mirror of other people's posts. No content, no
-- media, no display names, no readable handles. See docs/privacy.md.

-- Monitored servers. Also the opt-out list, because opting out is a column
-- rather than a process.
CREATE TABLE instance (
  host                 TEXT PRIMARY KEY,
  software             TEXT,
  version              TEXT,

  -- 'timeline'    public hashtag timelines readable without a token
  -- 'tags_only'   /api/v1/tags/:id readable, timelines refused
  -- 'activitypub' federates, but no usable Mastodon API
  -- 'blocked'     refuses this index, or the index declines to read it
  -- 'unknown'     not yet probed
  capability           TEXT    NOT NULL DEFAULT 'unknown',

  -- Position in observation.seen_mask. 0..51, so 52 instances maximum. The
  -- ceiling comes from JavaScript, not SQLite: D1 returns integers as numbers,
  -- exact only to 2^53, and an inexact mask would corrupt coverage figures.
  bit                  INTEGER UNIQUE,

  opt_out              INTEGER NOT NULL DEFAULT 0,
  opt_out_reason       TEXT,

  probed_at            INTEGER,
  last_ok_at           INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  backoff_until        INTEGER,
  added_at             INTEGER NOT NULL
);

CREATE TABLE tag (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,          -- casefolded, the lookup key
  display       TEXT,                          -- the casing people actually type
  tier          TEXT NOT NULL DEFAULT 'cold',  -- hot | warm | cold
  first_seen_at INTEGER NOT NULL,
  last_query_at INTEGER,
  query_count   INTEGER NOT NULL DEFAULT 0,
  blocked       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX tag_tier ON tag (tier) WHERE blocked = 0;

-- One row per tag and post pair. This is the counting unit. Denormalised on
-- purpose: D1 bills for rows read, and a join would cost one on every windowed
-- query. See docs/decisions.md #5.
CREATE TABLE observation (
  tag_id      INTEGER NOT NULL,
  uri         TEXT    NOT NULL,   -- ActivityPub object id, the dedup key
  url         TEXT,               -- permalink, for linking out only
  origin_host TEXT    NOT NULL,   -- host component of uri
  author_hash BLOB    NOT NULL,   -- 16 bytes of SHA-256(salt || acct)
  created_at  INTEGER NOT NULL,   -- the post's own timestamp
  observed_at INTEGER NOT NULL,   -- when this index first saw it
  seen_mask   INTEGER NOT NULL,   -- which instances reported it
  is_boost    INTEGER NOT NULL DEFAULT 0,
  sensitive   INTEGER NOT NULL DEFAULT 0,
  language    TEXT,
  PRIMARY KEY (tag_id, uri)
) WITHOUT ROWID;

CREATE INDEX observation_window ON observation (tag_id, created_at);
CREATE INDEX observation_expiry ON observation (created_at);

-- A min_id per host and tag. Snowflake ids are instance-local, so a cursor
-- belongs to exactly one host and cannot be shared.
CREATE TABLE cursor (
  host       TEXT    NOT NULL,
  tag_id     INTEGER NOT NULL,
  min_id     TEXT,
  polled_at  INTEGER,

  -- Set when a poll came back with a full page, which means there is more
  -- waiting behind it. min_id paginates forward, so a full page is a backlog
  -- rather than a loss, and the fix is to poll again next tick instead of
  -- waiting out the tier interval.
  behind     INTEGER NOT NULL DEFAULT 0,

  updated_at INTEGER NOT NULL,
  PRIMARY KEY (host, tag_id)
) WITHOUT ROWID;

-- Counts only. No post identifiers, no author hashes, no server attribution,
-- so these can outlive the 25 hour retention without holding post data.
CREATE TABLE tag_minute (
  tag_id              INTEGER NOT NULL,
  minute              INTEGER NOT NULL,
  posts               INTEGER NOT NULL,
  instances_reporting INTEGER NOT NULL,
  PRIMARY KEY (tag_id, minute)
) WITHOUT ROWID;

-- Collector health, published on the status page. An index asking to be
-- trusted about its coverage should show its own failures.
CREATE TABLE poll_log (
  id                  INTEGER PRIMARY KEY,
  host                TEXT    NOT NULL,
  at                  INTEGER NOT NULL,
  status              INTEGER,   -- HTTP status, or 0 for a network failure
  tags                INTEGER,
  new_observations    INTEGER,
  latency_ms          INTEGER,
  ratelimit_remaining INTEGER
);

CREATE INDEX poll_log_at   ON poll_log (at);
CREATE INDEX poll_log_host ON poll_log (host, at);

-- Author opt-out. Holds hashes only, so it suppresses without becoming the
-- user list this service otherwise refuses to hold. See docs/privacy.md.
CREATE TABLE author_suppression (
  author_hash BLOB PRIMARY KEY,
  added_at    INTEGER NOT NULL
) WITHOUT ROWID;

-- Daily hashtag counters read from /api/v1/tags/:id. A second opinion on
-- volume, and the only signal available from instances that refuse timelines.
-- Daily granularity, instance-local, not comparable with our own windows.
CREATE TABLE tag_history (
  tag_id    INTEGER NOT NULL,
  host      TEXT    NOT NULL,
  day       INTEGER NOT NULL,
  uses      INTEGER NOT NULL,
  accounts  INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (tag_id, host, day)
) WITHOUT ROWID;
