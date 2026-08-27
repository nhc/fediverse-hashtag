# Fediverse Hashtag Activity Index

A free service showing near-real-time hashtag activity across federated social
platforms, starting with Mastodon-compatible servers.

It reports what it can see, and says so:

> Public hashtag activity observed by this index across participating and
> monitored servers.

It is not a count of hashtag use across the Fediverse. No such count can exist,
because no server holds a complete view of the network. Every figure the service
publishes carries the evidence for it: which servers contributed, how many were
healthy, and when the last successful update happened.

## Status

Design stage. Nothing is built yet. The documents below are the design, and the
capability probe behind them has been run against real servers rather than
assumed.

| Document | What it covers |
|---|---|
| [docs/design.md](docs/design.md) | Architecture, schema, budgets, API |
| [docs/methodology.md](docs/methodology.md) | What the numbers mean, for readers of the site |
| [docs/privacy.md](docs/privacy.md) | Data stored, retention, deletion, opt-out |
| [docs/probe-2026-08-27.md](docs/probe-2026-08-27.md) | What the APIs actually do, measured |
| [docs/decisions.md](docs/decisions.md) | Decisions, costs, and what would change them |

## How it will work

```
                    ┌─────────────────┐
   every minute     │ instance        │  host, software, capability,
   cron ───────────▶│ registry        │  health, opt-out, mask bit
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐  picks tag/instance pairs due now,
                    │ scheduler       │  batches quiet tags with any[]
                    └────────┬────────┘  <= 48 requests per tick
                             ▼
                    ┌─────────────────┐  GET /api/v1/timelines/tag/:t
                    │ collector       │  ?any[]=…&min_id=cursor
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐  keep uri, permalink, origin host,
                    │ normalise       │  author hash, timestamps, flags.
                    └────────┬────────┘  discard content and media
                             ▼
                    ┌─────────────────┐  merge every instance's view of this
                    │ dedupe + merge  │  tick in memory, keyed on uri
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐  observation, 25 hour retention
                    │ D1              │  minute rollups, poll log
                    └────────┬────────┘
                 ┌───────────┼───────────┐
                 ▼           ▼           ▼
            public API    web UI    status page
```

One Worker holds all of it. The cron handler collects, the fetch handler serves.

## The three findings that shaped it

**Public hashtag timelines are not universally public.** One probed server
returns `422 This method requires an authenticated user` while a 4.7.0 server
beside it allows the same request. Capability has to be probed per instance and
re-probed, never inferred from software version.

**Tag metadata survives where timelines do not.** `/api/v1/tags/:id` answered on
every Mastodon host tested, including the one refusing timelines, with seven days
of daily post and distinct-author counts. That gives cold tags an immediate
answer and reaches servers the collector cannot otherwise read.

**Overlap between servers is the coverage measurement.** Reading one tag from
three servers at once returned 40 posts from any single server and 50 unique
posts from all three. The duplication is not waste. A post seen by seven of eight
servers sits in the well-connected middle of the network, and a post seen by one
sits at the edge, which is how the service can describe its own blind spots
instead of guessing at them.

Details and figures in [docs/probe-2026-08-27.md](docs/probe-2026-08-27.md).

## What it stores

Per public post observed, per hashtag: the ActivityPub object id, the permalink,
the origin server, a salted hash of the author handle, two timestamps, a bitmask
of which servers reported it, and the language and sensitive flags. That is the
complete list.

It stores no post text, no media, no display names and no readable handles.
Records expire after 25 hours. Servers can opt out, and so can authors. See
[docs/privacy.md](docs/privacy.md).

## Running it

Not yet runnable. When it is, the shape will follow the sibling `mastodon/`
project: `wrangler dev` for local work, D1 migrations under `migrations/`,
`vitest` for tests and a separate live probe suite for checks against real
servers.

The capability probe can be run today:

```
zsh scripts/probe.sh
```

## Cost

Free to use, and free to run if you want it to be.

The parse cost was measured rather than assumed: a real 210 KB response of 40
statuses takes 0.268 ms to parse and normalise, including a SHA-256 per author.
A typical collection tick costs 2.3 ms of CPU, because cursors mean most polls
return little or nothing.

That puts the whole workload under two per cent of every Workers Paid included
allowance, so on a five dollar subscription it adds nothing. It also fits the
free tier, provided the collector caps how many bytes it parses per tick and
defers the rest to the next one. Cursors make deferring safe.

The status page reports which plan and which parse budget are in effect. See
[docs/design.md](docs/design.md) for the figures.

## Principles

- Public posts only, never private, followers-only, unlisted or direct.
- Respect rate limits, terms and server policies. Identify the collector on every
  request, and never disguise it.
- Server opt-out honoured on the next collection tick. Author opt-out where
  technically possible.
- Store links, not copies. Keep the minimum needed to count.
- No ranking of individuals, no leaderboards, no activity presented as influence.
- Publish the coverage, the methodology and the source, so the claims can be
  checked rather than trusted.
