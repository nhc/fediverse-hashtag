# Demo video script

Written Tuesday 1 September 2026, from the exchanges verified in `tools.md`.
Target 2:30. The hard limit in the rules is three minutes.

The voice-over runs continuously. The tool calls take a few seconds each, so
record them in full and cut the waiting in the edit; the audio should not
have gaps in it. Spoken length is roughly 2:40 at a normal pace, which
leaves room to slow down and still come in under three minutes.

Before recording, open the live site and check the two figures marked
**[check]** below. They move.

No title card, no music, no logos on screen except incidentally. Start on the
site itself.

---

## 0:00 The problem

**On screen:** the index home page, the tag list in shot. No cursor movement.

> Every hashtag counter on the web gives you a number. Almost none of them
> tell you where that number came from. On the fediverse the gap is
> structural. There is no central server, so no complete count of anything can
> exist. Every figure is a view from somewhere.

## 0:18 What the site does about it

**On screen:** open a tag page, scroll so the Coverage panel is visible.

> This index polls public hashtag timelines across nine Mastodon-compatible
> servers **[check]**, deduplicates what it sees, and publishes every figure
> with its provenance: which servers contributed, how many were healthy, and
> when it last updated. If two periods were not covered comparably, it will
> not call a trend.

## 0:36 Why WebMCP

**On screen:** open the agent panel beside the page.

> Then agents started reading pages. An agent that scrapes a number keeps the
> number and drops the caveats, and the caveats were the point. So this site
> registers six WebMCP tools that hand the agent the evidence in a shape it
> cannot drop on the way to you.

## 0:52 Demo one: the draft

**On screen:** paste the pottery draft and ask which hashtags fit it best.
Let the tool call show. (Verified 28 Aug, 13:16 UK.)

> Here is a draft about pottery. The index stores no post content, so it
> cannot read it. The agent proposes the tags, because language is what it is
> good at, and the tool reports what the index has actually seen of each. It
> gives hashtag Art with observed figures, 385 accounts across 112 servers.
> The niche tags it labels as server-reported seven-day data, a different
> source, and says so out loud. And it advises skipping one that is tracked
> but has gone quiet.

## 1:20 Demo two: the comparison

**On screen:** ask it to compare two tags. The browser lands on
`/compare?tags=...` with the sparklines. (Verified 28 Aug, 15:07 UK.)

> Ask for a comparison and the tool does not just return numbers. It takes you
> to a real page, with a URL you can share, that anyone could have reached
> from the form themselves. The agent and the person end up looking at the
> same thing. Here it flags that the two tags are not like for like, and the
> page says the same thing in the callout.

## 1:45 Demo three: the refusal

**On screen:** ask whether it can say hashtag news is rising across the
fediverse. (Verified 31 Aug, 19:00 UK.)

> The last tool closes the loop. The agent submits the claim it wants to make,
> and the index referees it. Can it say hashtag news is rising across the
> fediverse? No. A fediverse-wide claim is blocked outright, because no server
> sees the whole network. Scoped to what this index does observe, the claim is
> checkable, and it comes back blocked as well, because the data says the
> opposite: 182 accounts in the prior hour against 109 in the latest
> **[check]**. Every verdict carries a sentence the index will stand behind,
> so a refusal is never a dead end.

## 2:17 Close

**On screen:** back to the home page, or `/webmcp` with the six tools listed.

> Six tools, one result shape, and provenance required on every one of them,
> including the refusals. WebMCP is what let a website hand an agent not just
> its data, but the limits of its data. It is open source, and the site is
> live.

---

## If it runs long

Cut in this order, and stop as soon as it fits:

1. In demo two, the sentence beginning "The agent and the person".
2. In the opening, "Every figure is a view from somewhere."
3. In demo one, the sentence about skipping the quiet tag.

Do not cut demo three. The refusal is the point of the entry, and the rules
reward showing it.

## Recording checklist

- [ ] Live site checked, and the two **[check]** figures updated in this script.
- [ ] Agent panel and page both visible in frame for every tool call.
- [ ] Each tool call visibly happens; do not cut so tightly that a judge
      cannot see the tool being used.
- [ ] Audio recorded in one take if possible, over the edited screen capture.
- [ ] No music. No third-party logo in the thumbnail or any title card.
- [ ] Length under 3:00, ideally 2:30 to 2:45.
- [ ] Uploaded to YouTube as **Public**, not Unlisted.
- [ ] Link opened in a private window to confirm it plays for a stranger.
