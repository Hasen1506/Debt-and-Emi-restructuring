/**
 * Trajectory point consumed by DebtTrajectoryChart. Two series:
 *   `avalanche`  — the surplus-driven schedule from /api/simulate
 *   `minimums`   — the baseline from /api/baseline
 *
 * The `mockTrajectory` fallback is used when the API gateway isn't reachable
 * (offline preview, `npm run build` without a backend, etc.).
 */
export type TrajectoryPoint = {
  month: number;
  avalanche: number;
  minimums: number;
};

export const mockTrajectory: TrajectoryPoint[] = Array.from({ length: 37 }, (_, i) => {
  const avalanche = Math.max(
    0,
    4_100_000 - i * 145_000 + 12_000 * Math.sin(i / 3),
  );
  const minimums = Math.max(
    0,
    4_100_000 - i * 75_000 + 4_000 * Math.sin(i / 2),
  );
  return { month: i, avalanche, minimums };
});
