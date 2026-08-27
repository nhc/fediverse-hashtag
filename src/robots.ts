/**
 * robots.txt, honoured as one of the two documented opt-out routes.
 *
 * A server admin should not have to email anybody to be left alone, so a
 * Disallow that applies to this collector is treated as an opt-out. The parser
 * is deliberately small but follows the two rules that matter: the most
 * specific matching user-agent group wins outright, and within that group the
 * longest matching path rule wins, with Allow beating Disallow on a tie.
 */

export const ROBOTS_TOKEN = 'fediverse-hashtag-index';

interface Group {
  /** True when this group was matched by name rather than by the wildcard. */
  specific: boolean;
  rules: { allow: boolean; path: string }[];
}

/**
 * Parse the groups that apply to a given product token.
 *
 * Consecutive User-agent lines share one set of rules, which is what makes
 * grouping necessary rather than reading the file line by line.
 */
function applicableGroups(robots: string, token: string): Group[] {
  const needle = token.toLowerCase();
  const groups: Group[] = [];

  let agents: string[] = [];
  let rules: Group['rules'] = [];
  let collectingAgents = false;

  const flush = (): void => {
    if (agents.length === 0) return;
    const specific = agents.some((agent) => agent !== '*' && needle.includes(agent));
    const wildcard = agents.includes('*');
    if (specific || wildcard) groups.push({ specific, rules });
    agents = [];
    rules = [];
  };

  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line.length === 0) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // A User-agent line after rules starts a new group.
      if (!collectingAgents) flush();
      collectingAgents = true;
      agents.push(value.toLowerCase());
      continue;
    }

    if (field === 'allow' || field === 'disallow') {
      collectingAgents = false;
      rules.push({ allow: field === 'allow', path: value });
    }
  }
  flush();

  return groups;
}

/**
 * Whether this collector may fetch a path.
 *
 * An unreadable or absent robots.txt means yes, which matches how the rest of
 * the web treats it. An empty Disallow value means no restriction, which is the
 * one piece of the specification that reads backwards.
 */
export function isPathAllowed(
  robots: string,
  path: string,
  token: string = ROBOTS_TOKEN,
): boolean {
  const groups = applicableGroups(robots, token);
  if (groups.length === 0) return true;

  // A group naming us wins outright over the wildcard, even if the wildcard is
  // stricter. That is the point of naming a specific agent.
  const specific = groups.filter((group) => group.specific);
  const chosen = specific.length > 0 ? specific : groups;
  const rules = chosen.flatMap((group) => group.rules);

  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    if (rule.path === '') continue;
    if (!path.startsWith(rule.path)) continue;
    if (
      best === null ||
      rule.path.length > best.length ||
      (rule.path.length === best.length && rule.allow)
    ) {
      best = { allow: rule.allow, length: rule.path.length };
    }
  }

  return best === null ? true : best.allow;
}

/** The endpoints the collector needs. A Disallow on any of them is an opt-out. */
export const REQUIRED_PATHS = ['/api/v1/timelines/tag/', '/api/v1/tags/'] as const;

export function robotsPermitsCollection(robots: string, token: string = ROBOTS_TOKEN): boolean {
  return REQUIRED_PATHS.every((path) => isPathAllowed(robots, path, token));
}
