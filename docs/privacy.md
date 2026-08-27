# Privacy, data and opt-out

## The short version

This service counts public posts. It does not store them. It holds no post text,
no images, no display names and no author handles. Records expire after 25 hours.
Servers and, where possible, individual authors can opt out.

## What is stored

For each public post observed, against each hashtag it carries:

| Field | Example | Why |
|---|---|---|
| ActivityPub object id | `https://piaille.fr/users/x/statuses/117…` | Deduplication across servers |
| Permalink | `https://piaille.fr/@x/117…` | Linking out to the original |
| Origin server | `piaille.fr` | Breakdown by server |
| Author hash | 16 bytes of a salted SHA-256 | Counting distinct authors |
| Post timestamp | `2026-08-27T15:00:04Z` | Placing the post in a window |
| Observed timestamp | `2026-08-27T15:01:12Z` | Measuring collector lag |
| Reporting servers | a bitmask | Measuring coverage |
| Language, sensitive flag | `fr`, `false` | Filtering and display rules |

That is the complete list.

## What is never stored

- Post text, in any form
- Images, video, audio, or any media, including thumbnails
- Display names, avatars, biographies or profile data
- Author handles in readable form
- Follower counts, boost counts or favourite counts as stored data
- Private, followers-only, unlisted or direct posts
- Anything from a server that has opted out

## Author handles

Distinct-author counts need a stable key per author. They do not need to know who
the author is.

Each handle is hashed with a secret salt and truncated to sixteen bytes before
storage. The result cannot be reversed to recover the handle, and cannot be
matched against a guessed handle without the salt. It is enough to count distinct
authors exactly, and not enough to build a list of people.

This is why the service can offer author counts without becoming a directory of
who posts about what.

## Retention

Post records are deleted 25 hours after the post's timestamp, one hour beyond the
longest window offered. There is no archive and no backup of them.

What outlives that window is per-minute totals for trend charts, kept for thirty
days. Those hold counts only. They contain no post identifiers, no author hashes
and no server attribution.

## Deletions

Polling gives no deletion signal, so the index cannot learn that a post has been
removed. Rather than pretend otherwise, the design removes the consequence.

Because no content is stored, a deleted post leaves behind a link that no longer
resolves. Nothing this service holds reproduces what somebody chose to remove.
Combined with 25-hour retention, a deleted post disappears from the index within a
day regardless.

If streaming collection is added later, delete events will be honoured
immediately. That would be an improvement in speed, not in outcome.

## Server opt-out

Any server administrator can have their server excluded. Two routes:

1. Email the address on the coverage page from a domain-associated address, or
   send a message from the server's admin account.
2. Serve a `robots.txt` disallowing the index's user agent, which is checked
   before an instance is added and re-checked weekly.

The index identifies itself on every request, with a user agent naming the
service and giving a contact address. Requests are never disguised.

On opt-out:

- polling of that server stops on the next collection tick
- observations attributed to it are removed at the next retention sweep
- it is listed on the coverage page as opted out, so its absence is visible
  rather than silent
- it is never re-added without a request from the server

Servers that block the index at the network level are treated as having opted out,
and no attempt is made to work around a block.

## Author opt-out

This is harder, and the honest position is that it is partial.

The index does not store handles, so it cannot hold a list of opted-out authors
without creating exactly the kind of user list it avoids. The approach is to store
the salted hash of an opted-out handle in a small suppression list, which allows
the collector to drop matching posts without holding any readable handle.

To opt out, an author contacts the address on the coverage page. Their handle is
hashed, added to the suppression list, and existing observations matching that
hash are deleted. The list holds hashes only.

Two limitations, stated plainly:

- An author whose handle changes will need to opt out again.
- Opting out prevents the author's posts from being counted or linked in future.
  It does not remove them from the servers this index reads.

## Rate limits and server policies

- The index respects the rate limits servers report, and pauses when headroom
  runs low rather than when requests start failing.
- It reads only endpoints available without authentication. It does not
  authenticate, hold tokens, or use logged-in access to reach content that a
  visitor could not see.
- A server that requires authentication for public timelines is recorded as such
  and not worked around.
- Backoff is exponential on failure, and a server is never hammered while it is
  struggling.

## Things the service will not do

These are design rules, not features postponed.

- No ranking of individual accounts, and no presentation of activity as
  influence, reach or authority.
- No leaderboards of any kind.
- No reproduction of sensitive or content-warned media. Posts marked sensitive
  are excluded from representative post lists rather than hidden behind a click.
- No profiling of authors across hashtags, and no ability to ask what a given
  author posts about.
- No sale of data, and no advertising.
- No search of post content. This is a hashtag index.

## Legal basis and contact

The service processes public posts to produce aggregate counts, retains the
minimum needed to do so, and holds no data identifying individuals in readable
form. The contact address for data questions, server opt-out and author opt-out is
published on the coverage page and is answered by a person.

The source code is public, so these claims can be checked rather than taken on
trust.
