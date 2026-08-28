import { describe, expect, it } from 'vitest';
import { casefoldTag } from '../src/normalise';
import {
  evaluateCandidates,
  MAX_CANDIDATES,
  normaliseCandidates,
  type DiscoveredEvidence,
  type TrackedEvidence,
} from '../src/suggest';

const tracked = (over: Partial<TrackedEvidence> & { name: string }): TrackedEvidence => ({
  display: null,
  postsObserved: 0,
  authorsObserved: 0,
  originServers: 0,
  posts1h: 0,
  authors1h: 0,
  ...over,
});

const discovered = (
  over: Partial<DiscoveredEvidence> & { name: string },
): DiscoveredEvidence => ({
  distinctAuthors: 0,
  distinctOriginServers: 0,
  postsPerAuthor: null,
  ...over,
});

describe('normaliseCandidates', () => {
  it('strips hashes, casefolds, dedupes, and keeps the casing the person wrote', () => {
    const out = normaliseCandidates(['#Cats', 'cats', ' CATS ', 'Dogs'], casefoldTag);
    expect(out).toEqual([
      { tag: 'cats', display: 'Cats' },
      { tag: 'dogs', display: 'Dogs' },
    ]);
  });

  it('drops anything that is not a hashtag', () => {
    const out = normaliseCandidates(['', '#', 'two words', 'fine_tag', 'x'.repeat(101)], casefoldTag);
    expect(out.map((c) => c.tag)).toEqual(['fine_tag']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => `t${i}`);
    expect(normaliseCandidates(many, casefoldTag)).toHaveLength(MAX_CANDIDATES);
  });
});

describe('evaluateCandidates', () => {
  const candidates = [
    { tag: 'cats', display: 'Cats' },
    { tag: 'obscure', display: 'obscure' },
    { tag: 'caturday', display: 'Caturday' },
  ];

  it('gives each candidate a standing and never drops the unseen ones', () => {
    const out = evaluateCandidates(
      candidates,
      [tracked({ name: 'cats', display: 'cats', postsObserved: 40, authorsObserved: 25, originServers: 6, authors1h: 3 })],
      [discovered({ name: 'caturday', distinctAuthors: 9, distinctOriginServers: 4 })],
    );
    expect(out.map((c) => [c.tag, c.standing])).toEqual([
      ['cats', 'tracked'],
      ['caturday', 'discovered'],
      ['obscure', 'unseen'],
    ]);
  });

  it('ranks by distinct authors, then server breadth, unseen last', () => {
    const out = evaluateCandidates(
      [
        { tag: 'a', display: 'a' },
        { tag: 'b', display: 'b' },
        { tag: 'c', display: 'c' },
        { tag: 'z', display: 'z' },
      ],
      [tracked({ name: 'a', postsObserved: 10, authorsObserved: 5, originServers: 2 })],
      [
        discovered({ name: 'b', distinctAuthors: 5, distinctOriginServers: 4 }),
        discovered({ name: 'c', distinctAuthors: 7, distinctOriginServers: 1 }),
      ],
    );
    expect(out.map((c) => c.tag)).toEqual(['c', 'b', 'a', 'z']);
  });

  it('reads a high posts-per-author ratio as a few accounts, not a conversation', () => {
    const [loud] = evaluateCandidates(
      [{ tag: 'loud', display: 'loud' }],
      [tracked({ name: 'loud', postsObserved: 90, authorsObserved: 3, originServers: 1 })],
      [],
    );
    expect(loud?.posts_per_author).toBe(30);
    expect(loud?.reading).toContain('a few accounts posting a lot');
    expect(loud?.reading).toContain('on one server');
  });

  it('says so plainly when a tracked tag has seen nothing', () => {
    const [quiet] = evaluateCandidates(
      [{ tag: 'quiet', display: 'quiet' }],
      [tracked({ name: 'quiet' })],
      [],
    );
    expect(quiet?.reading).toContain('nothing observed');
  });

  it('gives an unseen tag no figures and a note that absence is not evidence', () => {
    const [unseen] = evaluateCandidates([{ tag: 'nope', display: 'nope' }], [], []);
    expect(unseen?.authors_24h).toBeNull();
    expect(unseen?.standing_note).toContain('says nothing about whether the tag is used');
  });

  it('has no hourly figure for a discovered tag, rather than a misleading zero', () => {
    const [d] = evaluateCandidates(
      [{ tag: 'd', display: 'd' }],
      [],
      [discovered({ name: 'd', distinctAuthors: 4, distinctOriginServers: 2 })],
    );
    expect(d?.authors_1h).toBeNull();
    expect(d?.posts_24h).toBeNull();
  });
});
