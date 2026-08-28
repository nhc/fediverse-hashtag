/**
 * Evaluating hashtags somebody is thinking of using, against what the index
 * has seen. Pure.
 *
 * The index stores no post content, so it cannot read a draft and say which
 * tags fit it. What it can say is whether anybody is using a tag, whether that
 * use is a conversation or one account shouting, and how many servers it
 * reaches. A browser agent does the language; this module does the evidence.
 *
 * Nothing here registers a query. Evaluating ten candidates is a very different
 * act from searching for one, and the tracked-set ceiling would be walked past
 * if it counted as ten searches.
 */

import { postsPerAuthor } from './discovery';

/** How many candidates one evaluation will consider. */
export const MAX_CANDIDATES = 10;

/** Where a tag stands with the index. Affects how much the figures mean. */
export type Standing = 'tracked' | 'discovered' | 'unseen';

export interface TrackedEvidence {
  name: string;
  display: string | null;
  postsObserved: number;
  authorsObserved: number;
  originServers: number;
  posts1h: number;
  authors1h: number;
}

export interface DiscoveredEvidence {
  name: string;
  distinctAuthors: number;
  distinctOriginServers: number;
  postsPerAuthor: number | null;
}

export interface CandidateEvaluation {
  tag: string;
  display: string;
  standing: Standing;
  /** Plain words on what the standing means for the figures beside it. */
  standing_note: string;
  authors_24h: number | null;
  posts_24h: number | null;
  origin_servers_24h: number | null;
  posts_per_author: number | null;
  authors_1h: number | null;
  /** A one-line reading an agent can quote. Never a recommendation. */
  reading: string;
}

const STANDING_NOTES: Record<Standing, string> = {
  tracked:
    'Polled by this index. Figures are observations over 24 hours, deduplicated ' +
    'across the monitored servers.',
  discovered:
    'Seen alongside tracked tags in the last 48 hours but not polled itself. ' +
    'Figures are sightings, a lower bound on use, and there is no hourly view.',
  unseen:
    'Not seen by this index. That says nothing about whether the tag is used ' +
    'elsewhere, only that none of the monitored servers showed it on the tags ' +
    'being watched.',
};

/**
 * Casefold, strip a leading hash, drop anything that is not a hashtag, dedupe,
 * and cap. Returns the casefolded key beside what the person wrote, so the reply
 * can use their casing.
 */
export function normaliseCandidates(
  raw: readonly string[],
  casefold: (name: string) => string,
): Array<{ tag: string; display: string }> {
  const seen = new Set<string>();
  const out: Array<{ tag: string; display: string }> = [];
  for (const item of raw) {
    const display = item.trim().replace(/^#/, '');
    if (display.length === 0 || display.length > 100) continue;
    if (!/^[\p{L}\p{N}_]+$/u.test(display)) continue;
    const tag = casefold(display);
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, display });
    if (out.length === MAX_CANDIDATES) break;
  }
  return out;
}

function reading(evaluation: Omit<CandidateEvaluation, 'reading'>): string {
  if (evaluation.standing === 'unseen') return 'No evidence either way.';
  const authors = evaluation.authors_24h ?? 0;
  const servers = evaluation.origin_servers_24h ?? 0;
  const ratio = evaluation.posts_per_author;
  if (authors === 0) return 'Known to the index but nothing observed in the last 24 hours.';
  const crowd = ratio !== null && ratio >= 3 ? 'a few accounts posting a lot' : 'many different accounts';
  const spread = servers <= 1 ? 'on one server' : `across ${servers} servers`;
  const recent =
    evaluation.authors_1h === null
      ? ''
      : evaluation.authors_1h > 0
        ? ` ${evaluation.authors_1h} in the last hour.`
        : ' Quiet in the last hour.';
  return `${authors} accounts over 24 hours, ${crowd}, ${spread}.${recent}`;
}

/**
 * Evaluate each candidate and rank by evidence of a conversation: distinct
 * authors first, then server breadth, then name. Unseen tags sort last but are
 * kept, because "nobody the index can see uses this" is itself an answer.
 */
export function evaluateCandidates(
  candidates: readonly { tag: string; display: string }[],
  tracked: readonly TrackedEvidence[],
  discovered: readonly DiscoveredEvidence[],
): CandidateEvaluation[] {
  const trackedByName = new Map(tracked.map((t) => [t.name, t]));
  const discoveredByName = new Map(discovered.map((d) => [d.name, d]));

  const evaluated = candidates.map((candidate): CandidateEvaluation => {
    const t = trackedByName.get(candidate.tag);
    if (t !== undefined) {
      const base = {
        tag: candidate.tag,
        display: t.display ?? candidate.display,
        standing: 'tracked' as const,
        standing_note: STANDING_NOTES.tracked,
        authors_24h: t.authorsObserved,
        posts_24h: t.postsObserved,
        origin_servers_24h: t.originServers,
        posts_per_author: postsPerAuthor(t.postsObserved, t.authorsObserved),
        authors_1h: t.authors1h,
      };
      return { ...base, reading: reading(base) };
    }
    const d = discoveredByName.get(candidate.tag);
    if (d !== undefined) {
      const base = {
        tag: candidate.tag,
        display: candidate.display,
        standing: 'discovered' as const,
        standing_note: STANDING_NOTES.discovered,
        authors_24h: d.distinctAuthors,
        posts_24h: null,
        origin_servers_24h: d.distinctOriginServers,
        posts_per_author: d.postsPerAuthor,
        authors_1h: null,
      };
      return { ...base, reading: reading(base) };
    }
    const base = {
      tag: candidate.tag,
      display: candidate.display,
      standing: 'unseen' as const,
      standing_note: STANDING_NOTES.unseen,
      authors_24h: null,
      posts_24h: null,
      origin_servers_24h: null,
      posts_per_author: null,
      authors_1h: null,
    };
    return { ...base, reading: reading(base) };
  });

  evaluated.sort(
    (a, b) =>
      (b.authors_24h ?? -1) - (a.authors_24h ?? -1) ||
      (b.origin_servers_24h ?? -1) - (a.origin_servers_24h ?? -1) ||
      a.tag.localeCompare(b.tag),
  );
  return evaluated;
}
