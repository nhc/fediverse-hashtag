# Demo video: script and production plan

Rewritten 1 September 2026 after the organisers' email, reordered
2 September after a cold read. The organisers' rules that shaped it: the
project must be working on screen in the first 10 to 15 seconds, no intros
or title cards, inspiration stays in the written description, nothing typed
live, all waiting cut, on-screen text instead of spoken explanation where it
is faster, and the best material first because judges are not required to
watch past three minutes.

Target 2:30 to 2:45. The narration, paste text and captions live in
`video-narration.md`; this document is the design, the edit notes and the
checklist.

## Design decisions

- **The comparison opens, the refusal lands late.** The first plan opened
  on the check_claim refusal for novelty. A cold read on 2 September said it
  looks like a failed demo, so the order now runs: the clips where the
  browser navigates and the content visibly changes first, and the refusal
  at 1:45 as the twist, once the viewer has watched the tools plainly work.
  That is also where `tools.md` originally placed it.
- **Three exchanges, no repetition.** Each shows a different capability:
  changing what the person sees, grading evidence, and refereeing a claim.
- **Framing is one sentence plus on-screen text**, not a spoken essay. The
  problem story lives in the description, where the organisers asked for it.
- **The script reads the same for your voice or an AI narrator.** Short
  declarative sentences, no ambiguous symbols; "hashtag art", never "#art",
  in anything spoken.

## Recording order

Record the screen clips first, voice-over last. Two figures in the
narration are quoted from the exchanges (the observed figures in clip 3 and
the hour-on-hour author counts in clip 4). They will be fresh on your screen
when you record, so adjust those two sentences to match what the screen
shows, then record the audio. Nothing in the narration should disagree with
the pixels.

Record each clip separately so one bad take does not cost the rest. Clips
go in the repository `video/` folder; `scripts/stitch-video.sh` trims each
to the manifest, normalises to 1080p30, concatenates, and lays the
narration over the top as the only soundtrack.

## Play order and timings

| Time | Clip | What a judge sees |
|---|---|---|
| 0:00 | 1. compare_hashtags | Question already pasted, sent in the first second. The browser lands on /compare, sparklines render, the not-like-for-like callout in shot. Orientation caption at 0:00. |
| 0:33 | 2. framing | A tag page, Coverage panel held still. One spoken sentence; the rest is the on-screen text. |
| 0:47 | 3. evaluate_hashtags | The pottery draft pasted in one action. Observed against server-reported evidence, and `queries_registered: 0` as a caption. |
| 1:19 | 4. check_claim | The refusal, now with full context. Both scopes blocked, the counter-evidence quoted, the may_say sentence handed back. |
| 1:56 | 5. /webmcp surface | A slow scroll: six tools and the same-question-twice exhibit. |
| 2:08 | 6. close | Home page held still, both URLs as captions. |

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
2. The final sentence of clip 1, beginning "Both the agent and the page".
3. The framing voice-over in clip 2; keep the shot and the on-screen text.

Do not cut clip 4. The refusal is the point of the entry, and the rules
reward showing it.

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
