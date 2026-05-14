/**
 * Mock trajectory: 36 months of total debt under (a) avalanche, (b) minimums-only.
 * Will be replaced by /api/plan response from the FastAPI gateway later.
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
