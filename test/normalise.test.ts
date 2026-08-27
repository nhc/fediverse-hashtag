import { describe, expect, it } from 'vitest';
import { authorHash, casefoldTag, hashKey, normalise, originHost } from '../src/normalise';
import type { MastodonStatus } from '../src/types';

const SALT = 'test-salt';

function status(overrides: Partial<MastodonStatus> = {}): MastodonStatus {
  return {
    id: '117168066166883357',
    uri: 'https://piaille.fr/users/CatEveryHour/statuses/117168066011718672',
    url: 'https://piaille.fr/@CatEveryHour/117168066011718672',
    created_at: '2026-08-27T15:00:04.000Z',
    visibility: 'public',
    language: 'fr',
    sensitive: false,
    reblog: null,
    account: { acct: 'CatEveryHour@piaille.fr' },
    tags: [{ name: 'cats' }, { name: 'mastocats' }],
    ...overrides,
  };
}

describe('originHost', () => {
  it('takes the host from the object id, not the account', () => {
    expect(originHost('https://piaille.fr/users/x/statuses/1')).toBe('piaille.fr');
  });

  it('lowercases, because hosts are case-insensitive but our grouping is not', () => {
    expect(originHost('https://Mastodon.Social/users/x/statuses/1')).toBe('mastodon.social');
  });

  it('rejects anything that is not an http url', () => {
    expect(originHost('not a url')).toBeNull();
    expect(originHost('')).toBeNull();
    expect(originHost('javascript:alert(1)')).toBeNull();
    expect(originHost('mailto:someone@example.com')).toBeNull();
  });
});

describe('authorHash', () => {
  it('is sixteen bytes', async () => {
    expect((await authorHash(SALT, 'a@b.example')).byteLength).toBe(16);
  });

  it('is stable for the same handle', async () => {
    const first = await authorHash(SALT, 'a@b.example');
    const second = await authorHash(SALT, 'a@b.example');
    expect(hashKey(first)).toBe(hashKey(second));
  });

  it('ignores handle casing, so one author is not counted twice', async () => {
    const lower = await authorHash(SALT, 'cateveryhour@piaille.fr');
    const mixed = await authorHash(SALT, 'CatEveryHour@Piaille.fr');
    expect(hashKey(lower)).toBe(hashKey(mixed));
  });

  it('differs by salt, so the hash cannot be matched against a guessed handle', async () => {
    const a = await authorHash('salt-one', 'a@b.example');
    const b = await authorHash('salt-two', 'a@b.example');
    expect(hashKey(a)).not.toBe(hashKey(b));
  });

  it('differs by handle', async () => {
    const a = await authorHash(SALT, 'a@b.example');
    const b = await authorHash(SALT, 'c@d.example');
    expect(hashKey(a)).not.toBe(hashKey(b));
  });
});

describe('casefoldTag', () => {
  it('folds case so Cats and cats are one tag', () => {
    expect(casefoldTag('Cats')).toBe('cats');
    expect(casefoldTag('CatsOfMastodon')).toBe('catsofmastodon');
  });

  it('normalises unicode width so lookalike tags collapse', () => {
    expect(casefoldTag('ｃats')).toBe('cats');
  });
});

describe('normalise', () => {
  it('keeps only the fields the index stores', async () => {
    const { posts } = await normalise([status()], { salt: SALT });
    expect(posts).toHaveLength(1);
    expect(Object.keys(posts[0]!).sort()).toEqual([
      'authorHash',
      'createdAt',
      'isBoost',
      'language',
      'originHost',
      'sensitive',
      'tags',
      'uri',
      'url',
    ]);
  });

  it('uses the post timestamp, not the time of observation', async () => {
    const { posts } = await normalise([status()], { salt: SALT });
    expect(posts[0]!.createdAt).toBe(Math.floor(Date.parse('2026-08-27T15:00:04.000Z') / 1000));
  });

  it('attributes origin to the authoring server, not the polled one', async () => {
    const { posts } = await normalise([status()], { salt: SALT });
    expect(posts[0]!.originHost).toBe('piaille.fr');
  });

  it('drops anything that is not public', async () => {
    const result = await normalise(
      [
        status({ visibility: 'unlisted' }),
        status({ visibility: 'private' }),
        status({ visibility: 'direct' }),
      ],
      { salt: SALT },
    );
    expect(result.posts).toHaveLength(0);
    expect(result.skipped.nonPublic).toBe(3);
  });

  it('attributes a boost to the original post, not to whoever promoted it', async () => {
    const inner = status({
      uri: 'https://example.social/users/author/statuses/9',
      account: { acct: 'author@example.social' },
    });
    const boost = status({
      uri: 'https://booster.example/users/booster/statuses/1/activity',
      account: { acct: 'booster@booster.example' },
      tags: [],
      reblog: inner,
    });

    const { posts } = await normalise([boost], { salt: SALT });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.uri).toBe(inner.uri);
    expect(posts[0]!.originHost).toBe('example.social');
    expect(posts[0]!.isBoost).toBe(true);
    expect(hashKey(posts[0]!.authorHash)).toBe(hashKey(await authorHash(SALT, 'author@example.social')));
  });

  it('drops a boost whose wrapper is not public, even when the original is', async () => {
    const boost = status({ visibility: 'private', reblog: status() });
    const result = await normalise([boost], { salt: SALT });
    expect(result.posts).toHaveLength(0);
    expect(result.skipped.nonPublic).toBe(1);
  });

  it('casefolds and deduplicates tags', async () => {
    const { posts } = await normalise(
      [status({ tags: [{ name: 'Cats' }, { name: 'cats' }, { name: 'CATS' }, { name: 'Dogs' }] })],
      { salt: SALT },
    );
    expect(posts[0]!.tags).toEqual(['cats', 'dogs']);
  });

  it('drops posts by suppressed authors', async () => {
    const suppressed = new Set([hashKey(await authorHash(SALT, 'CatEveryHour@piaille.fr'))]);
    const result = await normalise([status()], { salt: SALT, suppressed });
    expect(result.posts).toHaveLength(0);
    expect(result.skipped.suppressed).toBe(1);
  });

  it('counts malformed statuses rather than throwing on them', async () => {
    const result = await normalise(
      [
        status({ uri: 'nonsense' }),
        status({ created_at: 'not a date' }),
        { ...status(), account: { acct: '' } },
        null as unknown as MastodonStatus,
      ],
      { salt: SALT },
    );
    expect(result.posts).toHaveLength(0);
    expect(result.skipped.malformed).toBe(4);
  });

  it('survives a status with no tags array at all', async () => {
    const bare = { ...status(), tags: undefined as unknown as MastodonStatus['tags'] };
    const { posts } = await normalise([bare], { salt: SALT });
    expect(posts[0]!.tags).toEqual([]);
  });
});
