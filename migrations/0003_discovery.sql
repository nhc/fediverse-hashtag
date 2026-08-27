-- Tag discovery.
--
-- The index was built search-first: you got numbers for a hashtag you already
-- knew. That makes it a lookup tool, and discovery is the actual point, so this
-- migration adds the pool that makes it possible.
--
-- The signal was already flowing past and being discarded. A post fetched for
-- #cats also carries #mastocats and #catsofmastodon, and the collector kept only
-- the tags it was already tracking. Those co-occurring tags are the discovery
-- surface, and they cost nothing extra to see because the request has already
-- been paid for.

-- Tracked tags can now be retired without losing their history, so a tag that
-- goes quiet gives its polling slot back instead of holding it forever.
ALTER TABLE tag ADD COLUMN tracked INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tag ADD COLUMN retired_at INTEGER;

DROP INDEX IF EXISTS tag_tier;
CREATE INDEX tag_tracked ON tag (tracked, tier) WHERE blocked = 0;

-- The discovery pool: one row per candidate tag per author who used it.
--
-- Keyed this way on purpose. Counting rows per name gives an exact distinct
-- author count, which is the signal that separates a community from one person
-- posting repeatedly. A plain uses counter would rank a single enthusiastic
-- account above a genuine conversation, which is the mistake this shape makes
-- impossible rather than merely discouraged.
--
-- Author hashes here are the same salted, irreversible sixteen bytes stored
-- everywhere else, so the pool counts people without identifying any.
CREATE TABLE tag_candidate (
  name        TEXT    NOT NULL,
  author_hash BLOB    NOT NULL,
  first_seen  INTEGER NOT NULL,
  PRIMARY KEY (name, author_hash)
) WITHOUT ROWID;

-- Swept on the same schedule as observations, so the pool reflects current
-- activity rather than everything ever seen.
CREATE INDEX tag_candidate_seen ON tag_candidate (first_seen);
