/**
 * Refereeing what an agent may honestly say about a hashtag. Pure.
 *
 * The other tools hand an agent evidence and trust it to phrase the claim
 * well. This one closes the loop: the agent submits the claim it intends to
 * make, and the index checks it against the same rules the site holds itself
 * to. Directions are checkable, so they come back allowed or blocked.
 * Adjectives are judgements, so they come back qualified, with the sentence
 * the index can stand behind. Scope claims about the whole fediverse are
 * blocked outright, because no complete view of the network exists to check
 * them against.
 *
 * Every verdict carries may_say, a sentence that is true on the evidence
 * given, so a blocked claim is never a dead end.
 */

export type Claim = 'rising' | 'falling' | 'busy' | 'quiet' | 'in_use' | 'unused';
export type Scope = 'index' | 'fediverse';
export type Verdict = 'allowed' | 'qualified' | 'blocked';

export const CLAIMS: readonly Claim[] = ['rising', 'falling', 'busy', 'quiet', 'in_use', 'unused'];

/** Below this many authors in both hours, no direction is called. */
export const MIN_AUTHORS_FOR_DIRECTION = 5;

/** A change smaller than this, either way, is flat. */
export const FLAT_BAND = 0.1;

export interface ClaimEvidence {
  tag: string;
  display: string;
  standing: 'tracked' | 'discovered' | 'unseen';
  /** Observed figures. Null when the tag is not tracked. */
  authors24h: number | null;
  posts24h: number | null;
  originServers24h: number | null;
  authors1h: number | null;
  authorsPrev1h: number | null;
  /** Whether the last two hours saw comparable slices of the network. */
  hoursComparable: boolean;
  /** Coverage grade for the tag over 24 hours, when tracked. */
  coverage: 'good' | 'partial' | 'thin' | null;
  /** Sightings in the discovery pool, when discovered. */
  sightingAuthors: number | null;
  /** The servers' own weekly counters, when they were asked. */
  serverReportedAccounts7d: number | null;
  serverReportedSources: number;
  instancesMonitored: number;
}

export interface ClaimVerdict {
  claim: Claim;
  scope: Scope;
  verdict: Verdict;
  reason: string;
  /** A sentence that is true on this evidence. Always present. */
  may_say: string;
}

const observedSentence = (e: ClaimEvidence): string =>
  `#${e.display} was used by ${e.authors24h} account${e.authors24h === 1 ? '' : 's'} ` +
  `across ${e.originServers24h} origin server${e.originServers24h === 1 ? '' : 's'} in the last 24 hours, ` +
  `as observed by this index across ${e.instancesMonitored} monitored servers.`;

/** The most honest sentence available when nothing was observed. */
function fallbackSentence(e: ClaimEvidence): string {
  if (e.standing === 'discovered' && (e.sightingAuthors ?? 0) > 0) {
    return (
      `#${e.display} has been sighted from ${e.sightingAuthors} accounts alongside tracked tags ` +
      `in the last two days; it is not polled itself, so that is a lower bound.`
    );
  }
  if ((e.serverReportedAccounts7d ?? 0) > 0) {
    return (
      `${e.serverReportedSources} server${e.serverReportedSources === 1 ? '' : 's'} asked directly ` +
      `report about ${e.serverReportedAccounts7d} accounts using #${e.display} in the last seven days. ` +
      `Server-reported, not observed.`
    );
  }
  return `This index has no evidence about #${e.display} either way.`;
}

function directionVerdict(claim: 'rising' | 'falling', scope: Scope, e: ClaimEvidence): ClaimVerdict {
  const base = { claim, scope };
  if (e.standing !== 'tracked' || e.authors1h === null || e.authorsPrev1h === null) {
    return {
      ...base,
      verdict: 'blocked',
      reason: 'The index is not polling this tag, so there is no hourly series to read a direction from.',
      may_say: fallbackSentence(e),
    };
  }
  if (!e.hoursComparable) {
    return {
      ...base,
      verdict: 'blocked',
      reason:
        'The last two hours were reported by different shares of the monitored servers, so a change ' +
        'in the count could be a change in coverage. No direction can honestly be claimed.',
      may_say: observedSentence(e),
    };
  }
  if (Math.max(e.authors1h, e.authorsPrev1h) < MIN_AUTHORS_FOR_DIRECTION) {
    return {
      ...base,
      verdict: 'blocked',
      reason: `Fewer than ${MIN_AUTHORS_FOR_DIRECTION} authors in both hours; too little to call a direction.`,
      may_say: observedSentence(e),
    };
  }
  const change = e.authorsPrev1h === 0 ? 1 : (e.authors1h - e.authorsPrev1h) / e.authorsPrev1h;
  const actual: 'rising' | 'falling' | 'flat' =
    Math.abs(change) < FLAT_BAND ? 'flat' : change > 0 ? 'rising' : 'falling';
  if (actual === claim) {
    return {
      ...base,
      verdict: 'allowed',
      reason: `Distinct authors went from ${e.authorsPrev1h} to ${e.authors1h} across comparable hours.`,
      may_say:
        `#${e.display} is ${claim} on the servers this index monitors: ` +
        `${e.authorsPrev1h} authors in the previous hour, ${e.authors1h} in the last.`,
    };
  }
  return {
    ...base,
    verdict: 'blocked',
    reason:
      actual === 'flat'
        ? `The data says flat: ${e.authorsPrev1h} authors then ${e.authors1h}, within the ${FLAT_BAND * 100}% band.`
        : `The data says the opposite: ${e.authorsPrev1h} authors then ${e.authors1h}.`,
    may_say:
      actual === 'flat'
        ? `#${e.display} is roughly flat hour on hour: ${e.authorsPrev1h} authors, then ${e.authors1h}.`
        : `#${e.display} is ${actual} on the servers this index monitors: ${e.authorsPrev1h} authors, then ${e.authors1h}.`,
  };
}

export function checkClaim(claim: Claim, scope: Scope, e: ClaimEvidence): ClaimVerdict {
  if (scope === 'fediverse') {
    return {
      claim,
      scope,
      verdict: 'blocked',
      reason:
        'No server can see the whole fediverse, so no fediverse-wide claim can be checked or made. ' +
        'Scope any claim to what this index observes.',
      may_say:
        e.standing === 'tracked' && (e.authors24h ?? 0) > 0
          ? observedSentence(e)
          : fallbackSentence(e),
    };
  }

  switch (claim) {
    case 'rising':
    case 'falling':
      return directionVerdict(claim, scope, e);

    case 'busy':
      if (e.standing !== 'tracked' || (e.authors24h ?? 0) === 0) {
        return {
          claim, scope,
          verdict: 'blocked',
          reason: 'Nothing observed, so busy cannot be supported.',
          may_say: fallbackSentence(e),
        };
      }
      return {
        claim, scope,
        verdict: 'qualified',
        reason:
          'Busy is a judgement, not a measurement. The index can stand behind the figures; ' +
          'whether they amount to busy is the reader’s call.' +
          (e.coverage === 'thin' ? ' Coverage is thin, so read the count as a lower bound.' : ''),
        may_say: observedSentence(e),
      };

    case 'quiet':
      if (e.standing !== 'tracked') {
        return {
          claim, scope,
          verdict: 'blocked',
          reason: 'The index is not polling this tag, so it cannot distinguish quiet from unobserved.',
          may_say: fallbackSentence(e),
        };
      }
      if (e.coverage === 'thin' || e.coverage === null) {
        return {
          claim, scope,
          verdict: 'blocked',
          reason:
            'Coverage is thin, so a low count may be the index missing posts rather than the tag being quiet.',
          may_say: observedSentence(e),
        };
      }
      return {
        claim, scope,
        verdict: 'qualified',
        reason:
          'Quiet is a judgement. With ' + e.coverage + ' coverage the low count is meaningful, ' +
          'but say it as observed figures, scoped to the monitored servers.',
        may_say: observedSentence(e),
      };

    case 'in_use': {
      const evidence =
        (e.authors24h ?? 0) > 0 || (e.sightingAuthors ?? 0) > 0 || (e.serverReportedAccounts7d ?? 0) > 0;
      if (evidence) {
        return {
          claim, scope,
          verdict: 'allowed',
          reason: 'There is positive evidence of use from at least one source.',
          may_say: (e.authors24h ?? 0) > 0 ? observedSentence(e) : fallbackSentence(e),
        };
      }
      return {
        claim, scope,
        verdict: 'blocked',
        reason: 'No source shows any use. That is no evidence either way, not proof of disuse.',
        may_say: fallbackSentence(e),
      };
    }

    case 'unused':
      return {
        claim, scope,
        verdict: 'blocked',
        reason:
          'Absence of evidence is not evidence of absence. This index sees a small slice of the ' +
          'network, so it can never support a claim that a tag is unused.',
        may_say: fallbackSentence(e),
      };
  }
}
