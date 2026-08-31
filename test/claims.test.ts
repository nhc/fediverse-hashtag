import { describe, expect, it } from 'vitest';
import { checkClaim, type ClaimEvidence } from '../src/claims';

const evidence = (over: Partial<ClaimEvidence>): ClaimEvidence => ({
  tag: 'cats',
  display: 'cats',
  standing: 'tracked',
  authors24h: 100,
  posts24h: 180,
  originServers24h: 40,
  authors1h: 20,
  authorsPrev1h: 10,
  hoursComparable: true,
  coverage: 'good',
  sightingAuthors: null,
  serverReportedAccounts7d: null,
  serverReportedSources: 0,
  instancesMonitored: 8,
  ...over,
});

describe('scope', () => {
  it('blocks every fediverse-wide claim and offers the scoped sentence', () => {
    const v = checkClaim('rising', 'fediverse', evidence({}));
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('No server can see the whole fediverse');
    expect(v.may_say).toContain('as observed by this index');
  });
});

describe('directions', () => {
  it('allows rising when the comparable hours say rising', () => {
    const v = checkClaim('rising', 'index', evidence({}));
    expect(v.verdict).toBe('allowed');
    expect(v.may_say).toContain('10 authors in the previous hour, 20 in the last');
  });

  it('blocks rising when the data says falling, and hands over the honest sentence', () => {
    const v = checkClaim('rising', 'index', evidence({ authors1h: 8, authorsPrev1h: 20 }));
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('opposite');
    expect(v.may_say).toContain('falling');
  });

  it('blocks any direction when the hours are not comparable', () => {
    const v = checkClaim('falling', 'index', evidence({ hoursComparable: false }));
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('coverage');
  });

  it('blocks a direction called from a handful of authors', () => {
    const v = checkClaim('rising', 'index', evidence({ authors1h: 4, authorsPrev1h: 1 }));
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('too little');
  });

  it('calls a small change flat', () => {
    const v = checkClaim('rising', 'index', evidence({ authors1h: 21, authorsPrev1h: 20 }));
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('flat');
  });

  it('blocks directions for tags the index is not polling', () => {
    const v = checkClaim('rising', 'index', evidence({ standing: 'unseen', authors1h: null, authorsPrev1h: null, authors24h: null, coverage: null }));
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('not polling');
  });
});

describe('adjectives', () => {
  it('qualifies busy rather than blessing it, with the figures attached', () => {
    const v = checkClaim('busy', 'index', evidence({}));
    expect(v.verdict).toBe('qualified');
    expect(v.may_say).toBe(
      '#cats was used by 100 accounts across 40 origin servers in the last 24 hours, as observed by this index across 8 monitored servers.',
    );
  });

  it('warns of the lower bound when coverage is thin', () => {
    const v = checkClaim('busy', 'index', evidence({ coverage: 'thin' }));
    expect(v.verdict).toBe('qualified');
    expect(v.reason).toContain('lower bound');
  });

  it('blocks quiet under thin coverage: missing posts and quiet look the same', () => {
    const v = checkClaim('quiet', 'index', evidence({ authors24h: 2, coverage: 'thin' }));
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('thin');
  });

  it('qualifies quiet under good coverage', () => {
    const v = checkClaim('quiet', 'index', evidence({ authors24h: 2 }));
    expect(v.verdict).toBe('qualified');
  });
});

describe('existence', () => {
  it('allows in_use on server-reported evidence alone, and says which kind it is', () => {
    const v = checkClaim('in_use', 'index', evidence({ standing: 'unseen', authors24h: null, serverReportedAccounts7d: 38, serverReportedSources: 2 }));
    expect(v.verdict).toBe('allowed');
    expect(v.may_say).toContain('Server-reported, not observed');
  });

  it('blocks in_use with no evidence, without claiming disuse', () => {
    const v = checkClaim('in_use', 'index', evidence({ standing: 'unseen', authors24h: null, authors1h: null, authorsPrev1h: null }));
    expect(v.verdict).toBe('blocked');
    expect(v.may_say).toContain('no evidence');
  });

  it('always blocks unused, whatever the evidence', () => {
    const v = checkClaim('unused', 'index', evidence({ standing: 'unseen', authors24h: null }));
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('Absence of evidence');
  });
});
