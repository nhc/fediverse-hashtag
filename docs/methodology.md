# Methodology

This is the page the service links to from every number it publishes. It is
written for the people reading those numbers, not for the people maintaining the
code.

## What the numbers mean

> Public hashtag activity observed by this index across participating and
> monitored servers.

That sentence is the whole claim. Each figure counts public posts carrying a
hashtag that this index saw, on the servers it watches, during the window shown.

It is not a count of hashtag use across the Fediverse. Nobody can produce that
figure, and any service offering one is either guessing or misunderstanding how
the network works.

## Why a complete count is impossible

The Fediverse has no centre. Each server knows about posts its own members wrote,
plus posts that reached it because somebody there follows the author, or because
a relay forwarded them. Two servers looking at the same hashtag see overlapping
but different sets of posts.

So this index reads several well-connected servers and merges what they report.
That gives a broad view. It is not a complete one, and the shortfall cannot be
estimated reliably, because the size of what is missing is exactly the thing no
server can see.

Measured on 27 August 2026, reading one hashtag from three servers at the same
moment returned 40 posts from any single server and 50 unique posts from all
three together. Adding servers keeps finding more, with diminishing returns and
no point at which the curve is known to have finished.

## How coverage is shown

Every count is published with the evidence for it:

- how many servers are monitored, and how many were reporting successfully
- which servers contributed to this particular tag
- the median number of servers that saw each post
- the timestamp of the last successful update
- a breakdown by the server each post originated from

That median is the most useful number on the page. If each post was seen by six
of eight monitored servers, the index is watching the well-connected middle of
the network and the count is reasonably solid. If most posts were seen by only
one server, the index is catching fragments, and the count should be read as a
lower bound and little more.

## What is counted

Included:

- public posts only, meaning posts a logged-out visitor could read on the origin
  server
- posts carrying the hashtag being queried
- original posts, which is what hashtag timelines return

Excluded:

- unlisted, followers-only and direct posts
- posts from servers that have opted out
- posts from servers that require authentication for public timelines, unless
  they are readable without it
- boosts, which do not carry the hashtags of the post they promote and so do not
  appear in hashtag timelines

Windows are cut on the post's own timestamp, not on when this index saw it. A
post that reaches the index late is counted in the window it was written in.

## Distinct authors

Author counts are exact for what the index observed, and they are produced
without keeping a list of authors. Each author handle is converted to an
irreversible hash before storage. That gives a stable key for counting distinct
people while leaving nothing that identifies them.

The count is per index, not per server, so somebody posting to three servers that
all report the post is counted once.

## Trends

A trend compares a window against the window immediately before it. The last
hour is compared with the hour before that.

This comparison is only meaningful if the index saw about as much in both
periods. If servers were unreachable during either window, the trend would
reflect the index's own outage rather than anything happening on the network. In
that case no trend is shown at all. An absent trend means the comparison could
not be made honestly, not that activity was flat.

## Latency

The collector polls every five minutes. A post typically appears in the index
within five to seven minutes of reaching a monitored server, and reaching that
server may itself have taken time.

So the five-minute window holds roughly one collection round. Read the
last-updated timestamp on every page rather than the window label: it is the
figure that tells you how current the numbers are.

That cadence is a cost decision, not a technical limit. Polling every minute
works and would cut the delay to one or two minutes, at five times the database
writes, on infrastructure shared with other things.

Busy hashtags are polled every round. Quieter ones are polled every thirty
minutes, so their five-minute window is often empty simply because the tag was
not due. Each tag page states its own polling interval, and that figure accounts
for how often the collector actually runs rather than only what the tag's tier
asks for.

## Hashtags not yet tracked

The index tracks a limited set of hashtags, because request budget is finite.
Searching for one that is not tracked does two things: it shows seven days of
daily totals taken from the servers' own hashtag counters, and it adds the tag to
the tracked set so that windowed collection begins.

Those daily totals come from a different source to everything else on the site.
They are each server's own count, at daily granularity, and they are labelled as
such. The minute-level windows start filling from the moment of the search.

## Known limitations

- Coverage is partial, and by an unmeasurable amount.
- Servers requiring authentication for public timelines are largely invisible,
  except where their posts reach a monitored server through federation.
- Deletions are not visible. Polling provides no deletion signal. The index holds
  no post content and retains records for 25 hours, so a deleted post leaves a
  link that stops working rather than a copy that persists.
- Edits are not tracked. A post is counted once, at its original timestamp.
- Servers monitored by the index are weighted by their own federation reach. A
  hashtag popular in a part of the network none of the monitored servers connects
  to will be underrepresented, and the index cannot tell that this is happening.
- Non-Mastodon platforms are covered only incidentally. Their posts appear when
  they reach a monitored Mastodon server. Pixelfed posts show up this way today.
- Counts can move downwards as well as up, because retention expires and opted-out
  servers are removed retrospectively.

## Corroboration

Where a server exposes its own hashtag counters, the index compares its
observations against them and publishes the difference on the status page. This
does not correct the index. It shows whether it is drifting away from what servers
believe about themselves, which is the closest thing to an external check that
the architecture allows.
