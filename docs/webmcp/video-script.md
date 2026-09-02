# Demo video: script and production plan

Rewritten Tuesday 1 September 2026 after the organisers' email. Their rules
that shaped this version: the project must be working on screen in the first
10 to 15 seconds, no intros or title cards, inspiration stays in the written
description, nothing typed live, all waiting cut, on-screen text instead of
spoken explanation where it is faster, and the best material first because
judges are not required to watch past three minutes.

Target 2:20 to 2:30. Spoken script is about 2:18 at a normal pace.

## Design decisions

- **The refusal opens the video.** `check_claim` is the most novel thing in
  the entry and it states the whole thesis in one exchange. Hundreds of
  submissions will show an agent doing a thing; very few will show a site
  refereeing what the agent may say. If this feels wrong on the first cut,
  swap clips 1 and 3 and move the framing line to the front.
- **Three exchanges, no repetition.** Each shows a different capability:
  refereeing a claim, changing what the person sees, and grading evidence.
- **Framing is one sentence plus on-screen text**, not a spoken essay. The
  problem story lives in the description, where the organisers asked for it.
- **The script reads the same for your voice or an AI narrator.** Short
  declarative sentences, no ambiguous symbols; "hashtag art", never "#art",
  in anything spoken.

## Recording order

Record the screen clips first, voice-over last. Two figures in the script
are quoted from the exchanges (the hour-on-hour author counts in clip 1, and
the observed figures in clip 4). They will be fresh on your screen when you
record, so adjust those two sentences to match what the screen shows, then
record the audio. Nothing in the narration should disagree with the pixels.

Record each clip separately so one bad take does not cost the rest.

## Clip list

### Clip 1, 0:00 to 0:34: check_claim, the referee

**Screen:** the live site with the agent panel open. The question is already
pasted in the input: "Can you say #news is rising across the fediverse?"
Send is clicked within the first second. The `check_claim` tool call must be
visible, then the refusal.

**On-screen text at ~0:20:** `check_claim: the site referees what the agent may say`

> This is a live hashtag activity index for the fediverse, and I have just
> asked the agent to make a claim the data cannot support. It calls
> check_claim, one of the site's six WebMCP tools, and the site referees the
> claim. The fediverse-wide version is blocked, because no server can see the
> whole network. Scoped to what the index observes, it is blocked as well,
> because the data says the opposite: 182 authors in the prior hour against
> 109 in the latest. **[match to screen]** And it hands back the sentence the
> index will stand behind.

### Clip 2, 0:34 to 0:48: the framing

**Screen:** cut to a tag page with the Coverage panel in shot. Hold still.

**On-screen text:** `6 tools · 1 result shape · provenance required on every result, refusals included`

> Nobody can count the whole fediverse, so every number this site publishes
> carries its provenance. The WebMCP tools hand that evidence to the agent in
> a shape it cannot drop on the way to you.

### Clip 3, 0:48 to 1:12: compare_hashtags, the agent changes the page

**Screen:** question already pasted: "Compare #pottery and #art". Tool call
fires, the browser lands on `/compare?tags=Art,pottery`, sparklines render,
the not-like-for-like callout is in shot. Cut the navigation wait.

**On-screen text:** `The agent and the person are looking at the same URL`

> Ask for a comparison and the tool does not just return numbers. It takes
> the browser to a real page with a URL anyone can share, the same page you
> could reach from the form. Both the agent and the page flag that this is
> not a like-for-like comparison, because one figure is observed and the
> other is server-reported.

### Clip 4, 1:12 to 1:44: evaluate_hashtags, graded evidence

**Screen:** the pottery draft pasted in one action, with "which hashtags fit
this post best?" The reply should show the observed figures for #Art and the
server-reported label on the niche tags. (This is the exchange verified
28 Aug, 13:16 UK; re-run it live.)

**On-screen text:** `side_effects: queries_registered: 0`

> The index stores no post content, so it cannot read a draft. The agent
> proposes candidate tags, because language is what it is good at, and
> evaluate_hashtags reports the evidence for each one. Hashtag art comes back
> observed: 385 accounts across 112 servers. **[match to screen]** The niche
> tags come back server-reported, a different kind of evidence, and labelled
> as such. The result also reports that no queries were registered, because
> asking for advice must not change what the index collects.

### Clip 5, 1:44 to 1:56: the surface, on one page

**Screen:** `/webmcp`, scrolled to the six tools and the same-question-twice
exhibit. No interaction needed; a slow scroll is enough.

> The whole surface is on one page. Slash webmcp lists the six tools and
> answers the same question with and without them, so you can see exactly
> what the tools change.

### Clip 6, 1:56 to 2:18: close

**Screen:** back on the home page, or the tag list.

**On-screen text:** the live URL and the repository URL, plain text.

> Everything the agent receives, a person can check on the page. There are
> six tools with one result shape, and provenance is required on every
> result, including the refusals. WebMCP is what lets a website hand an agent
> not just its data, but the limits of its data. The site is live, and the
> code is open.

## Edit notes

- Cut every wait: tool spinners, page loads, model thinking. Jump cuts are
  expected; do not smooth them.
- Speed up any unavoidable slow moment slightly rather than leaving dead air.
- The audio runs continuously over the cuts. Record it in one or two takes
  after the picture is locked.
- Keep the agent panel and the page both in frame whenever a tool is called.
  A judge must be able to see the tool being used, not infer it.
- No music. No title cards. ChatGPT, Chrome and Mastodon branding stays
  incidental; none of it in the thumbnail.
- Thumbnail: a plain frame of the site, or the compare page. No logos.

## If it runs long

Cut in this order and stop when it fits:

1. Clip 5 entirely (the /webmcp scroll). The description covers it.
2. The final sentence of clip 3, beginning "Both the agent and the page".
3. The framing voice-over in clip 2; keep the shot and the on-screen text.

Do not cut clip 1. It is the entry.

## Upload checklist

- [ ] Length under 3:00.
- [ ] Both **[match to screen]** figures agree with the recording.
- [ ] Every tool call visibly on screen.
- [ ] Uploaded to YouTube as **Public**, not Unlisted.
- [ ] Title is plain and names the project: "Fediverse Hashtag Activity
      Index: WebMCP demo".
- [ ] YouTube description pasted from the run sheet, both links checked.
- [ ] Link opened in a private window to confirm it plays for a stranger.
- [ ] Video URL pasted into the Devpost draft.
