import { describe, expect, it } from 'vitest';
import {
  MAX_LIMIT,
  buildTagTimelineUrl,
  newestId,
  parsePrevCursor,
  parseRateLimitReset,
} from '../src/mastodon';
import type { MastodonStatus } from '../src/types';

describe('buildTagTimelineUrl', () => {
  it('puts the first tag in the path', () => {
    expect(buildTagTimelineUrl('mastodon.social', ['cats'], null)).toBe(
      'https://mastodon.social/api/v1/timelines/tag/cats?limit=40',
    );
  });

  it('batches the rest as any[], which is what makes the budget stretch', () => {
    const url = new URL(buildTagTimelineUrl('mastodon.social', ['cats', 'dogs', 'birds'], null));
    expect(url.pathname).toBe('/api/v1/timelines/tag/cats');
    expect(url.searchParams.getAll('any[]')).toEqual(['dogs', 'birds']);
  });

  it('passes min_id when there is a cursor, and omits it when there is not', () => {
    const withCursor = new URL(buildTagTimelineUrl('a.example', ['cats'], '117168066166883357'));
    expect(withCursor.searchParams.get('min_id')).toBe('117168066166883357');
    const without = new URL(buildTagTimelineUrl('a.example', ['cats'], null));
    expect(without.searchParams.has('min_id')).toBe(false);
  });

  it('never asks for more than the server will give', () => {
    const url = new URL(buildTagTimelineUrl('a.example', ['cats'], null, 500));
    expect(url.searchParams.get('limit')).toBe(String(MAX_LIMIT));
  });

  it('escapes a tag rather than letting it alter the path', () => {
    const url = new URL(buildTagTimelineUrl('a.example', ['../../admin'], null));
    expect(url.pathname).toBe('/api/v1/timelines/tag/..%2F..%2Fadmin');
  });

  it('refuses to build a request for no tags', () => {
    expect(() => buildTagTimelineUrl('a.example', [], null)).toThrow();
  });
});

describe('parsePrevCursor', () => {
  it('takes min_id from rel="prev", which is the newest id in the page', () => {
    const header =
      '<https://mastodon.social/api/v1/timelines/tag/cats?limit=2&max_id=117168011495507211>; rel="next", ' +
      '<https://mastodon.social/api/v1/timelines/tag/cats?limit=2&min_id=117168066166883357>; rel="prev"';
    expect(parsePrevCursor(header)).toBe('117168066166883357');
  });

  it('does not mistake rel="next" for a cursor', () => {
    const header = '<https://a.example/x?max_id=999>; rel="next"';
    expect(parsePrevCursor(header)).toBeNull();
  });

  it('copes with unquoted rel and odd spacing', () => {
    expect(parsePrevCursor('<https://a.example/x?min_id=7>; rel = prev')).toBe('7');
  });

  it('is null for a missing or unusable header', () => {
    expect(parsePrevCursor(null)).toBeNull();
    expect(parsePrevCursor('nonsense')).toBeNull();
    expect(parsePrevCursor('<not a url>; rel="prev"')).toBeNull();
  });
});

describe('parseRateLimitReset', () => {
  it('parses the iso timestamp mastodon actually sends', () => {
    expect(parseRateLimitReset('2026-08-27T15:00:00.052421Z')).toBe(
      Math.floor(Date.parse('2026-08-27T15:00:00.052421Z') / 1000),
    );
  });

  it('accepts a plain epoch, in case a server sends one', () => {
    expect(parseRateLimitReset('1787788800')).toBe(1_787_788_800);
  });

  it('is null for nothing or nonsense', () => {
    expect(parseRateLimitReset(null)).toBeNull();
    expect(parseRateLimitReset('soon')).toBeNull();
  });
});

describe('newestId', () => {
  const status = (id: string) => ({ id }) as MastodonStatus;

  it('finds the highest id numerically, not lexically', () => {
    // '9' sorts after '10' as a string but is lower as a number.
    expect(newestId([status('9'), status('10')])).toBe('10');
  });

  it('handles ids beyond the safe integer range', () => {
    expect(newestId([status('117168066166883357'), status('117168066166883358')])).toBe(
      '117168066166883358',
    );
  });

  it('ignores malformed ids rather than picking one', () => {
    expect(newestId([status('abc'), status('5')])).toBe('5');
  });

  it('is null for an empty page', () => {
    expect(newestId([])).toBeNull();
  });
});
