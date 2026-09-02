# Video recording run sheet

Everything needed at record time, in order: what is on screen, the exact
text to paste into the agent panel, and the narration to read. The captions
are added in the edit; they are listed here so the whole video lives in one
document. The production plan and edit notes are in `video-script.md`.

Only the indented quote blocks get spoken. The two figures in **bold** must
match what your screen showed when you recorded the clip, so swap them
before reading. Numbers are written as words so every take reads the same.

The read is about three hundred and forty words, roughly two minutes twenty
at a steady pace. Record the audio continuously after the picture is locked,
leave a beat of silence at each clip boundary, and if a sentence trips you
twice, go back and read it again from its start rather than patching
mid-sentence.

---

## Clip 1: the refusal

**On screen:** the live site with the agent panel open. Paste the question
before you hit record, then click send within the first second.

**Paste:**

```text
Can you say #news is rising across the fediverse?
```

**Caption, added in the edit at about 0:20:** `check_claim: the site
referees what the agent may say`

**Read:**

> This is a live hashtag activity index for the fediverse, and I have just
> asked the agent whether it can say hashtag news is rising across the
> fediverse. That is a claim the data cannot support. The agent calls check
> claim, one of the site's six WebMCP tools, and the site referees the
> claim. The fediverse-wide version is blocked, because no server can see
> the whole network. Scoped to what the index observes, it is blocked as
> well, because the data says the opposite: **one hundred and eighty-two**
> authors in the prior hour, against **one hundred and nine** in the latest.
> And it hands back the sentence the index will stand behind.

## Clip 2: the framing

**On screen:** a tag page with the Coverage panel in shot. Hold still.
Nothing to paste.

**Caption:** `6 tools · 1 result shape · provenance required on every
result, refusals included`

**Read:**

> Nobody can count the whole fediverse, so every number this site publishes
> carries its provenance. The WebMCP tools hand that evidence to the agent
> in a shape it cannot drop on the way to you.

## Clip 3: the comparison

**On screen:** paste, send, and let the browser land on the compare page
with the sparklines and the not-like-for-like callout in shot.

**Paste:**

```text
Compare #pottery and #art
```

**Caption:** `The agent and the person are looking at the same URL`

**Read:**

> Ask for a comparison and the tool does not just return numbers. It takes
> the browser to a real page with a URL anyone can share, the same page you
> could have reached from the form. Both the agent and the page flag that
> this is not a like-for-like comparison, because one figure is observed and
> the other is server-reported.

## Clip 4: the draft

**On screen:** paste the whole block below in one action, then send. The
original draft from the verified exchange was not kept, so this one is
written to produce the same shape of answer: observed figures for #Art and
server-reported evidence for the niche tags. If the agent's candidates
differ a little, that is fine; the narration only depends on the two kinds
of evidence appearing.

**Paste:**

```text
I'm writing this post, which hashtags fit it best?

Finally happy with this batch. Six wheel-thrown stoneware mugs, fired to
cone ten, with a celadon glaze that breaks beautifully over the ridges.
The pulled handles took three attempts before they felt right in the hand.
Off to the studio sale this weekend if anyone in the area fancies a look.
```

**Caption:** `side_effects: queries_registered: 0`

**Read:**

> The index stores no post content, so it cannot read a draft. The agent
> proposes candidate tags, because language is what it is good at, and
> evaluate hashtags reports the evidence for each one. Hashtag art comes
> back observed: **three hundred and eighty-five** accounts across **one
> hundred and twelve** servers. The niche tags come back server-reported,
> which is a different kind of evidence, and they are labelled as such. The
> result also reports that no queries were registered, because asking for
> advice must not change what the index collects.

## Clip 5: the surface

**On screen:** the /webmcp page, a slow scroll down the six tools and the
same-question-twice exhibit. Nothing to paste.

**Read:**

> The whole surface is on one page. Slash webmcp lists the six tools and
> answers the same question with and without them, so you can see exactly
> what the tools change.

## Clip 6: the close

**On screen:** the home page or the tag list, held still.

**Caption:** the live URL and the repository URL, plain text:

```text
fediverse-hashtag-index.neil-charlton.workers.dev
github.com/nhc/fediverse-hashtag
```

**Read:**

> Everything the agent receives, a person can check on the page. There are
> six tools with one result shape, and provenance is required on every
> result, including the refusals. WebMCP is what lets a website hand an
> agent not just its data, but the limits of its data. The site is live,
> and the code is open.
