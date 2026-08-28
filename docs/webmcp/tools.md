# WebMCP tools: five utterances, and the `lookup_hashtag` schema

The utterances came first. Each is something a person might say to a browser
agent while on this site. The reply is what we would want the agent to say
back, given only what the tool returned. If a reply needed information the tool
did not give, the tool changed. Read [README.md](README.md) for why.

Six utterances, five tools:

| Tool | Registers a query? | Renders in page? |
|---|---|---|
| `lookup_hashtag` | yes, like a search does; the result says so | navigates to `/tag/:name` after returning |
| `compare_hashtags` | yes, for each tag | yes, a comparison view |
| `trending_hashtags` | no | no |
| `describe_coverage` | no | no |
| `evaluate_hashtags` | no | no |

## The utterances

### 1. "Is #eurovision busy right now?"

**Tool:** `lookup_hashtag({ tag: "eurovision" })`

**Reply we want:**

> Fairly busy. In the last hour this index saw 212 posts from 148 different
> accounts using #eurovision, across 31 origin servers. That is up on the
> previous hour, and the two hours are comparable so the trend is sound.
> Coverage is good: a typical post was seen by 6 of the 9 servers being
> monitored, and the last successful update was 3 minutes ago.
>
> Bear in mind this is what the index can see from those 9 servers. It is not a
> count across the whole fediverse; nobody has one.

**What the reply needs from the tool:** posts and authors for a window, origin
server count, trend with a comparability flag, coverage quality with the median
seen / monitored figures behind it, freshness, and the standing statement.

### 2. "Compare #cats and #dogs over the last day"

**Tool:** `compare_hashtags({ tags: ["cats", "dogs"], window: "24h" })`

**Reply we want:**

> I've put a side-by-side on the page. Over 24 hours, #cats had 1,840 posts from
> 1,102 accounts and #dogs had 1,215 from 790, so cats lead on both. The
> posts-per-author figures are close (1.7 and 1.5), so neither is being carried
> by a handful of heavy posters. Both have good coverage from the same 9
> monitored servers, so the comparison is fair.

**Status: built, and this is the hero exchange.** In ChatGPT's browser
(28 Aug 2026, 13:38 UK) the agent chose `compare_hashtags`, a table with
hourly sparklines appeared at the top of the page beside the chat, and the
reply opened "Comparison is displayed in the browser" before contrasting 18.7
posts per author against 1.8. Asked "why have you not used WebMCP?" it
answered, correctly, that it had.

**What it took.** The first attempt failed silently: the agent picked
`evaluate_hashtags` for "compare", so nothing rendered. Each description now
names the other tool for the other job, and `compare_hashtags` leads with the
verbs a person uses (compare, versus, side by side). The rendered table is also
kept in `sessionStorage` for ten minutes and redrawn on the next page in the
tab, with a Remove control, because this agent navigates after it calls. The
lesson for anyone building WebMCP tools: the description is the routing layer,
and a tool that overlaps another needs to say so in both places.

**What this adds:** the tool must render the comparison into the current tab,
not only return numbers. The reply also leans on `posts_per_author`, which the
site already publishes so readers can tell a conversation from one person
shouting.

### 3. "What's rising in the last hour?"

**Tool:** `trending_hashtags({ window: "1h", limit: 5 })`

**Reply we want:**

> Ranked by distinct authors, not post count, so a tag one account is spamming
> does not float to the top. Rising in the last hour among the tags this index
> is watching: #eurovision (148 accounts), #ukpolitics (61), #caturday (44),
> #photography (39), #fediblock (22). Each of those is up on the previous hour
> with comparable coverage. Here are two recent public posts for #eurovision if
> you want to see what it looks like: [links].
>
> This is only across the ~50 tags being tracked. It is not a global trending
> list.

**What this adds:** this is discovery over the tracked set, so it registers no
queries. It carries the ranking note and links to real posts as evidence. It
must be clear the list is of tracked tags, not the fediverse.

### 4. "How much of the fediverse can you actually see?"

**Tool:** `describe_coverage()`

**Reply we want:**

> Not much of it, and it says so. The index polls 9 servers, 8 of which are
> currently healthy; one is backing off after failures. It watches up to 50
> hashtags at a time, chosen by how many different accounts use them. Posts are
> deduplicated across servers, so a post seen on three of them counts once. It
> honours robots.txt as an opt-out and stores no post content, only that a post
> existed and where. Methodology is at /coverage.

**What this adds:** nothing numeric about tags. This tool exists so an agent
learns the limits before it makes claims, and so utterance 5 has a
"what would change it" to point at.

### 5. "Can you tell me about #obscuretag?"

**Tool:** `lookup_hashtag({ tag: "obscuretag" })`

**Reply we want:**

> I can't give you a reliable figure for that one. The index wasn't watching
> #obscuretag until just now: your question has registered it, and it is now
> queued for collection, but there is nothing observed yet. Two of the monitored
> servers report their own daily counters for it, 4 uses yesterday and 3 the day
> before, and I can show those, but they come from a different source at a
> different granularity and aren't comparable to the live figures for other
> tags. Ask again in an hour or so and there should be something real.

Or, when the tracked set is full:

> The index polls at most 50 hashtags and is at that limit, so #obscuretag is
> not being collected. Your lookup has recorded it as requested and it goes to
> the front of the queue when a slot frees up. [daily counters as above]

**What this adds:** the refusal branch. `status` is not `ok`, there is a
`reason`, a `what_would_change_it`, and the side effect (registered, tracked or
not) is stated. The separately-sourced daily history is labelled as such.

### 6. "I'm writing a post, which hashtags fit it best? [text]"

**Tool:** `evaluate_hashtags({ candidates: [...] })`

The index stores no post content, so it cannot read the draft. The split is:
the agent reads the text and proposes candidates, because language is what it
is good at; the index says what it has seen of each, because evidence is what
it has. The tool description says this outright so the agent does not send the
post text and expect matching.

**Reply we want:**

> From the draft I'd consider #caturday, #cats, #catsofmastodon, #tabby and
> #adoptdontshop. Checking those against what the index can see:
>
> - #cats: 1,102 different accounts in 24 hours across 9 servers, about 1.7
>   posts each, so a broad conversation. 40 accounts in the last hour.
> - #catsofmastodon: not polled, but seen from 61 accounts across 7 servers
>   alongside tracked tags in the last two days. Sightings are a lower bound.
> - #caturday: 44 accounts in the last hour, so it's live right now.
> - #tabby: 3 accounts, 90 posts, one server. That's a few accounts posting a
>   lot, not a conversation; it may not get you seen.
> - #adoptdontshop: the index hasn't seen it at all. That doesn't mean nobody
>   uses it, only that none of the 9 monitored servers showed it on the tags
>   being watched.
>
> I'd go with #cats and #caturday for reach and #catsofmastodon for the
> community. None of these lookups registered a search or changed what the
> index watches.

**What this adds:** a read that must not be a signal. Evaluating ten
candidates through `lookup_hashtag` would register ten queries and could start
tracking ten tags. So this is a separate endpoint, `/api/v1/evaluate`, that
reads tracked observations and the discovery pool and writes nothing, and the
result says `side_effects.queries_registered: 0`. Each candidate carries a
`standing` (`tracked`, `discovered`, `unseen`) with a note on what the figures
beside it mean, because sightings from the discovery pool and observations from
polling are different evidence and must not be read as the same number.

Status: built and tested live in both judging browsers (28 Aug 2026).

**What happened in ChatGPT's browser.** Given a pottery draft, the agent
proposed ten candidates itself, made one tool call, and reported them as
"unseen ... no activity evidence to rank them; that does not mean the tags are
unused across the wider Fediverse". Exactly the framing wanted. But all ten
*were* unseen, because the discovery pool only holds tags that co-occurred with
the 50 tracked tags on 8 servers in 48 hours, and an entire hobby community can
sit outside that. Honest, but useless for the long tail.

**Fallback added.** For `unseen` candidates the endpoint asks two servers for
their own daily counters (the same `/api/v1/tags/:name` path a cold search
uses), fetched live and cached in the Worker's HTTP cache for six hours. No D1
row is created, because minting a tag id is the query signal this tool must not
send. The result appears under `server_reported` with its own note, and the
reading becomes "Not seen by this index, but 2 servers asked directly report
about 20 accounts using it in the last seven days. Server-reported, not
observed." Totals are summed across servers without deduplication and say so.

**Re-run after the fallback** (ChatGPT browser, 13:16 UK): the agent
recommended `#Pottery #Ceramics #WheelThrown #Stoneware #Celadon #MastoArt`,
gave `#Art` as an optional broad-reach tag with its observed figures (385
authors, 112 servers), described the niche tags from "the index's
server-reported seven-day data" by name, and advised skipping
`#HandmadePottery` because it is tracked but had no recent activity. Every
distinction the result encodes reached the person. This is the exchange to
show in the video.

**Asked "which hashtags are trending?"** with no tool for it, the agent
navigated to `/tags`, read the page, and gave correct figures with the
monitored-servers caveat intact. No fabrication. So `trending_hashtags` earns
its place through structured provenance and comparability, not by rescuing a
wrong answer, which moved it down the build order.

## Build status, 28 August 2026

All five tools are built, deployed from `build-mvp`, and registered on every
page. `evaluate_hashtags`, `trending_hashtags` and `compare_hashtags` are
verified end to end in both judging browsers (see the notes under each
utterance). `lookup_hashtag` is verified in ChatGPT's browser on both branches (28 Aug,
14:55 UK): "Tell me about #photography" produced the figures across all three
windows, "the 24-hour trend can't be compared reliably because prior coverage
differed", "only a partial view of the fediverse", and "the lookup also
confirmed #photography is already tracked and took you to its tag page".
"Tell me about #obscurewheelthrowing" produced the refusal: not collected
because the index is at its 50-tag limit, the lookup recorded it and queued
it, the two servers' counters show zero, "but that's not evidence the tag is
unused across the fediverse". `describe_coverage` verified 14:59 UK: the agent named the eight servers,
treated the tags-only server as corroboration, and used the tool's phrasing
line verbatim: "activity observed by this index across 8 monitored servers,"
not "across the fediverse", adding that "there's no reliable way to calculate
the missing share". All five tools are now verified in ChatGPT's browser.

Noted for later, outside WebMCP: the tag page's Coverage panel grades a tag
with zero observations as "thin", in red. Nothing observed is not thin
coverage; it should say so instead.

## `lookup_hashtag`

The first tool, and the one whose result shape the others inherit. Two
invariants: `provenance` is required on every result, including refusals, and
`status` is the first thing an agent should read.

### Registration

```js
navigator.modelContext.registerTool({
  name: 'lookup_hashtag',
  description:
    'Look up recent public activity for one hashtag as observed by this index ' +
    'across the Mastodon-compatible servers it monitors. Returns counts with ' +
    'their provenance (which servers, how healthy, how fresh) and a coverage ' +
    'grade. Read `status` first: `insufficient_data` means no reliable figure ' +
    'exists yet and `reason` says why. Figures are what this index can see, ' +
    'not a count across the fediverse. Note: a lookup is treated as a request ' +
    'to watch the tag and may start collection for it. To browse what is ' +
    'already being watched, use trending_hashtags instead. Navigates the page ' +
    'to the tag.',
  inputSchema: {
    type: 'object',
    properties: {
      tag: {
        type: 'string',
        description: 'The hashtag, with or without the leading #. Case-insensitive.',
        minLength: 1,
        maxLength: 100,
      },
      window: {
        type: 'string',
        enum: ['1h', '6h', '24h'],
        default: '24h',
        description: 'Which window to headline. All windows are returned regardless.',
      },
    },
    required: ['tag'],
  },
  async execute({ tag, window = '24h' }) { /* see below */ },
});
```

### Result shape

```ts
type LookupResult = {
  status: 'ok' | 'insufficient_data' | 'invalid_tag';
  tag: string;                    // normalised
  display: string;                // as the person typed it
  as_of: string;                  // ISO 8601
  statement: string;              // the standing "observed by this index" sentence

  // Present when status is not 'ok'.
  reason?: string;
  what_would_change_it?: string;

  // Present when status is 'ok'. Same shape for every window.
  headline?: WindowFigures;       // the requested window
  windows?: Record<'1h' | '6h' | '24h', WindowFigures>;

  // Always present. Never optional. This is the point.
  provenance: {
    instances_monitored: number;
    instances_healthy: number;
    last_successful_update: string | null;   // ISO 8601
    coverage: 'good' | 'partial' | 'thin';
    median_instances_seeing_a_post: number | null;
    origin_servers_24h: number;
    poll_interval_seconds: number;           // the effective one, not the tier's
    completeness: 'partial';                 // always; there is no 'complete'
  };

  // What this call did. Always present.
  side_effects: {
    query_registered: true;
    tracked: boolean;
    capacity_note: string | null;   // set when the tracked set is full
    newly_tracked: boolean;         // this lookup caused tracking to start
  };

  // Present when the index has no observations but servers report their own
  // daily counters. Labelled separately; never merged with the live figures.
  server_reported_history?: {
    note: string;
    source_servers: string[];
    days: Array<{ day: string; uses: number; accounts: number }>;
  };

  page: { navigated_to: string };  // '/tag/eurovision'
};

type WindowFigures = {
  posts_observed: number;
  authors_observed: number;
  posts_per_author: number | null;
  origin_servers: number;
  trend: {
    direction: 'up' | 'down' | 'flat' | 'not_comparable';
    previous_posts_observed: number;
    // When false, direction is 'not_comparable' and reason explains it.
    comparable: boolean;
    reason?: string;
  };
};
```

### Refusal rules

`status: 'insufficient_data'` when the 24h window has zero observed posts. This
covers both a brand new tag and one that is registered but not tracked because
the set is full. `reason` distinguishes them and `what_would_change_it` says
"ask again after the next collection" or "a slot freeing up" accordingly.
`server_reported_history` is included when available.

`trend.comparable: false` is not a refusal of the whole result, only of the
trend. The counts are still published with their provenance; the agent is told
it cannot say "up" or "down".

`status: 'invalid_tag'` mirrors the API's 400.

### `execute`

Thin. Fetch `/api/v1/tags/:tag` from the same origin with a marker so we can
tell agent lookups apart later, map the API payload onto the shape above,
navigate the tab to `/tag/:tag`, and return the object stringified in a text
content block (pending confirmation of what the spec accepts for structured
content). No logic that is not already in `src/api.ts` or `src/aggregate.ts`;
if the tool needs a judgement the API does not make, the judgement moves into
the API where it is tested.

## Not in scope, for now

- `/api/v1/instances` and `/api/v1/meta` as tools. No utterance needed them.
- Any tool that writes beyond what a search already does.
- Per-post content. The index does not store it, so a tool cannot return it.
