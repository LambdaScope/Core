export type FdLeakStatus = 'healthy' | 'leaking' | 'gathering';

export interface FdPoint {
  timestamp?: number;
  start: number;
  end: number;
}

export interface LeakAnalysisResult {
  status: FdLeakStatus;
  slope: number;
  current: number;
  pointsAnalyzed: number;
  resetDetected: boolean;
  resetIndex?: number; // Index in input array where the latest reset occurred
}

/**
 * Computes the least-squares linear regression slope of y values against sequence index 0, 1, ..., N-1.
 * Returns 0 if fewer than 2 points or if all x values are identical.
 */
export function calculateSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  const meanX = (n - 1) / 2;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumY += values[i];
  }
  const meanY = sumY / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const diffX = i - meanX;
    numerator += diffX * (values[i] - meanY);
    denominator += diffX * diffX;
  }

  if (denominator === 0 || isNaN(denominator) || isNaN(numerator)) {
    return 0;
  }

  const slope = numerator / denominator;
  return isNaN(slope) || !isFinite(slope) ? 0 : slope;
}

/**
 * Analyzes an ordered series of { start, end } FD points (chronological: oldest -> newest)
 * for file descriptor leak behavior.
 *
 * Rules:
 * 1. Cold start reset: drop of > 3 in end vs previous point.
 * 2. Only analyze the segment AFTER (and including) the most recent reset.
 * 3. Analyze the last up-to-30 points of that segment.
 * 4. Status rules:
 *    - < 10 points in segment => "gathering"
 *    - >= 10 points and slope > 0.3 => "leaking"
 *    - otherwise => "healthy"
 */
export function analyzeFdLeaks(points: FdPoint[]): LeakAnalysisResult {
  if (!points || points.length === 0) {
    return {
      status: 'gathering',
      slope: 0,
      current: 0,
      pointsAnalyzed: 0,
      resetDetected: false,
    };
  }

  const current = points[points.length - 1]?.end ?? 0;

  if (points.length === 1) {
    return {
      status: 'gathering',
      slope: 0,
      current,
      pointsAnalyzed: 1,
      resetDetected: false,
    };
  }

  // 1. Detect cold start resets (drop of > 3 in end vs previous point)
  let latestResetIndex = -1;
  for (let i = 1; i < points.length; i++) {
    const prevEnd = points[i - 1].end;
    const currEnd = points[i].end;
    if (prevEnd - currEnd > 3) {
      latestResetIndex = i;
    }
  }

  const resetDetected = latestResetIndex >= 0;

  // 2. Segment after the most recent reset (from latestResetIndex onwards)
  const segment = resetDetected ? points.slice(latestResetIndex) : points;

  // 3. Last up-to-30 points of that segment
  const windowPoints = segment.slice(-30);
  const pointsAnalyzed = windowPoints.length;

  // 4. Calculate slope over the window
  const endValues = windowPoints.map((p) => p.end);
  const rawSlope = calculateSlope(endValues);
  const slope = Math.round(rawSlope * 100) / 100; // 2 decimal precision

  // 5. Determine status
  let status: FdLeakStatus;
  if (pointsAnalyzed < 10) {
    status = 'gathering';
  } else if (slope > 0.3) {
    status = 'leaking';
  } else {
    status = 'healthy';
  }

  return {
    status,
    slope: isNaN(slope) || !isFinite(slope) ? 0 : slope,
    current,
    pointsAnalyzed,
    resetDetected,
    resetIndex: resetDetected ? latestResetIndex : undefined,
  };
}
