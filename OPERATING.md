# Operating

## Deploying it the first time

```
npx wrangler d1 create fediverse-hashtag-index
```

Paste the returned id into `wrangler.jsonc`, replacing
`PLACEHOLDER_RUN_WRANGLER_D1_CREATE`. Then:

```
npx wrangler secret put AUTHOR_SALT      # openssl rand -hex 32
npm run db:remote                        # apply migrations
npm run deploy
```

Before going public, set two things in `wrangler.jsonc` that ship as
placeholders. `CONTACT` has to be an address a person actually reads, because it
is the opt-out route published on the coverage page. `COLLECTOR_USER_AGENT` has
to name the service and point at a URL explaining what it is. Both are promises
made on the coverage page, so neither should stay as `example.invalid`.

## The salt

`AUTHOR_SALT` is what lets the index count distinct authors without holding a
list of handles. Two consequences worth knowing before you touch it.

Rotating it breaks continuity. Every author hash changes, so distinct-author
counts restart and the author suppression list stops matching the people on it.
If you ever have to rotate it, the suppression list has to be rebuilt from the
original opt-out requests.

Losing it is survivable. Nothing decrypts with it and no historical data becomes
unreadable, because it only ever produced hashes. Retention is 25 hours, so a new
salt costs you a day of author counts and nothing else.

## What it costs

Nothing beyond the five dollar Workers Paid subscription. Requests, CPU and
storage are all under two per cent of their allowances. Writes are the one that
uses a meaningful share, at around 30%, and they get their own section below.

It does not fit the D1 free tier in this configuration, at roughly 480,000 writes
a day against an allowance of 100,000. Note what going over means there: the free
tier blocks rather than bills, returning errors until midnight UTC, so the
consequence is a stalled collector and not a charge. A free deployment is possible
but it is a smaller service, and the workings are in
[docs/design.md](docs/design.md#what-the-platform-actually-costs).

## The two dials that matter

`MAX_REQUESTS_PER_TICK` is 43, and the arithmetic behind that number is load
bearing. The Workers free tier allows 50 external subrequests per invocation, and
everything a tick does counts towards the same 50. A tick can also probe one
instance, which costs up to five requests. So 43 collect, 5 probe, 2 spare. If
you raise it on Workers Paid, keep the probe allowance in the sum.

`MAX_PARSE_BYTES_PER_TICK` is 2 MB, which keeps a tick inside the 10 ms of CPU the
free tier allows per cron trigger, and is far below anything Workers Paid cares
about. When the budget is reached the collector stops and defers the
remaining jobs to the next tick, which is safe because `min_id` cursors mean
nothing is lost by reading a tag a minute later. The tick report says how many
were deferred. On Workers Paid you can raise this well past any real tick.

## Watching it

```
npm run tail
```

Every tick logs one JSON line. The fields to watch:

- `jobsDeferred` above zero every tick means the parse budget is too tight for
  the tag set, so either raise it or reduce the hot tier.
- `hostsFailed` climbing means instances are struggling. The status page shows
  which and why.
- `observationsWritten` close to `postsObserved` means little overlap between
  servers, which is worth understanding: it usually means coverage is thinner
  than it looks. Healthy overlap shows as `written` well below `posts`.

The status page at `/status` is the same information for anyone, not just you.
It is published on purpose: an index making claims about its coverage should show
its own failures.

## Adding a server

Add a row to the `instance` table with the next free `bit`. Capability is left
alone, so the probe classifies it on a later tick and nothing is collected from
it in the meantime.

```
npx wrangler d1 execute fediverse-hashtag-index --remote --command \
  "INSERT INTO instance (host, bit, added_at) VALUES ('example.social', 9, unixepoch())"
```

Bits must be unique and below 52. The ceiling is JavaScript's rather than
SQLite's: D1 returns integers as numbers, exact only to 2^53, and a mask read
back inexactly would corrupt every coverage figure derived from it.

## Handling a server opt-out

One column, and it takes effect on the next tick.

```
npx wrangler d1 execute fediverse-hashtag-index --remote --command \
  "UPDATE instance SET opt_out = 1, opt_out_reason = 'admin request 2026-08-27' \
   WHERE host = 'example.social'"
```

Polling stops immediately. Observations attributed to that server are removed at
the next hourly sweep. The server then appears on the coverage page as opted out,
so its absence is visible rather than silent, and it is never re-added without a
request from the server itself.

A server that serves a `robots.txt` disallowing the collector is opted out
automatically at its next weekly probe, with no action needed here.

## Handling an author opt-out

The suppression list holds hashes only, so an opt-out needs the salt to compute
the hash. There is no admin endpoint for this yet, which is a gap: for now it is
a scripted `d1 execute` against the hash of the handle, and building a small
guarded endpoint is the obvious next piece of work.

The hash is the first sixteen bytes of `SHA-256("<salt> <lowercased handle>")`.
Note the single space between salt and handle, matching `authorHash` in
`src/normalise.ts`.

## When something looks wrong

The design rests on several claims about what Mastodon's APIs do. If counts go
strange, check those claims before reading the code:

```
npm run probe
```

That suite makes real requests and verifies each one, including the important
one: that `min_id` paginates forward rather than filtering. If that ever
reversed, advancing a cursor past a full page would skip posts silently, which is
the worst failure this service could have.

## Watching the write budget

Writes are the only allowance this service uses a meaningful share of: roughly
480,000 rows a day at fourteen tracked tags, about 15 million a month against the
50 million included on Workers Paid.

The figure scales with the tracked set, which is capped at 150. At that ceiling
expect 40 to 45 million a month, which is inside the allowance but not by much.
Two dials, in the order to reach for them:

1. `MAX_CANDIDATE_WRITES_PER_TICK`, default 60. Setting it to 0 turns discovery
   off entirely and takes off up to 86,000 writes a day.
2. The cron interval. Five minutes instead of one divides everything by five.

`rollupBuckets` in each tick log is the figure to watch, because it is the one
that scales with tags rather than with polls.

## Known gaps

- No admin endpoint for author opt-out, as above.
- No alerting. Failures are visible on `/status` and in `wrangler tail`, and
  nothing tells you to go and look.
- Collection is currently **paused**: `triggers.crons` is an empty list in
  `wrangler.jsonc`. Restore `["* * * * *"]` and deploy to resume.
