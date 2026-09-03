# Entry plan: OpenAI WebMCP Challenge

Written Friday 28 August 2026. The aim is not to build the best possible
thing; it is to be **validly entered and fairly judged**. Everything here is
ordered so that a valid entry exists as early as possible and improves from
there. If time runs out at any step, what is already submitted still counts.

Official rules: <https://webmcp.devpost.com/rules>. Where this document and
the rules disagree, the rules win.

## Live site

<https://fediverse-hashtag-index.neil-charlton.workers.dev>. Deployed from
`main` only, which since 2 September is the single branch: `build-mvp`,
`webmcp` and `visualise-tags` were consolidated into it, fully merged, and
deleted. Repository: <https://github.com/nhc/fediverse-hashtag>
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
Thursday 3 September 2026, after the video was published.

**Built and verified:** six tools, live from `main`, all verified in
ChatGPT's in-app browser and Chrome 151; `/webmcp` diagnostics; `/compare`
page; licence; prior/new-work record; repo pushed (private).

**Browser checks: all done**
- [x] ChatGPT browser: after the `document.modelContext` change, "what webmcp
      tools can I access here" lists five, with the side effect on
      `lookup_hashtag` called out (28 Aug, 15:32 UK).
- [x] Firefox 152: `/webmcp` reports no model context, page renders normally,
      script exits silently (28 Aug, 15:50 UK). Safari not checked, by choice.

**Entry logistics still open (Neil)**
- [ ] Register on Devpost and save a draft submission. Note any form fields
      not covered by this document.
- [x] Repository flipped to public 31 Aug, 19:40 UK. Anonymous access
      returns 200 and GitHub detects the MIT licence.
- [x] Video. Published 3 Sep, 08:30 UK, as Public, no music, thumbnail is
      the site alone: <https://youtu.be/3z7fvUdrNRM>. Runs 2:46. Five clips
      with the clips' own audio (clip 5, the /webmcp scroll, dropped to fit
      the limit); script in `video-script.md`, run sheet in
      `video-narration.md`, stitched with `scripts/stitch-video.sh`.
- [x] Text description drafted in `devpost-submission.md`, with Built-with
      tags, links and testing instructions. Check figures before pasting.
      Corrected 1 Sep: it said five tools and omitted `check_claim`. Now six,
      with a bullet for it. A judge who greps `src/webmcp.ts` finds six.
- [ ] Screenshots for the form. Captured: pottery evaluation, trending,
      compare page (mixed and approved), lookup happy path and refusal,
      coverage answer, check_claim referee, and the combined
      trending-plus-scope shot (31 Aug, 19:03 UK, the strongest single
      capture). Also captured 31 Aug evening: a crisper trending-plus-scope
      retake (19:27, prefer this one) and the caturday unused punchline
      (19:29, blocked on principle plus 1,371 server-reported accounts).
      The hobby draft landed 19:31 (urban sketching: five proposed
      candidates, server-reported counts quoted, "an indication of activity,
      not a fediverse-wide count"). The too-few-authors refusal landed 19:33 (one author in each of
      the last two comparable hours; may_say quoted verbatim), completing the
      set of three distinct refusal reasons. The like-for-like compare and the trust follow-up landed together
      19:35 (comparison open on the page; "trust the comparison, don't treat
      them as fediverse-wide totals"; 25 vs 4 posts per author read as
      syndication). Still wanted: tools-on-a-tag-page.
- [ ] Submit by Wednesday 2 September, 9 pm UK. Confirm status is "submitted".

**Raising the score (agreed 31 Aug)**
- [x] The same-question-twice exhibit and expected behaviour per tool, on
      `/webmcp` (done 31 Aug; Neil reviewed the page and approved it).
- [x] `check_claim` built with 14 unit tests and deployed (31 Aug): directions
      checked, adjectives qualified with the sentence the index stands behind,
      unused and fediverse-wide claims always blocked. Agent test passed
      31 Aug, 19:00 UK; the exchange is recorded in tools.md.
- [ ] Page-aware `explain_this_page` tool via ontoolchange. Review after
      check_claim; drop if time is short.

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

### 4. Prior work vs new work documentation — RESOLVED, simpler than assumed
The git history shows the first commit is 27 August 2026, two days into the
Submission Period, so the whole project qualifies as newly created during the
Hackathon and the pre-existing-project rule does not apply. The dated commit
log is still the evidence, and `docs/webmcp/README.md` records it under
"When this was built, with evidence". Earlier drafts wrongly said the project
predated 25 August; corrected on 31 August.

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
