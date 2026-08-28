import { describe, expect, it } from 'vitest';
import { casefoldTag } from '../src/normalise';
import {
  evaluateCandidates,
  MAX_CANDIDATES,
  normaliseCandidates,
  summariseServerReports,
  unseenReading,
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
    // Few accounts is load-bearing here: the same ratio on a large tag is not
    // evidence of anything. See the #news case below.
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

describe('the two shapes of megaphone', () => {
  it('does not call a busy genuine tag a few accounts, whatever its ratio', () => {
    // #news: 14.3 posts per author, which the first version of this read as a
    // handful of accounts. 384 accounts across 99 servers says otherwise.
    const [news] = evaluateCandidates(
      [{ tag: 'news', display: 'news' }],
      [tracked({ name: 'news', postsObserved: 5334, authorsObserved: 384, originServers: 99 })],
      [],
    );
    expect(news?.posts_per_author).toBeCloseTo(13.9, 1);
    expect(news?.authors_per_server).toBeCloseTo(3.9, 1);
    expect(news?.reading).toContain('many different accounts');
    expect(news?.reading).not.toContain('a few accounts');
    expect(news?.reading).not.toContain('publisher');
  });

  it('calls out a publisher: many accounts concentrated on few servers', () => {
    // #headlines: 67 accounts on 4 servers. Ratio per author is unremarkable.
    const [headlines] = evaluateCandidates(
      [{ tag: 'headlines', display: 'headlines' }],
      [tracked({ name: 'headlines', postsObserved: 1273, authorsObserved: 67, originServers: 4 })],
      [],
    );
    expect(headlines?.authors_per_server).toBeCloseTo(16.8, 1);
    expect(headlines?.reading).toContain('publisher');
  });

  it('calls out a small group shouting, which the server ratio cannot see', () => {
    // 3 accounts, 90 posts, 1 server. Only 3.0 accounts per server, so the
    // publisher test passes it; the author ceiling plus the ratio catches it.
    const [shout] = evaluateCandidates(
      [{ tag: 'shout', display: 'shout' }],
      [tracked({ name: 'shout', postsObserved: 90, authorsObserved: 3, originServers: 1 })],
      [],
    );
    expect(shout?.authors_per_server).toBe(3);
    expect(shout?.reading).toContain('a few accounts posting a lot');
  });

  it('leaves a small quiet community alone', () => {
    // #buddhism: 7 accounts, 3 servers, 3 posts each. Neither test should fire.
    const [buddhism] = evaluateCandidates(
      [{ tag: 'buddhism', display: 'buddhism' }],
      [tracked({ name: 'buddhism', postsObserved: 21, authorsObserved: 7, originServers: 3 })],
      [],
    );
    expect(buddhism?.reading).toContain('many different accounts');
    expect(buddhism?.reading).not.toContain('publisher');
  });
});

describe('server-reported fallback for unseen tags', () => {
  it('summarises across servers and keeps the per-server split', () => {
    const s = summariseServerReports([
      { host: 'b.example', days: [{ day: 1, uses: 5, accounts: 3 }, { day: 2, uses: 2, accounts: 2 }] },
      { host: 'a.example', days: [{ day: 1, uses: 10, accounts: 8 }] },
    ]);
    expect(s?.source_servers).toEqual(['a.example', 'b.example']);
    expect(s?.uses_7d).toBe(17);
    expect(s?.accounts_7d).toBe(13);
    expect(s?.peak_day_accounts).toBe(8);
    expect(s?.note).toContain('without deduplication');
  });

  it('is null when nobody reported, and drops servers with no days', () => {
    expect(summariseServerReports([])).toBeNull();
    expect(summariseServerReports([{ host: 'x', days: [] }])).toBeNull();
  });

  it('reads as server-reported, never as observed', () => {
    const s = summariseServerReports([{ host: 'a', days: [{ day: 1, uses: 31, accounts: 20 }] }]);
    expect(unseenReading(s)).toBe(
      'Not seen by this index, but 1 server asked directly reports about 20 accounts using it in the last seven days (31 uses). Server-reported, not observed.',
    );
    expect(unseenReading(null)).toBe('No evidence either way.');
  });

  it('says so when servers were asked and report nothing', () => {
    const s = summariseServerReports([{ host: 'a', days: [{ day: 1, uses: 0, accounts: 0 }] }]);
    expect(unseenReading(s)).toContain('report no use');
  });
});
