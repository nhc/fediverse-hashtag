import { describe, expect, it } from 'vitest';
import { ROBOTS_TOKEN, isPathAllowed, robotsPermitsCollection } from '../src/robots';

const TAG_PATH = '/api/v1/timelines/tag/';

describe('isPathAllowed', () => {
  it('allows everything when there is nothing to obey', () => {
    expect(isPathAllowed('', TAG_PATH)).toBe(true);
    expect(isPathAllowed('# just a comment\n', TAG_PATH)).toBe(true);
  });

  it('obeys a blanket disallow', () => {
    expect(isPathAllowed('User-agent: *\nDisallow: /\n', TAG_PATH)).toBe(false);
  });

  it('treats an empty Disallow as no restriction, which reads backwards', () => {
    expect(isPathAllowed('User-agent: *\nDisallow:\n', TAG_PATH)).toBe(true);
  });

  it('obeys a rule aimed at the api', () => {
    expect(isPathAllowed('User-agent: *\nDisallow: /api/\n', TAG_PATH)).toBe(false);
  });

  it('ignores a disallow for somewhere we do not go', () => {
    expect(isPathAllowed('User-agent: *\nDisallow: /admin/\n', TAG_PATH)).toBe(true);
  });

  it('lets the longest matching rule win', () => {
    const robots = 'User-agent: *\nDisallow: /api/\nAllow: /api/v1/timelines/\n';
    expect(isPathAllowed(robots, TAG_PATH)).toBe(true);
  });

  it('prefers Allow when two rules are the same length', () => {
    const robots = 'User-agent: *\nDisallow: /api/\nAllow: /api/\n';
    expect(isPathAllowed(robots, TAG_PATH)).toBe(true);
  });

  it('lets a group naming us override the wildcard, in both directions', () => {
    const stricterForUs = `User-agent: *\nAllow: /\n\nUser-agent: ${ROBOTS_TOKEN}\nDisallow: /\n`;
    expect(isPathAllowed(stricterForUs, TAG_PATH)).toBe(false);

    // And the other way: a named exception beats a blanket ban.
    const looserForUs = `User-agent: *\nDisallow: /\n\nUser-agent: ${ROBOTS_TOKEN}\nAllow: /\n`;
    expect(isPathAllowed(looserForUs, TAG_PATH)).toBe(true);
  });

  it('ignores groups aimed at other crawlers', () => {
    const robots = 'User-agent: GPTBot\nDisallow: /\n';
    expect(isPathAllowed(robots, TAG_PATH)).toBe(true);
  });

  it('applies one rule set to consecutive user-agent lines', () => {
    const robots = `User-agent: SomeBot\nUser-agent: ${ROBOTS_TOKEN}\nDisallow: /\n`;
    expect(isPathAllowed(robots, TAG_PATH)).toBe(false);
  });

  it('starts a new group when a user-agent line follows rules', () => {
    const robots = `User-agent: SomeBot\nDisallow: /\n\nUser-agent: ${ROBOTS_TOKEN}\nAllow: /\n`;
    expect(isPathAllowed(robots, TAG_PATH)).toBe(true);
  });

  it('strips comments and tolerates odd casing and spacing', () => {
    const robots = 'USER-AGENT:  *  # everyone\n  DISALLOW : /api/   # no api\n';
    expect(isPathAllowed(robots, TAG_PATH)).toBe(false);
  });

  it('skips lines with no colon rather than choking', () => {
    expect(isPathAllowed('this is not a directive\nUser-agent: *\nDisallow: /\n', TAG_PATH)).toBe(false);
  });
});

describe('robotsPermitsCollection', () => {
  it('needs both collector endpoints to be permitted', () => {
    expect(robotsPermitsCollection('User-agent: *\nAllow: /\n')).toBe(true);
    expect(robotsPermitsCollection('User-agent: *\nDisallow: /api/v1/tags/\n')).toBe(false);
    expect(robotsPermitsCollection('User-agent: *\nDisallow: /api/v1/timelines/\n')).toBe(false);
  });

  it('permits collection when the file says nothing relevant', () => {
    expect(robotsPermitsCollection('User-agent: *\nDisallow: /media/\nCrawl-delay: 10\n')).toBe(true);
  });
});
