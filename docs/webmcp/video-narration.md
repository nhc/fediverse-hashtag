# Video recording run sheet

Everything needed at record time, in order: what is on screen, the exact
text to paste into the agent panel, and the narration to read. The captions
are burned in automatically by `scripts/stitch-video.sh`, from
`video/captions.txt`, which is pre-filled with the caption text below; set
each one's timing there once the picture is locked. Each tool demo's
caption leads with the exact tool name, so a judge sees the identifier
they could grep for, while the narration speaks it. The production plan and edit notes are in `video-script.md`.
Drop the recordings in the repository `video/` folder (gitignored, media
never committed) and assemble them with `scripts/stitch-video.sh`; the
steps are in `video/README.md`.

Play order, decided 2 September after a cold read of the first plan: the
clips where the browser navigates and the content changes come first, and
the refusal arrives late, as the twist, once the viewer has seen the tools
plainly working.

Only the indented quote blocks get spoken. The Read blocks describe what
each tool does and how to read its result; they never state what the result
will be, because the agent's candidates and the live data change between
takes, and a narration that asserts an outcome the screen does not show is
worse than no narration. Anything in [square brackets] is read off the
screen from your take: fill it in after the picture is locked and before
you record the audio, and write numbers as words so every take reads the
same. Where a clip can land more than one way, the alternatives are listed
under **Read off the screen**; pick the one that matches the take and drop
the rest.

The read is about three hundred and sixty words, roughly two minutes twenty
at a steady pace. Record the audio continuously after the picture is locked,
leave a beat of silence at each clip boundary, and if a sentence trips you
twice, go back and read it again from its start rather than patching
mid-sentence.

---

## Clip 1: the comparison

**On screen:** the live site with the agent panel open. Paste the question
before you hit record, click send within the first second, and let the
browser land on the compare page with three sparkline rows and the
mixed-evidence callout in shot. Before recording, check the site's tag
list: art and photography must currently be tracked (swap in any two
tracked tags if not), and pottery stays as the untracked one, so the
comparison is fair for two tags and honestly flagged for the third.

**Paste:**

```text
Compare #pottery, #art and #photography
```

**Caption, added in the edit at 0:00, small, lower third:** `Fediverse
Hashtag Activity Index · live · ChatGPT's in-app browser`

**Caption, once the compare page is on screen:** `compare_hashtags · the
agent and the person are looking at the same URL`

**Read:**

> This is a live hashtag activity index for the fediverse, and I have just
> asked the agent to compare three hashtags. It calls compare hashtags, one
> of the site's six WebMCP tools, and it takes the browser to a real page
> with a URL anyone can share, the same page you could have reached from
> the form. Every tag on that page is labelled with the kind of evidence
> behind it, and where the kinds differ, both the agent and the page say so
> instead of pretending the tags are like for like.

**Read off the screen**, appended to the block above if the take shows it
plainly and the pacing allows; otherwise leave the block as it stands:

> [Number] of the tags are observed and genuinely comparable. [The other]
> is server-reported, a different kind of evidence.

## Clip 2: the framing

**On screen:** a tag page with the Coverage panel in shot. Hold still.
Nothing to paste.

**Caption:** `6 tools · 1 result shape · provenance required on every
result, refusals included`

**Read:**

> Nobody can count the whole fediverse, so every number this site publishes
> carries its provenance. The WebMCP tools hand that evidence to the agent
> in a shape it cannot drop on the way to you.

## Clip 3: the draft

**On screen:** paste the whole block below in one action, then send. The
original draft from the verified exchange was not kept, so this one is
written so the agent's candidates are likely to span more than one kind of
evidence. Which tags it proposes, and which of them come back observed,
server-reported or untracked, is decided by the agent and the live data at
record time, not by this sheet. Take the clip, then write what the screen
shows into the bracketed slots below.

**Paste:**

```text
I'm writing this post, which hashtags fit it best?

Finally happy with this batch. Six wheel-thrown stoneware mugs, fired to
cone ten, with a celadon glaze that breaks beautifully over the ridges.
The pulled handles took three attempts before they felt right in the hand.
Off to the studio sale this weekend if anyone in the area fancies a look.
```

**Caption:** `evaluate_hashtags · side_effects.queries_registered: 0`

**Read:**

> The index stores no post content, so it cannot read a draft. The agent
> proposes candidate tags, because language is what it is good at, and
> evaluate hashtags reports the evidence behind each one, labelled by kind,
> so a server's self-report is never dressed up as an observed count.
> [Evidence sentence, from the list below.] The result also reports that
> no queries were registered, because asking for advice must not change
> what the index collects.

**Read off the screen**, one of these in place of the bracketed sentence:

> Hashtag [tag] comes back observed: [number] accounts across [number]
> servers. [Tag] and [tag] come back server-reported, a different kind of
> evidence, and are labelled as such.

> Hashtag [tag] and hashtag [tag] show recent use in the index, and the
> rest are untracked there, which the result states as an absence of
> evidence, not as evidence the tags are unused.

> None of the candidates comes back observed. Every one is server-reported
> or untracked, and each is labelled as such.

## Clip 4: the refusal

**On screen:** paste, send, and let the tool call and the refusal show.

**Paste:**

```text
Can you say #news is rising across the fediverse?
```

**Caption, early in the clip:** `check_claim: the site referees what the
agent may say`

**Read:**

> This is the part no other site does. I have asked whether the agent can say
> hashtag news is rising across the fediverse. The agent calls check claim,
> and the site referees the claim against the same rules it holds itself
> to. The fediverse-wide version is blocked, because no server can see the
> whole network. [Scoped verdict, from the list below.] And it hands back
> the sentence the index will stand behind.

The fediverse-wide refusal is a rule, so it is the same on every take. The
scoped verdict depends on the last two hours of data, so read it off the
screen:

**Read off the screen**, one of these in place of the bracketed sentence:

> Scoped to what the index observes, it is blocked as well, because the
> data says the opposite: [number] authors in the prior hour, against
> [number] in the latest.

> Scoped to what the index observes, it is allowed, but only as far as the
> data goes: [number] authors in the prior hour, against [number] in the
> latest, on the servers the index can see.

## Clip 5: the close

Recorded as `clip6.mov`; the filename stays so the manifests and the
recording match. The /webmcp scroll that was clip 5 was dropped on 3
September to fit the three-minute limit; its one essential sentence is folded
into this read, and the Devpost description and testing instructions cover the
page itself.

**On screen:** the home page or the tag list, held still.

**Caption:** the live URL and the repository URL, plain text:

```text
https://fediverse-hashtag-index.neil-charlton.workers.dev
https://github.com/nhc/fediverse-hashtag
```

**Read:**

> Everything the agent receives, a person can check on the page. There are
> six tools with one result shape, and provenance is required on every
> result, including the refusals. The whole surface is listed at slash
> webmcp, which also answers the same question with and without the tools.
> WebMCP is what lets a website hand an agent not just its data, but the
> limits of its data. The site is live, and the code is open.

## YouTube description

Paste under the video at upload. Check both links in a private window.

```text
A live hashtag activity index for the fediverse, entered in the WebMCP
Challenge. Nobody can count the whole fediverse, so every figure the site
publishes carries its provenance: which servers contributed, how healthy
they were, and when it last updated. The site registers six WebMCP tools
that hand that evidence to an agent in a shape it cannot drop, and one of
them, check_claim, referees what the agent may say against the same rules
the site holds itself to. In this demo, the agent renders a comparison on
a page the person can share, grades hashtag suggestions by the kind of
evidence behind them, and is refused a fediverse-wide claim.

Live site: https://fediverse-hashtag-index.neil-charlton.workers.dev
Code: https://github.com/nhc/fediverse-hashtag

Built for the OpenAI WebMCP Challenge, September 2026.
```
