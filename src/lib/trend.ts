/**
 * Ordinary least-squares linear trend — used to project a plan's actual weekly
 * volume forward on the tracking chart. Pure: no framework, easily unit-tested.
 */

export interface TrendPoint {
  x: number;
  y: number;
}

export interface Trend {
  slope: number;
  intercept: number;
}

/**
 * Fit `y = slope·x + intercept` through the points by least squares. Returns
 * null when there are fewer than 2 points, or when every x is identical (a
 * vertical line has no slope) — i.e. when no meaningful trend can be drawn.
 */
export function linearTrend(points: TrendPoint[]): Trend | null {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null; // all x equal → undefined slope

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/** Evaluate a fitted trend at `x`. */
export function trendAt(trend: Trend, x: number): number {
  return trend.slope * x + trend.intercept;
}
