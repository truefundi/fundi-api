import { calculateJobMatchScore } from './job-matching.util';
import { JOB_MATCH_RADIUS_METERS } from './job.constants';

describe('calculateJobMatchScore', () => {
  it('scores a service match from 100 down to 60 across the matching radius', () => {
    expect(calculateJobMatchScore(true, 0)).toBe(100);
    expect(calculateJobMatchScore(true, JOB_MATCH_RADIUS_METERS / 2)).toBe(80);
    expect(calculateJobMatchScore(true, JOB_MATCH_RADIUS_METERS)).toBe(60);
  });

  it('excludes candidates without a service match or outside the radius', () => {
    expect(calculateJobMatchScore(false, 0)).toBeNull();
    expect(
      calculateJobMatchScore(true, JOB_MATCH_RADIUS_METERS + 1),
    ).toBeNull();
    expect(calculateJobMatchScore(true, Number.NaN)).toBeNull();
  });
});
