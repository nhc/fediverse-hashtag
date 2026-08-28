# Entry plan: OpenAI WebMCP Challenge

Written Friday 28 August 2026. The aim is not to build the best possible
thing; it is to be **validly entered and fairly judged**. Everything here is
ordered so that a valid entry exists as early as possible and improves from
there. If time runs out at any step, what is already submitted still counts.

Official rules: <https://webmcp.devpost.com/rules>. Where this document and
the rules disagree, the rules win.

## Live site

<https://fediverse-hashtag-index.neil-charlton.workers.dev>. Deployed from
`build-mvp` only. Repository: <https://github.com/nhc/fediverse-hashtag>
(private until submission; must be public by then).

## Dates, in UK time

| What | Pacific | UK (BST) |
|---|---|---|
| Submission period closes | Thu 3 Sep, 1:00 pm | **Thu 3 Sep, 9:00 pm** |
| Netlify credits form (optional, not needed) | Tue 1 Sep, 12:00 pm | Tue 1 Sep, 8:00 pm |
| Judging | Fri 4 Sep 10 am – Mon 21 Sep 5 pm | Fri 4 Sep – Tue 22 Sep, 1 am |
| Winners announced | ~Wed 23 Sep, 2 pm | ~Wed 23 Sep, 10 pm |

**Internal deadline: submit by Wednesday 2 September, 9 pm UK.** That leaves
a full day for a Devpost form problem, a YouTube processing delay, or a
deployment that falls over. Do not plan to use the final day.

## Outstanding, kept current

The live to-do list. Update this section rather than the chat. Last updated
Friday 28 August 2026, 15:35 UK.

**Built and verified:** five tools, live from `build-mvp`, all verified in
ChatGPT's in-app browser and Chrome 151; `/webmcp` diagnostics; `/compare`
page; licence; prior/new-work record; repo pushed (private).

**Browser checks still open**
- [x] ChatGPT browser: after the `document.modelContext` change, "what webmcp
      tools can I access here" lists five, with the side effect on
      `lookup_hashtag` called out (28 Aug, 15:32 UK).
- [ ] Safari or Firefox: home page console empty; `/webmcp` says no model
      context; `/compare?tags=news,art` renders.

**Entry logistics still open (Neil)**
- [ ] Register on Devpost and save a draft submission. Note any form fields
      not covered by this document.
- [ ] Decide when to flip `nhc/fediverse-hashtag` to public. Required before
      submission; earlier makes the README compare link work for anyone.
- [ ] Video: 2:30 script from the captured exchanges, record, upload to
      YouTube as Public, no music, no logos in the thumbnail.
- [ ] Text description under the rules' four headings.
- [ ] Screenshots for the form: pottery evaluation, trending, compare page,
      lookup refusal, coverage answer. Most already captured today.
- [ ] Submit by Wednesday 2 September, 9 pm UK. Confirm status is "submitted".

**Nice to have, not gating**
- [ ] Tag page Coverage panel grades zero observations as "thin" in red;
      should say nothing observed instead.
- [ ] `/webmcp` reads `navigator.modelContext` for diagnostics and so logs one
      deprecation warning on that page only.

## Eligibility, checked once

- [ ] I am an individual, of majority age, resident in the UK (on OpenAI's
      supported-countries list). Entering as an individual, not through my
      employer, so no Representative authorisation is needed.
- [ ] No connection to OpenAI, Devpost, Netlify, or any judge. No funding or
      preferential support from OpenAI for this project.
- [ ] The project is my original work and solely mine. Dependencies are
      standard open source under their own licences.

## Hard requirements: fail any one and the entry is invalid

Ordered by how long each takes to fix. Do them in this order.

### 1. Licence file — 15 minutes — BLOCKED, do first
- [ ] Add `LICENSE` at the repo root. MIT is the simplest that satisfies
      "open source licence". Copyright line: my name, 2026.
- [ ] Add `"license": "MIT"` to `package.json`.
- [ ] After pushing, confirm GitHub shows the licence in the About panel on
      the repo home page. The rules say it must be "detectable and visible" there.

### 2. Public repository — 30 minutes — BLOCKED
- [ ] Create a public GitHub repository. Push `main` (or whichever branch
      the deployed build comes from) and the `webmcp` branch.
- [ ] Repository must contain everything needed to run it: it does
      (`OPERATING.md`, `wrangler.jsonc`, migrations). Check `OPERATING.md`
      reads correctly for a stranger, not just for me.
- [ ] Check nothing secret is committed: `AUTHOR_SALT`, any tokens,
      `.dev.vars`. `git log -p | grep -i salt` before pushing.
- [ ] Confirm the repo contains a `registerTool(...)` call (`src/webmcp.ts`).
      Judges may grep for it.

### 3. Live URL that works in a WebMCP browser — half a day — BLOCKED
- [ ] Deploy the `webmcp` branch to Cloudflare (Cloudflare is named as an
      acceptable host). HTTPS is required: `navigator.modelContext` only
      exists in a secure context.
- [ ] Install one of the two judging environments and test in it myself:
      ChatGPT desktop app's in-app browser (WebMCP on by default), or Chrome
      149+ with `chrome://flags/#enable-webmcp-testing`. **Do both if
      possible**; judges may use either.
- [ ] The rules' code sample uses `document.modelContext`; the W3C draft
      uses `navigator.modelContext`. Register on whichever exists, both if
      both do. Verify which one each browser actually exposes.
- [ ] Verify `evaluate_hashtags` is listed by the agent and returns a result
      on the live site. Screenshot it: the screenshot goes in the submission.
- [ ] Keep it up until **22 September**. Check the Cloudflare plan limits
      cover three weeks of cron plus judge traffic. Set a calendar reminder
      to check the site on 4, 10 and 17 September.

### 4. Prior work vs new work documentation — 1 hour
The project existed before 25 August, so it is judged **only on WebMCP
work added after 25 August 2026, 11 am PT**. The rules require "clear
documentation distinguishing prior work from new work" with timestamped
evidence.
- [ ] Add a section to `docs/webmcp/README.md` headed "Prior work and work
      during the Submission Period": one paragraph on what existed (the
      index, API, pages, collector) and a list of the WebMCP commits with
      dates and hashes. Link the GitHub compare view
      `build-mvp...webmcp` so a judge can see the diff in one click.
- [ ] Say the same thing in the Devpost text description, briefly.

### 5. Demo video — half a day — not started
- [ ] Under three minutes. Aim for 2:30 so trimming is not needed.
- [ ] Has audio (voice-over) explaining what was built and how WebMCP is used.
- [ ] Shows the project **functioning**: real agent, real site, real tool
      calls. Screen record the browser with the agent panel visible.
- [ ] Public on YouTube. Upload as "Public", not "Unlisted"; the rules say
      publicly visible. Check the link in a private window.
- [ ] No copyrighted music. No third-party logos on screen where avoidable:
      keep ChatGPT/Chrome/Mastodon branding incidental, do not use them in
      title cards or thumbnails.
- [ ] Script it around the utterances in `tools.md`. Include the refusal.
- [ ] Record on Monday 1 September at the latest so there is time to re-record.

### 6. Text description — 2 hours
Four things the rules say it must explain. Write one paragraph per heading
and use those headings verbatim so a judge can tick them off:
- [ ] Why this use case is a strong fit for WebMCP
- [ ] How it creates a better user experience
- [ ] What people and agents can do together that was difficult or impossible before
- [ ] How WebMCP was implemented (briefly)
Most of this is already argued in `docs/webmcp/README.md`; condense it.
Add the prior/new work note and the testing instructions (no login needed).

### 7. Devpost registration and form — 1 hour
- [ ] Register at webmcp.devpost.com ("Join Hackathon"). Do this **today**
      so any account problem surfaces early.
- [ ] Start a draft submission immediately and save it; drafts can be edited
      until the period closes. A saved draft with a placeholder is better
      than nothing if something goes wrong on the last day.
- [ ] Fields: project name, description (above), live URL, repo URL, video
      URL, screenshots, testing instructions ("no credentials required").
- [ ] Submit by Wednesday 2 September, 9 pm UK. Confirm the status shows as
      submitted, not draft.

## Judging: what moves the score

Stage One is pass/fail: fits the theme, genuinely uses WebMCP. The above gets
us through it. Stage Two is four equally weighted criteria; **WebMCP Leverage
is also the first tie-breaker**, so it is worth the most.

| Criterion | Where we are | What raises it |
|---|---|---|
| WebMCP Leverage | One tool. Thin. | Build `lookup_hashtag`, `compare_hashtags`, `trending_hashtags`, `describe_coverage`. Five tools with a shared provenance shape reads as a designed surface, not a wrapper. |
| Execution | The site is a complete product already. The agent layer is not yet. | `compare_hashtags` rendering in the page. One tool that changes what the person sees turns "API with extra steps" into a human-agent experience. |
| Potential Impact | Strong story, not yet written down for judges. | The description must name the real problem: agents that scrape a number and drop its caveats. Show the refusal in the video. |
| Creativity & Ambition | Strong. Calibrated refusal and provenance-carrying tools are unusual. | Do not dilute it by adding generic features. Lean in. |

Judges are **not required to test the live site** and may score from the
description, screenshots and video alone. Treat the video and description as
the primary deliverable, the live site as the proof.

## Schedule

| Day | Do |
|---|---|
| **Fri 28 Aug** | Register on Devpost. LICENSE + package.json licence. Create public GitHub repo, push. Prior/new section in README. Save a draft submission with placeholders. |
| **Sat 29 Aug** | Deploy `webmcp` to Cloudflare. Install Chrome 149 + flag and/or ChatGPT desktop. Prove `evaluate_hashtags` works live. Screenshot. Resolve `document` vs `navigator` question. |
| **Sun 30 Aug** | Build `lookup_hashtag` (schema already written) and `describe_coverage`. Deploy. |
| **Mon 31 Aug** | Build `compare_hashtags` with in-page rendering, and `trending_hashtags`. Deploy. Write the video script from `tools.md`. |
| **Tue 1 Sep** | Record and upload the video. Write the text description. Take final screenshots. |
| **Wed 2 Sep** | Fill in the Devpost form completely. **Submit by 9 pm UK.** Verify status is "submitted". |
| **Thu 3 Sep** | Buffer. Fix anything broken. Do not start new work. |
| **4–21 Sep** | Keep the site up. Check it on 4, 10 and 17 Sep. Do not deploy breaking changes to the judged URL. |

If a day slips, drop tools from the bottom of the leverage list
(`trending_hashtags` first, then `describe_coverage`) rather than slipping
the video or the submission date. Three well-made tools and a submitted
entry beat five tools and a missed deadline.

## Things that could go wrong, and the answer

- **Neither browser exposes `modelContext` on my machine.** Check the
  Chrome version is 149+, the flag is enabled and the browser restarted,
  and the site is HTTPS. Test on the deployed URL, not localhost.
- **The tool registers but the agent never calls it.** The description is
  the agent's only guide. Make it say what the tool is for in the first
  sentence, and test with the exact phrasing from `tools.md`.
- **Cloudflare free-tier limit hit during judging.** The cron and write
  budget are already sized for this; confirm in `docs/decisions.md` and
  the Cloudflare dashboard on 4 September. A read-only site with cached
  JSON survives judge traffic easily.
- **YouTube flags the video.** No music, no logos in the thumbnail.
  Upload a day early.
- **Devpost form asks for something not on this list.** That is why the
  draft is started on day one.
