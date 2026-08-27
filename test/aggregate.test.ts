import { describe, expect, it } from 'vitest';
import {
  coverageQuality,
  effectivePollInterval,
  isCoverageComparable,
  median,
  medianInstancesPerPost,
  minuteBucket,
  popcount,
  trend,
  weightedMedianPopcount,
} from '../src/aggregate';

describe('popcount', () => {
  it('counts how many instances saw a post', () => {
    expect(popcount(0b0000)).toBe(0);
    expect(popcount(0b0001)).toBe(1);
    expect(popcount(0b1011)).toBe(3);
    expect(popcount(0b11111111)).toBe(8);
  });

  it('works past the 32 bits javascript bitwise operators use', () => {
    // 2^40 is a single bit, and would be mangled by a `|`-based implementation.
    expect(popcount(2 ** 40)).toBe(1);
    expect(popcount(2 ** 51)).toBe(1);
    expect(popcount(2n ** 51n + 1n)).toBe(2);
  });

  it('treats a negative mask as empty rather than looping', () => {
    expect(popcount(-1)).toBe(0);
  });
});

describe('median', () => {
  it('takes the middle of an odd list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values of an even list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is null for nothing', () => {
    expect(median([])).toBeNull();
  });
});

describe('weightedMedianPopcount', () => {
  it('weights by how many posts sit behind each mask', () => {
    // Nine posts seen by one instance, one seen by eight. The median is 1, and
    // an unweighted median over distinct masks would wrongly say 4.5.
    expect(
      weightedMedianPopcount([
        { mask: 0b00000001, count: 9 },
        { mask: 0b11111111, count: 1 },
      ]),
    ).toBe(1);
  });

  it('averages across the boundary on an even total', () => {
    expect(
      weightedMedianPopcount([
        { mask: 0b0001, count: 1 },
        { mask: 0b0111, count: 1 },
      ]),
    ).toBe(2);
  });

  it('agrees with the unweighted median when every mask appears once', () => {
    const distribution = [
      { mask: 0b0001, count: 1 },
      { mask: 0b0011, count: 1 },
      { mask: 0b0111, count: 1 },
    ];
    expect(weightedMedianPopcount(distribution)).toBe(medianInstancesPerPost([0b0001, 0b0011, 0b0111]));
  });

  it('is null when there is nothing to take a median of', () => {
    expect(weightedMedianPopcount([])).toBeNull();
    expect(weightedMedianPopcount([{ mask: 0b1, count: 0 }])).toBeNull();
  });
});

describe('coverageQuality', () => {
  it('calls it good when a typical post reached most monitored servers', () => {
    expect(coverageQuality(6, 8)).toBe('good');
  });

  it('calls it partial in the middle', () => {
    expect(coverageQuality(2, 8)).toBe('partial');
  });

  it('calls it thin when posts are reaching one server in eight', () => {
    expect(coverageQuality(1, 8)).toBe('thin');
  });

  it('calls it thin when there is nothing to judge', () => {
    expect(coverageQuality(null, 8)).toBe('thin');
    expect(coverageQuality(4, 0)).toBe('thin');
  });
});

describe('trend', () => {
  it('reports proportional change against the previous window', () => {
    expect(trend(110, 100, true)).toBeCloseTo(0.1);
    expect(trend(90, 100, true)).toBeCloseTo(-0.1);
  });

  it('refuses to report when coverage was not comparable', () => {
    // The most important case. A drop caused by our own outage looks exactly
    // like a drop in activity, and publishing it with a footnote is worse than
    // not publishing it.
    expect(trend(50, 100, false)).toBeNull();
  });

  it('refuses to turn a standing start into a percentage', () => {
    expect(trend(40, 0, true)).toBeNull();
  });
});

describe('isCoverageComparable', () => {
  const base = { instancesMonitored: 8, currentReporting: 8, previousReporting: 8 };

  it('accepts two healthy windows', () => {
    expect(isCoverageComparable(base)).toBe(true);
  });

  it('accepts a small drift', () => {
    expect(isCoverageComparable({ ...base, currentReporting: 7 })).toBe(true);
  });

  it('rejects a large drift between the windows', () => {
    expect(isCoverageComparable({ ...base, currentReporting: 4 })).toBe(false);
  });

  it('rejects a window with too few instances reporting, even when both match', () => {
    expect(
      isCoverageComparable({ instancesMonitored: 8, currentReporting: 3, previousReporting: 3 }),
    ).toBe(false);
  });

  it('rejects when nothing is monitored', () => {
    expect(
      isCoverageComparable({ instancesMonitored: 0, currentReporting: 0, previousReporting: 0 }),
    ).toBe(false);
  });
});

describe('minuteBucket', () => {
  it('floors to the minute', () => {
    expect(minuteBucket(1_787_788_859)).toBe(minuteBucket(1_787_788_800));
    expect(minuteBucket(1_787_788_860)).toBe(minuteBucket(1_787_788_800) + 1);
  });
});

describe('effectivePollInterval', () => {
  it('reports the cron cadence when a tier asks for something faster', () => {
    // The honesty case. A hot tag asks for 60 seconds, but a cron firing every
    // 300 cannot deliver it, and the tag page must not claim otherwise.
    expect(effectivePollInterval(60, 300)).toBe(300);
  });

  it('reports the tier interval when it is the slower of the two', () => {
    expect(effectivePollInterval(1800, 300)).toBe(1800);
  });

  it('agrees with the tier when the cron is fast enough', () => {
    expect(effectivePollInterval(300, 60)).toBe(300);
  });

  it('never returns zero, whatever it is handed', () => {
    expect(effectivePollInterval(0, 0)).toBe(1);
    expect(effectivePollInterval(-5, -5)).toBe(1);
  });
});
