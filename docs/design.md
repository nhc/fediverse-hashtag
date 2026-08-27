# Design

## What this is

An index of public hashtag activity observed across a monitored set of
Fediverse servers. It is not a counter of the Fediverse. No such counter can
exist, because no server holds a complete view of the network, and this one is
no exception.

The single sentence the whole system has to keep true:

> Public hashtag activity observed by this index across participating and
> monitored servers.

Every number the service publishes carries the evidence for that sentence
alongside it: which servers contributed, how many were healthy, and when the
last successful update happened. A count without that context is not shipped.

## Why the numbers are meaningful anyway

A Mastodon hashtag timeline is already a federated view. It contains posts from
every server that instance federates with, not only its own members. Polling a
handful of well-connected instances therefore returns a broad picture, with
substantial overlap between them.

The overlap is the useful part. Measured on 27 August 2026, three instances
returned 50 unique posts for the same tag where any one returned 40. A post
reported by seven of eight monitored instances sits in the well-connected middle
of the network. A post reported by one sits at the edge. That distribution is
what lets the service describe its own coverage honestly instead of guessing at
it. See [the probe findings](probe-2026-08-27.md) for the measurements.

## How it fits together

```
                    ┌─────────────────┐
   every 5 minutes  │ instance        │  host, software, capability,
   cron ───────────▶│ registry        │  health, opt-out, mask bit
                    └────────┬────────┘
                             │  healthy, opted-in, capability=timeline
                             ▼
                    ┌─────────────────┐
                    │ scheduler       │  picks tag/instance pairs due now,
                    │                 │  batches quiet tags with any[]
                    └────────┬────────┘
                             │  <= 43 requests per tick
                             ▼
                    ┌─────────────────┐   GET /api/v1/timelines/tag/:t
                    │ collector       │──────────  ?any[]=...&min_id=cursor
                    └────────┬────────┘   Link: rel="prev" -> next cursor
                             │
                             ▼
                    ┌─────────────────┐  uri, url, created_at, origin host,
                    │ normalise       │  author hash, language, sensitive
                    └────────┬────────┘  content and media are discarded here
                             │
                             ▼
                    ┌─────────────────┐  merge every instance's view of this
                    │ dedupe + merge  │  tick in memory, keyed on uri,
                    └────────┬────────┘  OR the seen_mask together
                             │
                             ▼
                    ┌─────────────────┐  one upsert per post per tick
                    │ D1              │  observation, 25 hour retention
                    └────────┬────────┘  tag_minute rollups, poll_log
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ public   │  │ web UI   │  │ health   │
        │ API      │  │          │  │ page     │
        └──────────┘  └──────────┘  └──────────┘
```

One Worker holds all of it. The cron handler collects, the fetch handler serves.
There is no queue and no separate service, because at this scale neither earns
its complexity.

## The instance registry

Capability cannot be inferred from software version. The probe found a server
running a 4.8 development build that refuses unauthenticated timeline requests,
sitting beside 4.7.0 servers that allow them. So every instance is probed, and
re-probed weekly, and classified:

| Class | Meaning | Used for |
|---|---|---|
| `timeline` | Public hashtag timelines readable without a token | Full collection |
| `tags_only` | `/api/v1/tags/:id` readable, timelines refused | Daily corroboration only |
| `activitypub` | Federates, but no usable Mastodon API | Nothing yet, recorded for later |
| `blocked` | Refuses this index, or the index declines to read it | Nothing |
| `unknown` | Not yet probed | Nothing |

An instance in `tags_only` is still worth keeping. Its seven-day history gives a
second opinion on volume and distinct authors, which is a genuine check against
the index drifting away from what servers believe about themselves.

Opt-out is a column on this table, not a process. Setting `opt_out` stops all
requests to that host on the next tick, and existing observations attributed to
it are removed at the next retention sweep. See [privacy](privacy.md).

## Collection

### Request budget

Request budget is the scarcest resource in the system, so the scheduler is built
around it rather than around tags.

The Mastodon side is generous. Every probed host reported 300 requests per five
minutes per IP, which is sixty a minute per instance. The index will never
approach that.

The Cloudflare side is the real ceiling. A Worker gets 50 external subrequests per
invocation on the free plan, and everything a tick does counts towards the same
50, maintenance included. That per-tick cap is what MAX_REQUESTS_PER_TICK is
sized against, and it is independent of how often the tick fires.

How often it fires is a separate decision, made on the write budget rather than
the request budget. The cron runs every five minutes, which is a fifth of the
writes of a one-minute cadence and a fifth of the freshness. See
[what the platform actually costs](#what-the-platform-actually-costs).

A tick can also probe one instance, which costs up to five requests: robots.txt,
nodeinfo discovery, the nodeinfo document, a hashtag timeline and the tag
metadata. So the sum is 43 for collection, 5 for a probe and 2 spare. Sizing the
collector at 48 and calling the rest reserve would breach the cap on any tick
that probed.

### Tiered, adaptive polling

Polling every tag on every instance every minute does not fit, so tags earn
their frequency:

| Tier | Poll interval | Batched | Cost per tag per minute, 8 instances |
|---|---|---|---|
| `hot` | every tick | never | 8.0 requests |
| `warm` | 5 minutes | 4 per request | 0.4 requests |
| `cold` | 30 minutes | 4 per request | 0.07 requests |

Within a 43 request per minute budget that supports roughly three hot tags,
forty warm tags and a hundred cold ones at the same time. Promotion and demotion
are driven by observed post rate and by how recently a human asked about the
tag, so the tags people actually look at are the ones kept fresh.

Batching relies on the `any[]` parameter, which the probe confirmed works. The
important limitation is that `limit=40` is shared across the batch, so a busy tag
crowds out a quiet one. Tags are therefore only batched with others of similar
observed volume, and hot tags are never batched.

### Cursors

Each instance and tag pair keeps a `min_id` cursor taken from the `Link` header's
`rel="prev"` value. Passing it on the next poll returns only what has arrived
since, and returns an empty array when nothing has. Quiet tags cost almost
nothing to keep watching.

The ids are instance-local snowflakes, so a cursor belongs to one host and cannot
be shared. When a cursor is lost or a gap is suspected, the collector falls back
to a plain `limit=40` fetch and re-derives it.

### Cold tags answer immediately

When somebody searches for a tag the index has never tracked, the honest answer
is that there is no windowed data yet. That is a poor experience, and there is a
better one available.

`/api/v1/tags/:id` is readable on every Mastodon host probed, including the one
that blocks timelines, and it returns seven days of daily `uses` and distinct
`accounts` counts. So a cold tag search returns that history straight away,
clearly labelled as daily figures from instance-local counters, and registers the
tag for tracking. The five-minute and hourly windows fill in from that point
forward, and the page says so plainly.

### Failure handling

Instances fail in ordinary ways, and the collector treats all of them as normal
operation rather than as errors.

- Non-200 responses, timeouts and malformed payloads increment
  `consecutive_failures` and set `backoff_until` on an exponential schedule,
  capped at one hour.
- A 429, or an `x-ratelimit-remaining` below 30, pauses that host until the
  reported reset time. The header is recorded on every poll so the budget can be
  audited rather than assumed.
- A 401 or 422 reclassifies the instance as `tags_only` rather than retrying,
  because that is a configuration change and not a transient fault.
- Duplicate delivery is expected, not exceptional. The primary key on
  `(tag_id, uri)` makes re-observation idempotent.

Health, latency and rate-limit headroom per instance are recorded in `poll_log`
and published on the health page. An index that asks to be trusted about its
coverage should show its own failures.

## Data model

The guiding rule is to store the minimum needed to count, and nothing that would
make this service a mirror of other people's posts. No content, no display names,
no media, no avatars.

```sql
-- Monitored servers. Also the opt-out list.
CREATE TABLE instance (
  host                 TEXT PRIMARY KEY,
  software             TEXT,
  version              TEXT,
  capability           TEXT    NOT NULL DEFAULT 'unknown',
  bit                  INTEGER UNIQUE,       -- 0..51, position in seen_mask
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
  name          TEXT NOT NULL UNIQUE,   -- casefolded, the lookup key
  display       TEXT,                   -- the casing people actually type
  tier          TEXT NOT NULL DEFAULT 'cold',
  first_seen_at INTEGER NOT NULL,
  last_query_at INTEGER,
  query_count   INTEGER NOT NULL DEFAULT 0,
  blocked       INTEGER NOT NULL DEFAULT 0
);

-- One row per tag and post. This is the counting unit.
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

CREATE TABLE cursor (
  host       TEXT    NOT NULL,
  tag_id     INTEGER NOT NULL,
  min_id     TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (host, tag_id)
) WITHOUT ROWID;

-- Rollups, so charts do not rescan the observation table.
CREATE TABLE tag_minute (
  tag_id              INTEGER NOT NULL,
  minute              INTEGER NOT NULL,
  posts               INTEGER NOT NULL,
  instances_reporting INTEGER NOT NULL,
  PRIMARY KEY (tag_id, minute)
) WITHOUT ROWID;

-- Collector health, published on the status page.
CREATE TABLE poll_log (
  id                  INTEGER PRIMARY KEY,
  host                TEXT    NOT NULL,
  at                  INTEGER NOT NULL,
  status              INTEGER,
  tags                INTEGER,
  new_observations    INTEGER,
  latency_ms          INTEGER,
  ratelimit_remaining INTEGER
);
```

### Three decisions in that schema worth explaining

**`author_hash` rather than a handle.** Distinct-author counts need a stable
per-author key. They do not need to know who the author is. Storing sixteen bytes
of a salted hash gives exact distinct counts while leaving no user list to leak,
subpoena or accidentally publish. The salt is a Worker secret and is never
rotated without accepting a discontinuity in author counts.

**`seen_mask` rather than an observations-per-instance table.** Recording which
of eight instances saw each post as separate rows multiplies write volume by
eight. A bitmask holds the same information in one column that can be merged in
place with a bitwise OR. Because a single cron tick polls many instances, their
views are merged in memory first, so a new post normally costs one write rather
than one per instance.

The mask is capped at 52 bits, and the reason is JavaScript rather than SQLite.
D1 returns integers as numbers, which are exact only to 2^53, so a wider mask
would come back corrupted and take every coverage figure with it. The OR itself
runs in SQL, and the in-memory merge uses BigInt.

**Denormalised, so a post with three tracked tags occupies three rows.** The
alternative is a `post` table with a `post_tag` join, which saves a little
storage and costs a join on every windowed query. D1 bills for rows read, and the
counting unit genuinely is the tag and post pair, so the flatter table is both
cheaper and closer to the question being asked.

### Retention

| Table | Retained | Why |
|---|---|---|
| `observation` | 25 hours | One hour more than the longest window |
| `tag_minute` | 30 days | Trend charts. Counts only, no post or author identifiers |
| `poll_log` | 7 days | Health page |
| `cursor`, `tag`, `instance` | Indefinitely | Operational state, no post data |

The retention sweep runs hourly. Short retention is a privacy measure and a cost
measure at once, and it also limits the damage that undetected deletions can do.

## What the platform actually costs

The parse cost was measured rather than estimated, because it is the only part
that was in doubt. A real 40-status response from a hashtag timeline is 210 KB,
and parsing it plus extracting every field the collector keeps, including a
SHA-256 per author, takes **0.268 ms** on V8. That is roughly 780 MB a second,
and it is around five times faster than a reasonable guess would suggest.

That measurement makes the platform question much less interesting than expected.

| Resource | Needed | Workers Paid included | Share |
|---|---|---|---|
| Requests | ~44k/month cron, plus web traffic | 10M/month | under 1% |
| CPU | 0.1M to 0.56M ms/month | 30M ms/month | under 2% |
| CPU per cron tick | 2.3 ms typical, 11.5 ms worst case | 30,000 ms | negligible |
| D1 rows written | ~15M/month | 50M/month | 30% |
| D1 rows read | indexed window queries | 25B/month | negligible |
| D1 storage | under 1 GB | 5 GB | under 20% |

On Workers Paid this workload adds nothing to the five dollar subscription. Every
line except writes disappears into the allowances.

### Writes are the one budget that needs watching

An earlier version of this section put writes at 720,000 a month, which was wrong
by a factor of twenty. It counted observation inserts and missed four other write
paths entirely. Measured on the live index, at fourteen tracked tags:

| Write path | Rows/day | Why |
|---|---|---|
| `poll_log` | ~159,000 | 39,720 inserts, one index, plus expiry deletes |
| `observation` | ~126,000 | inserts, deletes, one index each, plus mask updates |
| `cursor` | ~99,000 | one upsert per tag per poll |
| `tag_candidate` | ~50-86,000 | capped per tick |
| `tag_minute` | ~30,000 | only the buckets a tick touched |
| `instance` | ~13,000 | health after every poll |
| **Total** | **~480-510,000** | **~15M/month, 30% of the allowance** |

Two things in that table are worth keeping in mind. Every index costs a written
row on each insert and each delete, which is why this service runs three indexes
and not six: an index serving only an hourly sweep is not worth two writes on
every row, given the read allowance is 25 billion a month against a write
allowance of 50 million.

And the figures scale with the tracked set, capped at 150 against the fourteen
measured here. At the ceiling the total lands around 40 to 45 million a month,
inside the allowance but without much room. The dial to reach for first is
`MAX_CANDIDATE_WRITES_PER_TICK`, then the cron interval.

### The free tier needs a smaller service, not a tweak

This section previously claimed the free tier worked with one adjustment. It does
not, and the reason is writes rather than CPU.

CPU is genuinely fine. A typical tick costs 2.3 ms against the free limit of
10 ms per cron trigger, because `min_id` cursors mean most polls return little.
Only a tick where all 43 polls return a full 40 statuses exceeds it, at 11.5 ms,
and the per-tick parse budget handles that by deferring the remainder to the next
tick, which cursors make safe.

Writes are the problem. At roughly 480,000 a day against a free allowance of
100,000, the default configuration is about five times over.

| Free-tier limit | Value | Default config needs |
|---|---|---|
| CPU per cron trigger | 10 ms | 2.3 ms typical, capped below 10 |
| External subrequests per invocation | 50 | 43 collect + 5 probe |
| Requests | 100,000/day | 1,440 cron, plus web traffic |
| **D1 rows written** | **100,000/day** | **~480,000/day** |

Worth being precise about what going over means: the D1 free tier blocks rather
than bills. Exceeding the write limit returns an error until midnight UTC, so the
consequence is a collector that stops, not a bill. There is no overage charge on
the free plan.

A genuinely free deployment is possible, but it is a smaller service. A
five-minute cron divides everything by five, and setting
`MAX_CANDIDATE_WRITES_PER_TICK` to zero turns discovery off. That lands around
80,000 writes a day, inside the limit, at the cost of five-minute latency and no
tag discovery. Whether that is worth running is a judgement call, and it should be
made deliberately rather than discovered when collection stops.

### The egress question, answered

The design carried an open worry that Mastodon rate-limits per IP while a Worker
egresses from shared Cloudflare addresses, and that some instances throttle
datacentre ranges. It could not be tested from a laptop.

It has now been measured from the deployed Worker. Across 525 requests to nine
servers there were no failures and no throttling, and reported headroom stayed
between 247 and 292 of 300. Sharing Cloudflare's egress addresses caused no
observable problem at this request rate. Worth re-checking if the instance list
grows, but it is no longer an unknown.

## Aggregation

Windows of five minutes, one hour and twenty-four hours are computed from
`observation` using the `(tag_id, created_at)` index. Windows are cut on
`created_at`, the post's own timestamp, not on when the index saw it, so a post
that arrives late lands in the window it belongs to.

Distinct authors cannot be summed from per-minute rollups, so they are always
computed from `observation` directly. This is affordable precisely because
retention is 25 hours, and it is the main reason not to shorten it further.

Trend compares a window against the equal window before it. That comparison is
only meaningful if coverage was similar across both, so every trend figure
carries a `coverage_comparable` flag derived from `poll_log`. If half the
instances were unreachable during the earlier window, the trend is suppressed
rather than published with a caveat nobody reads.

## Public API

```
GET  /api/v1/tags/:tag                 windowed metrics and coverage
GET  /api/v1/tags/:tag/timeseries      per-minute buckets for charts
GET  /api/v1/tags/:tag/posts           permalinks to representative posts
GET  /api/v1/instances                 registry, capability and health
GET  /api/v1/coverage                  what the index can and cannot see
GET  /api/v1/meta                      version, last update, methodology
POST /api/v1/tags/:tag/watch           register a cold tag, rate limited
```

Every metrics response carries its own provenance. Field names avoid implying
completeness, so there is no `posts`, only `posts_observed`.

```json
{
  "tag": "cats",
  "display": "Cats",
  "as_of": "2026-08-27T15:04:00Z",
  "completeness": "partial",
  "statement": "Public hashtag activity observed by this index across participating and monitored servers.",
  "windows": {
    "5m":  { "posts_observed": 4,   "authors_observed": 4,   "trend": null,
             "coverage_comparable": false },
    "1h":  { "posts_observed": 61,  "authors_observed": 48,  "trend": 0.12,
             "coverage_comparable": true },
    "24h": { "posts_observed": 892, "authors_observed": 517, "trend": -0.04,
             "coverage_comparable": true }
  },
  "coverage": {
    "instances_monitored": 8,
    "instances_reporting": 7,
    "instances_degraded": ["infosec.exchange"],
    "reported_by": ["mastodon.social", "hachyderm.io", "mstdn.social"],
    "median_instances_per_post": 6,
    "unique_origin_servers": 143
  },
  "origins": [
    { "host": "mastodon.social", "posts_observed": 214 },
    { "host": "piaille.fr",      "posts_observed": 96  }
  ]
}
```

`median_instances_per_post` is the coverage signal derived from `seen_mask`. A
median of six out of eight says the index is seeing the well-connected core. A
median of one says it is catching fragments, and the interface should be far more
cautious about the number beside it.

`trend` is `null` where `coverage_comparable` is false, and clients should render
that as unavailable rather than as zero.

## Representative posts

The index stores permalinks and never post content. `/posts` returns links and
timestamps only.

This is deliberate, and it solves the deletion problem more reliably than any
delete-event handling could. Polling gives no deletion signal at all, so a cached
copy of a post would outlive its deletion. A link cannot. When somebody deletes a
post, the link stops resolving, and nothing this service holds reproduces what
they removed. Sensitive-media posts are excluded from representative lists
entirely rather than hidden behind a click.

## Web interface

Four pages, no more.

- **Search.** One field. A tracked tag shows live counters, a sparkline and the
  coverage panel. A cold tag shows the seven-day daily history, says clearly that
  windowed collection has just begun, and starts it.
- **Tag.** The windows, the trend chart, origin-server breakdown, representative
  links, and the coverage panel beside the numbers rather than below them.
- **Coverage and methodology.** Which instances are monitored, what each one is
  classified as, what the index cannot see, and how the numbers are produced.
  This page is part of the product, not an appendix.
- **Status.** Per-instance health, last successful poll, request budget headroom,
  collector lag. Published because an index making claims about its coverage
  should show its own failures.

## Discovery

Framing this as search-first was a mistake. It made the service a lookup tool for
hashtags you already knew, and discovery is the point.

The signal was already flowing past and being discarded. A post fetched for one
tag carries others, and the collector kept only the tags it was already tracking.
Those co-occurring tags are the discovery surface, and they cost nothing extra to
see, because the request has already been paid for. A single tick was measured
seeing 469 distinct untracked tags.

### Distinct authors, never use count

Candidates are stored as one row per tag per author, so the row count per tag is
an exact distinct author count. That shape is chosen so the wrong ranking is
impossible rather than merely discouraged.

A tag used two hundred times by three accounts is one person shouting. A tag used
twenty times by twenty accounts is a conversation. Only the second is worth a
polling slot or a place on a page, and any ranking built on use count gets this
backwards. `posts_per_author` is published beside every count so a reader can see
which they are looking at rather than trusting the ordering.

### Promotion and retirement

The tracked set is capped at 150, which is what the tier arithmetic supports
inside a 43 request budget. So admitting a tag needs a free slot, and slots come
back from tags that have gone quiet.

Every ten minutes, retirement runs first and promotion second. A tracked tag is
retired when it has produced nothing for a day and nobody has asked about it for
a week. Retiring sets a flag rather than deleting the row, so history survives and
a returning tag does not start from nothing. Human interest alone keeps a tag:
somebody watching a quiet hashtag is a perfectly good reason to keep watching it.

Promotion then takes the strongest candidates by distinct authors, needing at
least five, up to the number of free slots. A candidate that qualifies but finds
no room stays a candidate, still counted and still shown as discovered.

### What discovery costs

Recording every co-occurring tag would be several hundred row writes a minute,
and the D1 free tier allows 100,000 a day in total. So candidate writes are
capped per tick, defaulting to 60, with the tags seen most often in that tick
written first.

That cap is a real limit and worth stating plainly: on the free tier, discovery
breadth competes directly with observation depth, and 60 a tick is already around
86,000 writes a day. On Workers Paid the included allowance is 50 million a month
and the cap can go up substantially.

## Deliberately not in the MVP

Named here so that leaving them out reads as a decision rather than an omission.

- Streaming. Polling at one-minute granularity is honest about latency and avoids
  Durable Objects entirely. Streaming can be added per instance later without
  changing the schema.
- Adapters for Pixelfed, Misskey, PeerTube and Lemmy. Federation already delivers
  some of their posts through Mastodon timelines, which is worth measuring before
  writing code. Bluesky is a separate integration and a separate decision.
- Author-level anything. Not a scope cut, a design rule. See [privacy](privacy.md).
