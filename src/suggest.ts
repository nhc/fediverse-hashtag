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

import { DEFAULT_MAX_AUTHORS_PER_SERVER, postsPerAuthor } from './discovery';

/**
 * Threshold for calling a tag concentrated, shared with promotion so the words an
 * agent says match the rule the index applies.
 */
const CONCENTRATED_AUTHORS_PER_SERVER = DEFAULT_MAX_AUTHORS_PER_SERVER;

/**
 * The two shapes of megaphone, which need two different tests.
 *
 * Authors per server catches a publisher: many accounts concentrated on few
 * servers. It cannot catch the other shape, because three accounts on one server
 * is only 3.0 per server and passes.
 *
 * Posts per author catches that other shape, a handful of accounts posting
 * repeatedly. On its own it is useless as a verdict, because a busy genuine tag
 * climbs on it too: #news reached 14.3 with 384 accounts across 99 servers. Paired
 * with a ceiling on author count it becomes precise, because "few accounts, each
 * posting a lot" is exactly the claim being made.
 */
const FEW_AUTHORS = 10;
const REPETITIVE_POSTS_PER_AUTHOR = 5;

function authorsPerServer(authors: number, servers: number): number | null {
  return servers > 0 ? Math.round((authors / servers) * 10) / 10 : null;
}

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
  /**
   * The publisher test: accounts divided by servers. Above about 5 means the
   * accounts are concentrated in one place, which is what a feed looks like.
   */
  authors_per_server: number | null;
  /**
   * How concentrated the posting is. Context, not a verdict: a busy genuine tag
   * climbs on this measure too, so it must not be read as evidence of a farm.
   */
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

/**
 * A line an agent can quote.
 *
 * Two tests, because there are two shapes of megaphone. Many accounts on few
 * servers is a publisher. Few accounts posting repeatedly is a small group
 * shouting. Neither test catches the other's case.
 *
 * An earlier version used posts per author alone at a threshold of 3, which would
 * have described #news as "a few accounts posting a lot" while it had 384 accounts
 * across 99 servers. Getting this right matters more here than anywhere else in
 * the service, because this sentence is read aloud to somebody by an assistant
 * rather than sitting in a table where they can see the figures beside it.
 */
function reading(evaluation: Omit<CandidateEvaluation, 'reading'>): string {
  if (evaluation.standing === 'unseen') return 'No evidence either way.';
  const authors = evaluation.authors_24h ?? 0;
  const servers = evaluation.origin_servers_24h ?? 0;
  if (authors === 0) return 'Known to the index but nothing observed in the last 24 hours.';

  const perServer = evaluation.authors_per_server;
  const ratio = evaluation.posts_per_author;

  let shape: string;
  if (perServer !== null && perServer > CONCENTRATED_AUTHORS_PER_SERVER) {
    shape = `but ${perServer} accounts per server, which is the shape of a publisher rather than a conversation`;
  } else if (authors < FEW_AUTHORS && ratio !== null && ratio >= REPETITIVE_POSTS_PER_AUTHOR) {
    shape = `a few accounts posting a lot, ${ratio} posts each`;
  } else {
    shape = 'many different accounts';
  }
  const spread = servers <= 1 ? 'on one server' : `across ${servers} servers`;
  const recent =
    evaluation.authors_1h === null
      ? ''
      : evaluation.authors_1h > 0
        ? ` ${evaluation.authors_1h} in the last hour.`
        : ' Quiet in the last hour.';
  return `${authors} accounts over 24 hours, ${shape}, ${spread}.${recent}`;
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
        authors_per_server: authorsPerServer(t.authorsObserved, t.originServers),
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
        authors_per_server: authorsPerServer(d.distinctAuthors, d.distinctOriginServers),
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
      authors_per_server: null,
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

/**
 * What servers say about a tag the index has not seen.
 *
 * A different kind of number to everything else here: each server's own daily
 * counters, at day granularity, for the last week. Presented under its own key
 * and never folded into the observed figures. It answers the question the
 * index otherwise cannot, "does anybody use this at all", for the long tail of
 * tags outside the tracked set and its discovery pool.
 */
export interface ServerReportedDay {
  day: number;
  uses: number;
  accounts: number;
}

export interface ServerReport {
  host: string;
  days: readonly ServerReportedDay[];
}

export interface ServerReportedSummary {
  note: string;
  source_servers: string[];
  /** Sum across servers. Not deduplicated between servers: an upper bound. */
  uses_7d: number;
  accounts_7d: number;
  /** Highest single-day account count on any one server. */
  peak_day_accounts: number;
  per_server: Array<{ host: string; uses_7d: number; accounts_7d: number }>;
}

export const SERVER_REPORTED_NOTE =
  'Daily counters the servers keep about themselves, for the last seven days. ' +
  'A different source at a different granularity from the observed figures, ' +
  'and totals are summed across servers without deduplication, so treat them ' +
  'as an indication that the tag is in use, not as a count.';

/** Summarise per-server counters. Null when no server reported anything. */
export function summariseServerReports(reports: readonly ServerReport[]): ServerReportedSummary | null {
  const perServer = reports
    .filter((r) => r.days.length > 0)
    .map((r) => ({
      host: r.host,
      uses_7d: r.days.reduce((n, d) => n + d.uses, 0),
      accounts_7d: r.days.reduce((n, d) => n + d.accounts, 0),
      peak: r.days.reduce((n, d) => Math.max(n, d.accounts), 0),
    }))
    .sort((a, b) => a.host.localeCompare(b.host));
  if (perServer.length === 0) return null;
  return {
    note: SERVER_REPORTED_NOTE,
    source_servers: perServer.map((s) => s.host),
    uses_7d: perServer.reduce((n, s) => n + s.uses_7d, 0),
    accounts_7d: perServer.reduce((n, s) => n + s.accounts_7d, 0),
    peak_day_accounts: perServer.reduce((n, s) => Math.max(n, s.peak), 0),
    per_server: perServer.map(({ host, uses_7d, accounts_7d }) => ({ host, uses_7d, accounts_7d })),
  };
}

/**
 * The reading for an unseen tag once servers have been asked. Replaces
 * "No evidence either way" with what they said, in the same register.
 */
export function unseenReading(summary: ServerReportedSummary | null): string {
  if (summary === null) return 'No evidence either way.';
  if (summary.accounts_7d === 0) {
    return `Not seen by this index, and ${summary.source_servers.length} server(s) asked directly report no use in the last seven days.`;
  }
  const n = summary.source_servers.length;
  return (
    `Not seen by this index, but ${n} server${n === 1 ? '' : 's'} asked directly ` +
    `report${n === 1 ? 's' : ''} about ${summary.accounts_7d} account${summary.accounts_7d === 1 ? '' : 's'} using it ` +
    `in the last seven days (${summary.uses_7d} uses). Server-reported, not observed.`
  );
}
