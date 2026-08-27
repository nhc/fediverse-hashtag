# Decisions

Each entry records what was decided, what it costs, and what would justify
revisiting it. Dated so that later readers can tell how stale the reasoning is.

## 1. Cloudflare Workers and D1
*27 August 2026*

**Decision.** One Worker, one D1 database, TypeScript, Vitest, wrangler.

**Why.** It matches the existing `mastodon/` project in this repository set, so
there is one set of conventions and one deployment story. D1 is a native binding,
so there is no connection string and no extra secret to rotate. The workload is
small rows, written once and read for a day.

**Cost.** Long-lived outbound connections are awkward, which rules out streaming
without Durable Objects. Cron granularity is one minute, which sets the floor on
latency.

**Revisit if.** Streaming becomes necessary, or write volume outgrows D1.

## 2. Polling rather than streaming
*27 August 2026*

**Decision.** Poll hashtag timelines once a minute. No streaming in the MVP.

**Why.** Streaming from a Worker needs a Durable Object per instance holding an
upstream WebSocket, with reconnection, hibernation and backfill-on-gap logic. That
is a large amount of machinery for an improvement from roughly ninety seconds of
latency to a few seconds. Polling with a `min_id` cursor is cheap, idempotent and
easy to reason about when an instance misbehaves.

**Cost.** Latency of one to two minutes. The five-minute window is near-real-time,
not live.

**Revisit if.** Users genuinely need sub-minute figures, or an instance offers
streaming and refuses polling.

## 3. Hashtag timelines rather than a public firehose
*27 August 2026*

**Decision.** Poll `/api/v1/timelines/tag/`, and track a bounded set of tags.

**Why.** A public-timeline firehose would index every tag with no tracked list,
but it means fetching every public post on every monitored instance and discarding
most of it. Request volume, parsing cost and write volume all rise by an order of
magnitude, for coverage of tags nobody is asking about.

**Cost.** There is a tracked-tag list, so a search for an untracked tag has no
windowed history at first. Decision 12 softens this considerably.

**Revisit if.** Trend discovery across all tags becomes a goal, which it is not
in the MVP.

## 4. Tiered adaptive polling with `any[]` batching
*27 August 2026*

**Decision.** Three tiers at one, five and thirty minutes. Quiet tags batched up
to four per request using `any[]`. Tags promoted by observed rate and by human
interest.

**Why.** The probe confirmed `any[]` returns statuses for several tags in one
request, which is the only way a 48-request-per-minute budget covers more than a
handful of tags. Tiering puts the budget where people are looking.

**Cost.** `limit=40` is shared across a batch, so a busy tag crowds out a quiet
one. Batching is therefore restricted to tags of similar volume, and hot tags are
never batched. This is a real source of undercounting if the volume estimate for
a tag is wrong.

**Revisit if.** Batches are found to be dropping posts. The fix is smaller
batches, and the detection is comparing batched against unbatched polls for the
same tag.

## 5. A denormalised `observation` table
*27 August 2026*

**Decision.** One row per tag and post pair, rather than a `post` table with a
`post_tag` join.

**Why.** The counting unit genuinely is the tag and post pair. D1 bills for rows
read, and a join reads two tables on every windowed query.

**Cost.** A post carrying three tracked tags occupies three rows, duplicating its
uri and permalink. Storage is not the binding constraint, so this is acceptable.

## 6. `seen_mask` rather than per-instance observation rows
*27 August 2026*

**Decision.** An integer bitmask recording which monitored instances reported
each post, capped at 52 bits.

**Why.** Separate rows per instance multiply write volume by the instance count.
The mask holds the same information in one column, merged with a bitwise OR.
Because one cron tick polls many instances, their views are merged in memory
before writing, so a new post normally costs one write rather than eight.

**Cost.** A hard ceiling of 52 monitored instances, and no per-instance timestamp
for when each one saw a post. The ceiling is JavaScript's, not SQLite's: D1
returns integers as numbers, exact only to 2^53, so a wider mask would be read
back corrupted. The OR runs in SQL and the in-memory merge uses BigInt.

**Revisit if.** More than about forty instances are monitored. Past that the mask
needs splitting across two columns, or coverage needs a different
representation.

## 7. Salted author hashes rather than handles
*27 August 2026*

**Decision.** Store sixteen bytes of `SHA-256(salt || acct)`. Never store the
handle.

**Why.** Distinct-author counts need a stable key, not an identity. Hashing gives
exact counts with no user list to leak or be compelled to hand over. It also makes
several unwanted features impossible to build by accident, such as asking what a
given author posts about.

**Cost.** Author opt-out becomes awkward, and is handled with a hash suppression
list. The salt cannot be rotated without a discontinuity in author counts.

## 8. Links only, never content
*27 August 2026*

**Decision.** Store the permalink. Never store post text, media or profile data.

**Why.** It keeps the service an index rather than a mirror, and it solves the
deletion problem structurally. Polling gives no deletion signal, so any cached
content would outlive its deletion. A link cannot.

**Cost.** Representative posts are links rather than previews, which is a less
rich interface. That is the correct trade.

## 9. Retention of 25 hours
*27 August 2026*

**Decision.** Delete observation rows 25 hours after the post timestamp. Keep
per-minute count rollups for thirty days.

**Why.** One hour beyond the longest window. It is a privacy measure, a cost
measure and a limit on the damage from undetected deletions, all at once. It also
makes exact distinct-author counts affordable, since the rows are still present.

**Cost.** No historical windows longer than 24 hours, and no ability to answer
questions about last week beyond per-minute totals.

## 10. Run on either plan, with a per-tick parse budget
*27 August 2026, revised the same day*

**Decision.** Target Workers Paid, but keep the free tier genuinely supported by
capping how many bytes a single tick will parse.

**Why.** An earlier version of this entry claimed the free tier could not parse a
full tick and that Workers Paid was therefore required. That was wrong, and it was
wrong because the parse cost was estimated instead of measured. Measured, a
210 KB response of 40 statuses costs 0.268 ms to parse and normalise, including a
SHA-256 per author. V8 manages roughly 780 MB a second, about five times the
assumed rate.

A typical tick therefore costs 2.3 ms of CPU, well inside the free tier's 10 ms
per cron trigger, because `min_id` cursors mean most polls return little. Only a
tick where nearly every poll returns a full 40 statuses exceeds it, at 12.9 ms.

**Cost.** A parse budget in the collector, which stops reading at a byte ceiling
and defers the rest to the next tick. Cursors make that safe. On Workers Paid the
ceiling is set high enough never to trigger.

**Consequence.** The whole workload is under two per cent of every Workers Paid
included allowance, so it costs nothing beyond the five dollar subscription. It
also runs on the free tier. The plan is no longer an architectural constraint.

**Lesson worth keeping.** The one number in the budget that mattered was the one
that had not been measured.

**Open question.** Mastodon rate-limits per IP and Workers egress from shared
Cloudflare addresses. Some instances throttle datacentre ranges. This must be
measured from a deployed Worker before the instance list is fixed.

## 11. Suppress trends when coverage is not comparable
*27 August 2026*

**Decision.** Return `null` for a trend when instance health differed materially
between the two windows being compared.

**Why.** A drop caused by the index's own outage looks exactly like a drop in
activity. Publishing it with a footnote is worse than not publishing it, because
the number gets quoted and the footnote does not.

**Cost.** Trends are sometimes unavailable, which looks like a gap. It is an
honest gap, and the interface labels it as such rather than showing zero.

## 12. Answer cold tags from `/api/v1/tags/:id`
*27 August 2026*

**Decision.** A search for an untracked tag returns seven days of daily totals
from instance hashtag counters, clearly labelled, and registers the tag for
windowed tracking.

**Why.** The probe found this endpoint readable on every Mastodon host tested,
including one that refuses timeline requests. It turns an empty page into a useful
one, and it reaches instances the collector otherwise cannot read at all.

**Cost.** Two sources with different properties on one page, which has to be
labelled carefully. The daily figures are instance-local, at daily granularity,
and not directly comparable with the index's own windows.

## 13. Discovery ranks on distinct authors, not use count
*27 August 2026, added after the MVP*

**Decision.** Record co-occurring untracked tags as one row per tag per author,
rank them by distinct authors, and promote automatically into a capped tracked
set. Add an /tags page listing everything tracked and everything discovered.

**Why.** The original design deferred discovery to a later phase and called the
service search-first. That was the wrong call: it made the index a lookup tool
for hashtags you already knew, and discovery is the actual point.

The mechanism was already available and being thrown away. Posts fetched for one
tag carry others, and a measured tick saw 469 distinct untracked tags. Ranking on
distinct authors rather than uses comes from the prototype in the sibling
mastodon project: a tag used 200 times by three accounts is a person shouting,
not a community.

**Cost.** Candidate writes are capped per tick, defaulting to 60, because
recording everything would be several hundred rows a minute against a free-tier
allowance of 100,000 a day. On the free tier discovery breadth therefore competes
with observation depth. The cap is an env var and is noise on Workers Paid.

**Consequence.** The tracked set is capped at 150 and now churns: quiet tags are
retired to free slots for discovered ones. Retirement sets a flag rather than
deleting, so history survives and the decision is reversible.

**Revisit if.** Promotion proves too eager or too slow. The two dials are the
author threshold and the tracked ceiling, and both are pure functions with tests.
