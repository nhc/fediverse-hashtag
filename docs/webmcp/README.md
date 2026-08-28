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
- Anything that evaluates many tags at once (`evaluate_hashtags`) goes through
  a separate read-only endpoint, `/api/v1/evaluate`, that registers nothing.
- The tool description tells the agent that a lookup is a request to watch the
  tag, and that browsing should use `trending_hashtags` (which reads the
  already-tracked set and registers nothing). Whether we also rate-limit or
  de-weight agent-originated queries is an open question, recorded below.

### Why four tools and not one per endpoint

We wrote down five things a person would plausibly *say* to an agent while on
the site, and asked what each one needed. Six utterances resolved to five
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

   `evaluate_hashtags` was built first in practice, out of order, because it
   was the utterance that arrived with the clearest need and it forced the
   read-only endpoint pattern the others can reuse.
7. **Record the video around the five utterances.** The refusal must be in it.

Each step is a commit on the `webmcp` branch, worktree at
`../fediverse-hashtag-webmcp`, off `build-mvp`.

## Prior work and work during the Submission Period

This project existed before the challenge opened on 25 August 2026. Under the
rules it is judged only on WebMCP work added after that date, so the line is
drawn here.

**Prior work** (all commits before 25 August 2026, on `main`/`build-mvp`): the
collector, scheduler, instance registry, D1 schema and migrations, the JSON API
under `/api/v1/`, the server-rendered pages, the methodology and privacy
documents, and the test suite. None of it involved WebMCP or any agent tooling.

**Work during the Submission Period** (branch `webmcp`, from 28 August 2026):

| Commit | Date | What |
|---|---|---|
| `73e4e96` | 28 Aug 2026 | Goals, process, five utterances, `lookup_hashtag` schema |
| `d98670c` | 28 Aug 2026 | `evaluate_hashtags` tool, `/api/v1/evaluate` read-only endpoint, `src/suggest.ts` and tests, `src/webmcp.ts` registration served from the layout |
| `8257a58` | 28 Aug 2026 | Entry plan against the official rules |

| `ed5f28e`–`b3585f6` | 28 Aug 2026 | Native-API-first registration, `/webmcp` diagnostics, server-reported fallback, `trending_hashtags`, `compare_hashtags` with in-page rendering, `lookup_hashtag`, `describe_coverage` |

Later commits on the branch continue the list. The full diff is the GitHub
compare view `build-mvp...webmcp`. Every file under `docs/webmcp/`, plus
`src/webmcp.ts` and `src/suggest.ts`, is new; the changes to `src/api.ts`,
`src/db.ts`, `src/index.ts` and `src/ui.ts` are the endpoint, its query, its
route and the script tag.

## Open questions

- Should agent-originated lookups count as full query signals, or be
  de-weighted? We can tell them apart (the tool sets a header or query flag).
  Decide after seeing what agents actually do in testing.
- ~~Return shape~~ Resolved 28 Aug 2026 against Chrome 149 with
  `enable-webmcp-testing`: `content: [{type: 'text', text: <JSON string>}]`
  works. Chrome exposes both `navigator.modelContext` and
  `document.modelContext`, with `registerTool`, `getTools`, `executeTool` and
  `ontoolchange`. `executeTool(tool, input)` takes the tool object from
  `getTools()` and the input as a JSON string, hands `execute` a parsed object,
  and returns the result envelope serialised as a string. Verified live:
  `evaluate_hashtags` ran in-browser against the deployed API and returned
  correct standings with `queries_registered: 0`.
- **ChatGPT desktop in-app browser** (28 Aug 2026, Chrome/151 engine): exposes
  **only `document.modelContext`**, a plain object injected by the app rather
  than a native interface, and reported "no WebMCP tools" while we registered
  on `navigator` alone. Registering on both fixed it; `/webmcp` now shows
  `tools registered: 1 (evaluate_hashtags)` there. Anyone building for the
  challenge should register on both objects.
- Is one in-page tool enough, or does `lookup_hashtag` also navigate the tab to
  `/tag/:name`? Leaning yes: cheap, and it keeps the person and agent aligned.

## Challenge requirements, for reference

Live app, public repo, project description, demo video under three minutes.
Judged on usefulness, originality, execution, thoughtful use of WebMCP, and the
quality of the human-agent experience. Rules at <https://webmcp.devpost.com/rules>.
