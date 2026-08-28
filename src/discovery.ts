/**
 * Deciding which tags the index should be watching.
 *
 * The tracked set cannot simply grow. Every tracked tag costs requests, and the
 * budget is fixed, so admitting a tag means either having a free slot or taking
 * one from a tag that has gone quiet. Both halves of that live here, and both
 * are pure so the policy can be argued with in tests rather than in production.
 *
 * The ranking signal is distinct authors, never use count. A tag used two
 * hundred times by three accounts is one person shouting; a tag used twenty
 * times by twenty accounts is a conversation. Only the second is worth a
 * polling slot, and only the second is worth showing anybody.
 */

/** A tag seen alongside a tracked one, not yet watched in its own right. */
export interface Candidate {
  name: string;
  /** Exact count of distinct authors observed using it. */
  distinctAuthors: number;
  /**
   * Distinct servers those authors posted from. The signal that separates a
   * conversation from a publisher, measured across the whole network rather than
   * the monitored set.
   */
  distinctOriginServers: number;
  /** Mean hashtags on the posts carrying it. Recorded, not yet gated on. */
  meanTagsPerPost: number | null;
  firstSeen: number;
}

export interface TrackedTag {
  id: number;
  name: string;
  postsLast24h: number;
  lastQueryAt: number | null;
  firstSeenAt: number;
}

export interface PromotionLimits {
  now: number;
  /** How many tags are tracked right now. */
  trackedCount: number;
  /**
   * Ceiling on the tracked set, set by the write budget rather than by taste.
   * See the arithmetic in docs/design.md.
   */
  maxTracked: number;
  /** Distinct authors a candidate needs before it is worth a slot. */
  minAuthors?: number;
  /** Distinct origin servers a candidate needs to count as a community. */
  minOriginServers?: number;
  /** Names never to promote, whatever they do. */
  blocked?: ReadonlySet<string>;
}

export const DEFAULT_MIN_AUTHORS = 5;

/**
 * Distinct origin servers a tag needs before it counts as a community.
 *
 * Four, from the live data. Every tag that turned out to be a news farm sat at
 * one to three servers, and every genuine community at thirty-one to sixty-nine.
 * There was no overlap at all, which is why this is a hard floor rather than a
 * weighting: nothing legitimate was anywhere near it.
 *
 * The cost of the floor is real and worth stating: a hashtag used entirely within
 * one instance's own community is excluded, however healthy it is. For an index
 * of activity *across* the network that is arguably correct, since a single-server
 * tag is that server's local timeline rather than federated activity, and this
 * index would see it only if it happened to monitor that server. It is still a
 * trade-off rather than a free win.
 */
export const DEFAULT_MIN_ORIGIN_SERVERS = 4;

/**
 * Mean hashtags per post above which a tag looks like a broadcast template.
 *
 * Not enforced. Published so the interface can flag it and so the decision to
 * enforce it can be made against data rather than intuition.
 */
export const TAG_SPAM_ADVISORY = 10;

/**
 * Ceiling on the tracked set.
 *
 * The request budget would allow around 150, but writes are the tighter
 * constraint and the one that costs money, so this is set from the write budget
 * instead. It lives here rather than in the Worker entry point because both the
 * discovery pass and the search path have to respect it: a ceiling only the
 * promoter honours is not a ceiling, since anybody can add a tag by searching
 * for it, and a public URL gets crawled.
 */
export const MAX_TRACKED_TAGS = 50;

/** A tag somebody asked for that the index is not tracking. */
export interface QueriedTag {
  name: string;
  lastQueryAt: number;
  queryCount: number;
}

/**
 * Choose candidates to start tracking.
 *
 * Two floors, and both must be cleared. Enough distinct authors, which stops one
 * person posting repeatedly from earning a slot. And enough distinct origin
 * servers, which stops a publisher running many accounts on one or two servers,
 * because the author floor cannot tell that apart from a conversation.
 *
 * Ranked on server breadth rather than author count, because breadth is what the
 * index exists to measure. A tag alive on forty servers is a topic moving across
 * the network; a tag with more authors on five servers is a smaller thing, and
 * with slots scarce the broader one earns the slot.
 *
 * A candidate that clears both floors but finds no room stays a candidate. It is
 * still counted and still listed as discovered, it just is not polled yet.
 */
export function selectPromotions(
  candidates: readonly Candidate[],
  limits: PromotionLimits,
): string[] {
  const slots = Math.max(0, limits.maxTracked - limits.trackedCount);
  if (slots === 0) return [];

  const minAuthors = limits.minAuthors ?? DEFAULT_MIN_AUTHORS;
  const minServers = limits.minOriginServers ?? DEFAULT_MIN_ORIGIN_SERVERS;

  return candidates
    .filter((candidate) => candidate.distinctAuthors >= minAuthors)
    .filter((candidate) => candidate.distinctOriginServers >= minServers)
    .filter((candidate) => limits.blocked?.has(candidate.name) !== true)
    .sort(
      (a, b) =>
        b.distinctOriginServers - a.distinctOriginServers ||
        b.distinctAuthors - a.distinctAuthors ||
        a.name.localeCompare(b.name),
    )
    .slice(0, slots)
    .map((candidate) => candidate.name);
}

export interface RetirementLimits {
  now: number;
  /**
   * A tag with nothing observed and nobody asking for this long gives its slot
   * back. Retiring keeps the row and its history, so the decision is reversible
   * and a returning tag does not start from nothing.
   */
  quietForSeconds?: number;
  /**
   * A newly tracked tag is left alone for this long regardless. Without it a tag
   * admitted seconds ago, before any tick has polled it, would look quiet and be
   * retired immediately.
   */
  graceSeconds?: number;
}

export const DEFAULT_QUIET_SECONDS = 7 * 24 * 3600;
export const DEFAULT_GRACE_SECONDS = 24 * 3600;

/**
 * Choose tracked tags to retire.
 *
 * Two conditions, and both must hold. Nothing observed in the last day, and
 * nobody has asked about it recently. Human interest alone is enough to keep a
 * tag: somebody watching a quiet hashtag is a perfectly good reason to keep
 * watching it.
 */
export function selectRetirements(
  tracked: readonly TrackedTag[],
  limits: RetirementLimits,
): number[] {
  const quietFor = limits.quietForSeconds ?? DEFAULT_QUIET_SECONDS;
  const grace = limits.graceSeconds ?? DEFAULT_GRACE_SECONDS;

  return tracked
    .filter((tag) => limits.now - tag.firstSeenAt >= grace)
    .filter((tag) => tag.postsLast24h === 0)
    .filter((tag) => tag.lastQueryAt === null || limits.now - tag.lastQueryAt >= quietFor)
    .map((tag) => tag.id);
}

/**
 * Rank tags for the discovery page.
 *
 * Sorted by distinct authors rather than posts, for the same reason promotion
 * is. A tag where many people are talking belongs above a tag where one person
 * is posting a lot, whatever the totals say.
 */
export interface RankableTag {
  name: string;
  postsObserved: number;
  authorsObserved: number;
}

export type DiscoveryOrder = 'authors' | 'posts' | 'name';

export function rankTags<T extends RankableTag>(
  tags: readonly T[],
  order: DiscoveryOrder = 'authors',
): T[] {
  const sorted = [...tags];
  if (order === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }
  if (order === 'posts') {
    sorted.sort(
      (a, b) => b.postsObserved - a.postsObserved || a.name.localeCompare(b.name),
    );
    return sorted;
  }
  sorted.sort(
    (a, b) =>
      b.authorsObserved - a.authorsObserved ||
      b.postsObserved - a.postsObserved ||
      a.name.localeCompare(b.name),
  );
  return sorted;
}

/**
 * Posts per author, as a crowding signal for the discovery page.
 *
 * High means few people posting a lot, which is worth showing beside a count so
 * a tag that looks busy can be read for what it is. Null when there is nothing
 * to divide, rather than zero, because no authors is not a ratio.
 */
export function postsPerAuthor(postsObserved: number, authorsObserved: number): number | null {
  if (authorsObserved <= 0) return null;
  return Math.round((postsObserved / authorsObserved) * 10) / 10;
}

/**
 * Fill the free slots, taking tags people asked for before tags found by
 * co-occurrence.
 *
 * Human interest wins because it is the stronger signal and because somebody is
 * actually waiting on the answer. A tag found in the pool has nobody looking at
 * it yet, so it can wait for the next round.
 */
export function selectPromotionsWithQueried(
  queried: readonly QueriedTag[],
  candidates: readonly Candidate[],
  limits: PromotionLimits,
): string[] {
  const slots = Math.max(0, limits.maxTracked - limits.trackedCount);
  if (slots === 0) return [];

  const blocked = limits.blocked;
  const chosen: string[] = [];
  const taken = new Set<string>();

  const wanted = [...queried]
    .filter((tag) => blocked?.has(tag.name) !== true)
    .sort(
      (a, b) => b.lastQueryAt - a.lastQueryAt || b.queryCount - a.queryCount || a.name.localeCompare(b.name),
    );

  for (const tag of wanted) {
    if (chosen.length >= slots) break;
    if (taken.has(tag.name)) continue;
    chosen.push(tag.name);
    taken.add(tag.name);
  }

  if (chosen.length < slots) {
    const remaining = selectPromotions(candidates, {
      ...limits,
      trackedCount: limits.trackedCount + chosen.length,
    });
    for (const name of remaining) {
      if (chosen.length >= slots) break;
      if (taken.has(name)) continue;
      chosen.push(name);
      taken.add(name);
    }
  }

  return chosen;
}

/**
 * Bring an over-capacity tracked set back to the ceiling.
 *
 * Needed because the ceiling can be breached by things other than promotion, and
 * because lowering the ceiling should take effect rather than merely stopping
 * growth. The quietest tags go first, and a tag somebody has asked about
 * recently is never dropped: they are the reason the ceiling exists to be spent
 * on something.
 */
export function selectExcessRetirements(
  tracked: readonly TrackedTag[],
  limits: { now: number; maxTracked: number; protectQueriedWithinSeconds?: number },
): number[] {
  const excess = tracked.length - Math.max(0, limits.maxTracked);
  if (excess <= 0) return [];

  const protectWithin = limits.protectQueriedWithinSeconds ?? 24 * 3600;

  return [...tracked]
    .filter(
      (tag) => tag.lastQueryAt === null || limits.now - tag.lastQueryAt >= protectWithin,
    )
    .sort((a, b) => a.postsLast24h - b.postsLast24h || a.name.localeCompare(b.name))
    .slice(0, excess)
    .map((tag) => tag.id);
}

/** A tracked tag with the breadth figures needed to re-judge it. */
export interface TrackedBreadth {
  id: number;
  name: string;
  postsLast24h: number;
  originServersLast24h: number;
  lastQueryAt: number | null;
}

/**
 * Retire tracked tags that turn out not to be communities.
 *
 * The origin floor has to work backwards as well as forwards. The six news farms
 * that got in before the rule existed are busy, so the quiet-tag retirement will
 * never touch them, and they would sit on scarce slots indefinitely while genuine
 * candidates queue behind them.
 *
 * Only judged once a tag has produced enough posts to judge on. A tag with three
 * posts has narrow breadth because it is new, not because it is a broadcast, and
 * retiring it for that would be a rule that punishes quiet tags for being quiet.
 */
export function selectNonCommunityRetirements(
  tracked: readonly TrackedBreadth[],
  limits: {
    now: number;
    minOriginServers?: number;
    /** Posts needed before breadth is meaningful. */
    minPostsToJudge?: number;
    protectQueriedWithinSeconds?: number;
  },
): number[] {
  const minServers = limits.minOriginServers ?? DEFAULT_MIN_ORIGIN_SERVERS;
  const minPosts = limits.minPostsToJudge ?? 20;
  const protectWithin = limits.protectQueriedWithinSeconds ?? 24 * 3600;

  return tracked
    .filter((tag) => tag.postsLast24h >= minPosts)
    .filter((tag) => tag.originServersLast24h < minServers)
    .filter((tag) => tag.lastQueryAt === null || limits.now - tag.lastQueryAt >= protectWithin)
    .map((tag) => tag.id);
}

/**
 * Whether a tag's posts look like a broadcast template rather than people
 * tagging. Advisory only, surfaced in the interface rather than acted on.
 */
export function looksLikeTagSpam(meanTagsPerPost: number | null): boolean {
  return meanTagsPerPost !== null && meanTagsPerPost >= TAG_SPAM_ADVISORY;
}
