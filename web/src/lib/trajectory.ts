/**
 * Merge baseline + scenario API trajectories into chart-ready points.
 * Both series share a month index; if the avalanche schedule clears earlier
 * than baseline, we pad it with zeros so both lines end together.
 */
import type { SimulateResponse, TrajectoryPointRaw } from './api';
import type { TrajectoryPoint } from './mock-data';

export function mergeTrajectories(
  avalanche: SimulateResponse,
  minimums: SimulateResponse,
): TrajectoryPoint[] {
  const horizon = Math.max(avalanche.trajectory.length, minimums.trajectory.length);
  const a = byMonth(avalanche.trajectory);
  const m = byMonth(minimums.trajectory);
  const points: TrajectoryPoint[] = [];
  for (let i = 1; i <= horizon; i++) {
    points.push({
      month: i,
      avalanche: a.get(i) ?? 0,
      minimums: m.get(i) ?? 0,
    });
  }
  return points;
}

function byMonth(rows: TrajectoryPointRaw[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.month, Number(r.balance));
  return out;
}
