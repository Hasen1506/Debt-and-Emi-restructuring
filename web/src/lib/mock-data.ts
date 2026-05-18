/**
 * Trajectory point consumed by DebtTrajectoryChart. Two series:
 *   `avalanche`  — the surplus-driven schedule from /api/simulate
 *   `minimums`   — the baseline from /api/baseline
 *
 * The `mockTrajectory` fallback is used when the API gateway isn't reachable
 * (offline preview, `npm run build` without a backend, etc.).
 *
 * `avalancheByCcy` / `minimumsByCcy` carry the per-currency split for
 * hybrid (NRI-US) users. Single-currency users get a 1-element dict that
 * matches the scalar `avalanche` / `minimums` series, so callers can treat
 * the dict as the source of truth and let single-ccy fall out as a special
 * case of the same shape.
 */
export type TrajectoryPoint = {
  month: number;
  avalanche: number;
  minimums: number;
  avalancheByCcy?: Record<string, number>;
  minimumsByCcy?: Record<string, number>;
  /** Per-loan outstanding at this month, keyed by 0-based index into
   *  user.loans. Drives the per-loan trajectory chart. Cleared loans
   *  keep their entry at 0 so the chart sees stable series. */
  balancesByLoanIndex?: Record<string, number>;
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
  return {
    month: i,
    avalanche,
    minimums,
    avalancheByCcy: { INR: avalanche },
    minimumsByCcy: { INR: minimums },
  };
});
