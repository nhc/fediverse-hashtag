/**
 * What is rising among the tags the index watches. Pure.
 *
 * "Trending" is a claim about change, and change can only be measured when the
 * two periods saw a comparable slice of the network. So every entry carries a
 * direction that may be 'not_comparable', and the list is ranked by distinct
 * authors in the window rather than by growth, because growth from two authors
 * to four is noise and a tag one account spams should never reach the top.
 *
 * This reads the tracked set only. It registers nothing.
 */

export const MAX_TRENDING = 10;
export const DEFAULT_TRENDING = 5;

/** A change smaller than this, either way, is reported as flat. */
export const FLAT_BAND = 0.1;

export type Direction = 'up' | 'down' | 'flat' | 'not_comparable' | 'insufficient';

export interface TrendingInput {
  name: string;
  display: string | null;
  authors1h: number;
  authorsPrev1h: number;
  posts1h: number;
  authors24h: number;
  originServers24h: number;
}

export interface TrendingEntry {
  tag: string;
  display: string;
  authors_1h: number;
  posts_1h: number;
  authors_24h: number;
  origin_servers_24h: number;
  trend: {
    direction: Direction;
    authors_previous_1h: number;
    change: number | null;
    reason: string | null;
  };
}

/** Too few authors in either hour to call a direction. */
const MIN_AUTHORS_FOR_TREND = 5;

export function direction(
  current: number,
  previous: number,
  comparable: boolean,
): { direction: Direction; change: number | null; reason: string | null } {
  if (!comparable) {
    return {
      direction: 'not_comparable',
      change: null,
      reason:
        'The two hours were reported by different shares of the monitored servers, ' +
        'so a change in the count could be a change in coverage.',
    };
  }
  if (Math.max(current, previous) < MIN_AUTHORS_FOR_TREND) {
    return {
      direction: 'insufficient',
      change: null,
      reason: `Fewer than ${MIN_AUTHORS_FOR_TREND} authors in both hours; too little to call a direction.`,
    };
  }
  if (previous === 0) return { direction: 'up', change: null, reason: 'Nothing in the previous hour.' };
  const change = (current - previous) / previous;
  if (Math.abs(change) < FLAT_BAND) return { direction: 'flat', change, reason: null };
  return { direction: change > 0 ? 'up' : 'down', change, reason: null };
}

export function rankTrending(
  tags: readonly TrendingInput[],
  comparable: boolean,
  limit = DEFAULT_TRENDING,
): TrendingEntry[] {
  const bounded = Math.max(1, Math.min(MAX_TRENDING, Math.floor(limit)));
  return [...tags]
    .filter((t) => t.authors1h > 0)
    .sort(
      (a, b) =>
        b.authors1h - a.authors1h ||
        b.originServers24h - a.originServers24h ||
        a.name.localeCompare(b.name),
    )
    .slice(0, bounded)
    .map((t) => {
      const d = direction(t.authors1h, t.authorsPrev1h, comparable);
      return {
        tag: t.name,
        display: t.display ?? t.name,
        authors_1h: t.authors1h,
        posts_1h: t.posts1h,
        authors_24h: t.authors24h,
        origin_servers_24h: t.originServers24h,
        trend: {
          direction: d.direction,
          authors_previous_1h: t.authorsPrev1h,
          change: d.change === null ? null : Math.round(d.change * 100) / 100,
          reason: d.reason,
        },
      };
    });
}
