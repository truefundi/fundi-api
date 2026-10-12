import {
  JOB_LOCATION_MATCH_POINTS,
  JOB_MATCH_RADIUS_METERS,
  JOB_MINIMUM_MATCH_SCORE,
  JOB_SERVICE_MATCH_POINTS,
} from './job.constants';

export function calculateJobMatchScore(
  hasServiceMatch: boolean,
  distanceMeters: number,
): number | null {
  if (
    !hasServiceMatch ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    distanceMeters > JOB_MATCH_RADIUS_METERS
  ) {
    return null;
  }
  const locationScore = Math.round(
    JOB_LOCATION_MATCH_POINTS * (1 - distanceMeters / JOB_MATCH_RADIUS_METERS),
  );
  const score = JOB_SERVICE_MATCH_POINTS + locationScore;
  return score >= JOB_MINIMUM_MATCH_SCORE ? score : null;
}
