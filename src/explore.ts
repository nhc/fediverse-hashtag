/**
 * Layout for the explore page: where each tag lands on the scatter, and how its
 * day is drawn in the rhythm strip.
 *
 * Kept free of HTML and of the database so the geometry can be tested. The two
 * charts encode the same argument the ranking makes in words: distinct authors
 * are the measure of a conversation, and posts per author is the measure of
 * whether a count is many people or one person repeating themselves.
 */

import type { Tier } from './types';

export interface ExploreTag {
  id: number;
  name: string;
  display: string;
  tier: Tier;
  posts24h: number;
  authors24h: number;
  originServers: number;
  /** 24 hourly buckets, oldest first. */
  hourly: readonly number[];
}

export interface ScatterPoint {
  tag: ExploreTag;
  x: number;
  y: number;
  r: number;
  postsPerAuthor: number;
}

export interface ScatterFrame {
  width: number;
  height: number;
  /** Inner margins, so labels and the largest dot stay inside the viewBox. */
  pad: { top: number; right: number; bottom: number; left: number };
}

export const DEFAULT_FRAME: ScatterFrame = {
  width: 720,
  height: 380,
  pad: { top: 16, right: 24, bottom: 40, left: 48 },
};

/** Posts per author is the gap between a conversation and a megaphone. */
export const SHOUTING_THRESHOLD = 5;

/**
 * Both axes are log scales. Author counts have a long tail, and a linear axis
 * would pile every ordinary tag into the left edge to make room for one outlier.
 */
export function logScale(value: number, min: number, max: number, from: number, to: number): number {
  const lo = Math.log1p(Math.max(0, min));
  const hi = Math.log1p(Math.max(0, max));
  if (hi <= lo) return (from + to) / 2;
  const share = (Math.log1p(Math.max(0, value)) - lo) / (hi - lo);
  return from + share * (to - from);
}

/** Dot radius grows with the square root of server count, so area is honest. */
export function dotRadius(originServers: number, peak: number): number {
  const share = peak <= 0 ? 0 : Math.sqrt(Math.max(0, originServers) / peak);
  return 4 + share * 12;
}

export function postsPerAuthor(posts: number, authors: number): number {
  return authors <= 0 ? 0 : Math.round((posts / authors) * 10) / 10;
}

/**
 * Tags with no authors in the window are left off the scatter. They have no
 * position to take, and drawing them at the origin would suggest a fact.
 */
export function scatterPoints(tags: readonly ExploreTag[], frame: ScatterFrame = DEFAULT_FRAME): ScatterPoint[] {
  const active = tags.filter((tag) => tag.authors24h > 0);
  if (active.length === 0) return [];

  const maxAuthors = Math.max(...active.map((tag) => tag.authors24h));
  const ratios = active.map((tag) => postsPerAuthor(tag.posts24h, tag.authors24h));
  const maxRatio = Math.max(SHOUTING_THRESHOLD * 2, ...ratios);
  const peakServers = Math.max(1, ...active.map((tag) => tag.originServers));

  const left = frame.pad.left;
  const right = frame.width - frame.pad.right;
  const top = frame.pad.top;
  const bottom = frame.height - frame.pad.bottom;

  return active.map((tag, index) => {
    const ratio = ratios[index] ?? 0;
    return {
      tag,
      x: round(logScale(tag.authors24h, 1, maxAuthors, left, right)),
      y: round(logScale(ratio, 1, maxRatio, bottom, top)),
      r: round(dotRadius(tag.originServers, peakServers)),
      postsPerAuthor: ratio,
    };
  });
}

/** Where the shouting line sits on the y axis, for the same frame and data. */
export function thresholdY(tags: readonly ExploreTag[], frame: ScatterFrame = DEFAULT_FRAME): number | null {
  const active = tags.filter((tag) => tag.authors24h > 0);
  if (active.length === 0) return null;
  const maxRatio = Math.max(
    SHOUTING_THRESHOLD * 2,
    ...active.map((tag) => postsPerAuthor(tag.posts24h, tag.authors24h)),
  );
  return round(logScale(SHOUTING_THRESHOLD, 1, maxRatio, frame.height - frame.pad.bottom, frame.pad.top));
}

/** Nice-ish tick values for a log axis: 1, 2, 5, 10, 20, 50 ... up to max. */
export function logTicks(max: number): number[] {
  const ticks: number[] = [];
  for (let magnitude = 1; magnitude <= Math.max(1, max); magnitude *= 10) {
    for (const step of [1, 2, 5]) {
      const value = magnitude * step;
      if (value <= max) ticks.push(value);
    }
  }
  return ticks.length === 0 ? [1] : ticks;
}

/**
 * A rhythm strip is one polyline per tag, each normalised to its own peak.
 * Volume is the scatter's job; this shows shape, so a quiet tag with a clear
 * evening peak reads as clearly as a busy one.
 */
export function rhythmPath(hourly: readonly number[], width: number, height: number): string {
  if (hourly.length < 2) return '';
  const peak = Math.max(1, ...hourly);
  const step = width / (hourly.length - 1);
  return hourly
    .map((posts, index) => {
      const x = round(index * step);
      const y = round(height - (posts / peak) * (height - 2) - 1);
      return `${x},${y}`;
    })
    .join(' ');
}

/** Sort for the strip: by tier, then busiest first, so hot tags lead. */
export function stripOrder(tags: readonly ExploreTag[]): ExploreTag[] {
  const rank: Record<Tier, number> = { hot: 0, warm: 1, cold: 2 };
  return [...tags].sort((a, b) => rank[a.tier] - rank[b.tier] || b.authors24h - a.authors24h || a.name.localeCompare(b.name));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
