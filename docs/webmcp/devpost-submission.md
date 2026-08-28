# Devpost submission text

Ready to paste. Each block below maps to a field on the Devpost form. The
"About the project" block covers Devpost's own prompts (inspiration, what we
learned, how it was built, challenges) and the four things the official rules
say the description must explain, under headings a judge can tick off.

Keep the figures current: check the live site before pasting, and replace any
number that has moved.

---

## Elevator pitch (200 characters)

Nobody can count the whole fediverse. This index shows what it can see, and its WebMCP tools let agents answer with the evidence attached, or refuse honestly.

---

## About the project

## Inspiration

Every hashtag counter on the web gives you a number. Almost none of them tell
you where it came from, how much of the network it covers, or when it stopped
being trustworthy. On the fediverse that problem is structural: there is no
central server, so no complete count of anything can exist. Any figure is a
view from somewhere.

The Fediverse Hashtag Activity Index was built around that fact. It polls
public hashtag timelines on a small set of Mastodon-compatible servers,
deduplicates what it sees, and publishes every figure together with its
provenance: which servers contributed, how many were healthy, how many saw a
typical post, and when the last successful update was. When two periods were
not covered by comparable slices of the network, it refuses to call a trend.

Then agents started reading web pages. An agent that scrapes a number keeps
the number and drops the caveats, and the caveats were the whole point. WebMCP
was the chance to hand an agent the evidence directly, in a shape it cannot
quietly discard.

## Why this use case is a strong fit for WebMCP

WebMCP lets a page offer structured tools instead of leaving an agent to
interpret the HTML. For most sites that saves the agent some clicking. For this
one it changes what the agent can honestly say. A tool result that carries
`provenance` as a required field, a `standing` that separates observed data
from sightings from the servers' own counters, and a `status` that can be
`insufficient_data` with a reason, gives the agent something a screen-read
never could: a calibrated answer.

The tools also refuse well. Asked about a tag the index is not collecting, the
result says so, explains that the tracked set is at its ceiling, says the
request has been queued, and offers the servers' own weekly counters labelled
as a different kind of evidence. In testing, ChatGPT's browser turned that into
"there's no reliable activity estimate yet ... but that's not evidence the tag
is unused across the fediverse", which is exactly the sentence we wanted a
person to hear.

## How it creates a better user experience

Five tools, designed backwards from six things a person would actually say to
an agent while on the site.

- **"I'm writing this post, which hashtags fit it best?"** The agent reads the
  draft and proposes candidates, because language is what it is good at. It
  then calls `evaluate_hashtags`, which reports how many distinct accounts used
  each tag, across how many servers, and whether that looks like a conversation
  or a few accounts posting a lot. For tags the index has never seen, it asks
  two servers for their own counters, so a niche hobby tag gets a real answer
  rather than a shrug.
- **"Compare #news and #photography."** `compare_hashtags` takes the person to
  `/compare?tags=news,photography`, a page anyone can open, share or reach from
  a form, with hourly sparklines and a warning when the tags' evidence is not
  like for like. The agent and the person are looking at the same URL.
- **"What's trending?"** `trending_hashtags` ranks the tracked set by distinct
  authors, not post volume, and attaches a direction that can be
  `not_comparable` when coverage shifted between hours. Two recent public posts
  per tag serve as receipts.
- **"Tell me about #photography."** `lookup_hashtag` gives the full picture and
  moves the page to the tag. It is the one tool with a side effect, because a
  lookup is a search that can start collection, and both the description and
  the result say so.
- **"How much of the fediverse can you actually see?"** `describe_coverage`
  lists the monitored servers, their capabilities and the known limits, and
  tells the agent how to phrase any claim: "observed by this index across eight
  monitored servers", never "across the fediverse".

## What people and agents can do together that was difficult before

A person can ask a question in their own words and get an answer with the
working attached, on a page they can check for themselves. That was not
possible when the agent's only route was reading the page: the caveats did not
survive the trip. Now the agent can say "this figure is thin, here is why, here
is what would change it", and the person can see the same thing on screen.

It also protects the site from its helpers. A lookup counts as a signal that
promotes a tag towards collection. An agent evaluating ten candidates in a
second would have sent ten signals and walked past the tracked-set ceiling. The
evaluate and compare tools use a separate read-only path that registers
nothing, and every result reports its side effects so the agent can tell the
person what the call did.

## How WebMCP was implemented

One script, served inline from the shared layout, feature-detected so browsers
without a model context run nothing. It registers five tools on
`document.modelContext` (falling back to `navigator.modelContext` where only
the older form exists). Each tool's `execute` is a `fetch` to the site's own
JSON API; no judgement lives in the browser that is not already in the tested
server code. Two new read-only endpoints were added for the agent use cases,
`/api/v1/evaluate` and `/api/v1/trending`, plus the `/compare` page. A
`/webmcp` page reports what the visiting browser exposes, which is how we
found that ChatGPT's browser provides only `document.modelContext` and that
Chrome now deprecates the `navigator` form.

The design notes, the six utterances with the replies we designed against,
and the verification record for both judging browsers are in the repository
under `docs/webmcp/`.

## Challenges and what we learned

The tool description is the routing layer. Our first "compare" request went to
`evaluate_hashtags`, because it read as the general tool. Each description now
names the other tool for the other job, and leads with the verbs a person uses.

Overlaying a result onto whatever page is open looks clever and reads as a
hack. We replaced an injected comparison table with a real page whose URL is
the state, which is how the rest of the site already worked.

Honest and useful are not the same thing. "No evidence either way" for every
candidate in a niche post was honest and useless. Asking the servers themselves
turned it into an answer, without giving up the distinction between observed
and reported figures.

## Prior work and work during the Submission Period

The index, its API, pages, collector and tests existed before 25 August 2026.
Everything under `docs/webmcp/`, `src/webmcp.ts`, `src/suggest.ts`,
`src/trending.ts`, the two new endpoints and the compare page were built during
the Submission Period. The commit record and dates are in
`docs/webmcp/README.md`, and the full diff is the repository's
`build-mvp...webmcp` compare view.

---

## Built with

cloudflare-workers, cloudflare-d1, typescript, webmcp, mastodon-api, vitest, wrangler

---

## "Try it out" links

- https://fediverse-hashtag-index.neil-charlton.workers.dev
- https://fediverse-hashtag-index.neil-charlton.workers.dev/webmcp
- https://fediverse-hashtag-index.neil-charlton.workers.dev/compare?tags=news,photography,art
- https://github.com/nhc/fediverse-hashtag

---

## Testing instructions

No login or credentials are needed. Open any page of the live site in
ChatGPT's in-app browser, or in Chrome 149 or later with
`chrome://flags/#enable-webmcp-testing` enabled. Ask the assistant, in your own
words, any of the following:

- "I'm writing this post, which hashtags fit it best?" followed by a short draft.
- "Compare #news and #photography over the last day."
- "Which hashtags are trending right now?"
- "Tell me about #photography." Then "Tell me about #obscurewheelthrowing" to see a refusal.
- "How much of the fediverse can you actually see?"

Open `/webmcp` in any browser to see what it exposes and which tools registered.
