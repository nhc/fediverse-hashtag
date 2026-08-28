# WebMCP: goals, reasons, and how we are going about it

This directory holds the design for exposing the index to browser-resident AI
agents through WebMCP (`navigator.modelContext`). It is written for two
audiences: us, when we come back to it in a month, and anyone judging or reading
the challenge entry who wants to know why the tool surface looks the way it does.

- [tools.md](tools.md): the five utterances we designed against, and the
  `lookup_hashtag` schema that sets the pattern for the rest.

## What WebMCP is, in one paragraph

WebMCP is a draft W3C Community Group spec. A page calls
`navigator.modelContext.registerTool({ name, description, inputSchema, execute })`
in ordinary JavaScript. An agent running in the browser (ChatGPT Atlas, and
Chrome behind a flag at the time of writing) can then call those tools directly
instead of reading the page's HTML or clicking through its forms. The page and
the agent share a tab, so a tool can change what the person is looking at. That
last property is the one that makes it different from a JSON API.

## Goals

1. **An agent gets the same honesty a person gets.** Every figure on this site
   travels with its provenance: which servers contributed, how many were
   healthy, when the last successful update was, and whether the coverage is
   good enough to trust. An agent scraping the HTML would keep the number and
   drop the caveats. The tools make that impossible by returning the caveats as
   structured fields the agent has to carry.

2. **The tools can say no, and say why.** The index already refuses to publish
   trends when two windows did not see comparable slices of the network
   (`isCoverageComparable` in `src/aggregate.ts`), and grades every count as
   `good`, `partial` or `thin` (`coverageQuality`). The tool results expose those
   decisions as a first-class `status`, so an agent can tell a person "I can't
   compare those honestly, and here is what would change that" instead of
   inventing a confident answer.

3. **The person and the agent see the same thing.** At least one tool renders
   into the page rather than just returning JSON. Asking the agent to compare two
   tags should put a comparison in front of the person, so they can check the
   agent's summary against the evidence without leaving the tab.

4. **Nothing the site already promises gets weakened.** Read-only Worker, the
   tracked-set ceiling, the write budget, the opt-out route, the privacy
   commitments in `docs/privacy.md`. If WebMCP needs any of those relaxed, WebMCP
   loses.

## Reasons

### Why this project, and not a fresh demo

The hard part of a WebMCP entry is having something worth calling. The JSON API
in `src/api.ts` already exists, is deployed, costs nothing to run, and is
documented. A tool's `execute` is a `fetch` to our own origin. The work is in
the design of the surface, not the plumbing, which is where we want to spend the
time anyway.

### Why "honest data" is the angle

Most entries will be sites where an agent does something on the person's
behalf: book, filter, buy, fill a form. Those are good demos, and we cannot
compete with them on that ground; there is nothing to book here. What we have
that they do not is a data source built around the fact that it cannot see the
whole network and says so at every turn. "Agent gives a calibrated answer and
shows its working" is a story about what tools are *for*, and it is one very few
entries can tell.

### Why a lookup is not a pure read, and why that matters here

`buildTagData` registers every lookup as a query. Queries are the signal that
promotes a tag to a faster polling tier and, if there is capacity under the
tracked-set ceiling, starts collecting it. This was deliberate: a person
searching for a tag is telling the index that tag matters.

An agent is not a person. An agent asked "what's the fediverse talking about?"
might look up thirty tags in a second, and each one would count as a signal.
Two consequences for the design:

- `lookup_hashtag` results say plainly whether the lookup caused the tag to be
  tracked, so the agent (and person) know the call had a side effect.
- The tool description tells the agent that a lookup is a request to watch the
  tag, and that browsing should use `trending_hashtags` (which reads the
  already-tracked set and registers nothing). Whether we also rate-limit or
  de-weight agent-originated queries is an open question, recorded below.

### Why four tools and not one per endpoint

We wrote down five things a person would plausibly *say* to an agent while on
the site, and asked what each one needed. Five utterances resolved to four
tools. `/api/v1/instances` and `/api/v1/meta` did not come up in any of them,
so they are not tools; fewer, better-described tools help the agent choose
correctly. If an utterance turns up that needs them, they can be added.

### Why no write path

"Watch this tag for me" is the obvious human-in-the-loop demo and we are not
building it. The Worker is read-only, the tracked set has a hard ceiling, and
`docs/decisions.md` records why. A hackathon is not a reason to undo that. If
we ever do it, it goes behind an explicit confirmation in the page, not an
agent's say-so.

## Process

Working backwards from use, in this order:

1. **Utterances before schemas.** Five things a person would say, with the reply
   we would want an agent to give, written as prose. These are in `tools.md` and
   double as the script for the demo video.
2. **One tool to set the pattern.** `lookup_hashtag`, with the result shape that
   every other tool inherits: `status`, the figure, and `provenance` as a
   required sibling, never optional. Its refusal branch is designed before its
   success branch.
3. **Register in the shared layout.** One `<script>` in `src/ui.ts`, feature-
   detected, so browsers without `navigator.modelContext` are unaffected and the
   HTML form stays the human path.
4. **Test against a deployed URL**, not `wrangler dev`. `navigator.modelContext`
   is only available in secure contexts, and the interesting failures (thin
   coverage, cold tags, the tracked-set ceiling) only happen with real data.
5. **The in-page tool second**, `compare_hashtags`, because it is the one that
   demonstrates shared page state and earns the "human-agent experience" score.
6. **Then `trending_hashtags` and `describe_coverage`.**
7. **Record the video around the five utterances.** The refusal must be in it.

Each step is a commit on the `webmcp` branch, worktree at
`../fediverse-hashtag-webmcp`, off `build-mvp`.

## Open questions

- Should agent-originated lookups count as full query signals, or be
  de-weighted? We can tell them apart (the tool sets a header or query flag).
  Decide after seeing what agents actually do in testing.
- Does the spec's `execute` return shape want `content: [{type: 'text'}]` with
  JSON stringified inside, or does it accept structured content yet? Pin against
  the WebMCP-org examples repo at build time, not memory.
- Is one in-page tool enough, or does `lookup_hashtag` also navigate the tab to
  `/tag/:name`? Leaning yes: cheap, and it keeps the person and agent aligned.

## Challenge requirements, for reference

Live app, public repo, project description, demo video under three minutes.
Judged on usefulness, originality, execution, thoughtful use of WebMCP, and the
quality of the human-agent experience. Rules at <https://webmcp.devpost.com/rules>.
