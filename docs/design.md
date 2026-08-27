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
   every minute     │ instance        │  host, software, capability,
   cron ───────────▶│ registry        │  health, opt-out, mask bit
                    └────────┬────────┘
                             │  healthy, opted-in, capability=timeline
                             ▼
                    ┌─────────────────┐
                    │ scheduler       │  picks tag/instance pairs due now,
                    │                 │  batches quiet tags with any[]
                    └────────┬────────┘
                             │  <= 48 requests per tick
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

The Cloudflare side is the real ceiling. On the free plan a Worker gets 50
external subrequests per invocation, so a one-minute cron allows 50 upstream
requests a minute. The scheduler targets 48 and keeps two in reserve for probes
and retries.

### Tiered, adaptive polling

Polling every tag on every instance every minute does not fit, so tags earn
their frequency:

| Tier | Poll interval | Batched | Cost per tag per minute, 8 instances |
|---|---|---|---|
| `hot` | every tick | never | 8.0 requests |
| `warm` | 5 minutes | 4 per request | 0.4 requests |
| `cold` | 30 minutes | 4 per request | 0.07 requests |

Within a 48 request per minute budget that supports roughly three hot tags,
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
  bit                  INTEGER UNIQUE,       -- 0..62, position in seen_mask
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
eight. A 63-bit mask holds the same information in one column that can be
merged in place with a bitwise OR. Because a single cron tick polls many
instances, their views are merged in memory first, so a new post normally costs
one write rather than one per instance.

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
| CPU per cron tick | 2.3 ms typical, 12.9 ms worst case | 30,000 ms | negligible |
| D1 rows written | ~720k/month | 50M/month | 1.5% |
| D1 rows read | indexed window queries | 25B/month | negligible |
| D1 storage | under 1 GB | 5 GB | under 20% |

On Workers Paid this workload disappears into the included allowances. It adds
nothing to the five dollar subscription.

### The free tier is viable too, with one adjustment

The binding free-tier limit is 10 ms of CPU per cron trigger. A typical tick
costs 2.3 ms, because `min_id` cursors mean most polls return little or nothing.
A tick where every one of 48 polls returns a full 40 statuses costs 12.9 ms, and
that tick would be terminated.

The fix is a per-tick parse budget rather than a smaller design. The collector
counts bytes as it goes, stops parsing at a configured ceiling, and leaves the
remaining polls for the next tick. Cursors make deferral safe, because nothing is
lost by reading a tag a minute later. With that cap in place every free-tier
limit is satisfied:

| Free-tier limit | Value | Needed |
|---|---|---|
| CPU per cron trigger | 10 ms | 2.3 ms typical, capped below 10 ms |
| External subrequests per invocation | 50 | 48 |
| D1 rows written | 100,000/day | ~24,000/day |
| Requests | 100,000/day | 1,440 cron, plus web traffic |

So the service can run for nothing, and runs with more headroom on Workers Paid.
The parse budget is a configuration value in both cases, and the status page
reports which plan and which budget are in effect.

One unknown remains, and it is not about cost. Mastodon rate-limits
unauthenticated requests per IP, and a Worker egresses from shared Cloudflare
addresses. The index may share a bucket with unrelated traffic, and some
instances throttle datacentre ranges. This must be measured from a deployed
Worker before the instance list is fixed.

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

## Deliberately not in the MVP

Named here so that leaving them out reads as a decision rather than an omission.

- Streaming. Polling at one-minute granularity is honest about latency and avoids
  Durable Objects entirely. Streaming can be added per instance later without
  changing the schema.
- Adapters for Pixelfed, Misskey, PeerTube and Lemmy. Federation already delivers
  some of their posts through Mastodon timelines, which is worth measuring before
  writing code. Bluesky is a separate integration and a separate decision.
- Discovery of trending tags across the whole index. It needs a public-timeline
  firehose, which is a different ingestion shape and a much larger budget.
- Author-level anything. Not a scope cut, a design rule. See [privacy](privacy.md).
