/**
 * Merge baseline + scenario API trajectories into chart-ready points.
 * Both series share a month index; if the avalanche schedule clears earlier
 * than baseline, we pad it with zeros so both lines end together.
 *
 * With loans in more than one currency, each point also carries
 * `avalancheByCcy` / `minimumsByCcy` from the API's `balances_by_currency`,
 * for separate series per currency (NRI-US users).
 */
import type { SimulateResponse, TrajectoryPointRaw } from './api';
import type { TrajectoryPoint } from './mock-data';

interface MonthBucket {
  total: number;
  byCcy: Record<string, number>;
  byLoanIndex: Record<string, number>;
  interest: number;
  gapDebt: number;
}

export function mergeTrajectories(
  avalanche: SimulateResponse,
  minimums: SimulateResponse,
): TrajectoryPoint[] {
  const horizon = Math.max(avalanche.trajectory.length, minimums.trajectory.length);
  const a = byMonth(avalanche.trajectory);
  const m = byMonth(minimums.trajectory);
  // Union of currencies seen across both legs — so a currency that clears in
  // the avalanche leg still gets a (zero) entry in the minimums leg for the
  // same month, keeping the per-ccy series aligned.
  const allCcys = new Set<string>();
  a.forEach((b) => Object.keys(b.byCcy).forEach((c) => allCcys.add(c)));
  m.forEach((b) => Object.keys(b.byCcy).forEach((c) => allCcys.add(c)));
  const ccyList = Array.from(allCcys);
  const points: TrajectoryPoint[] = [];
  for (let i = 1; i <= horizon; i++) {
    const aPt = a.get(i);
    const mPt = m.get(i);
    points.push({
      month: i,
      avalanche: aPt?.total ?? 0,
      minimums: mPt?.total ?? 0,
      // Only when there's more than one currency: for one, they repeat the
      // totals, and the plan sent them to the browser for every month.
      ...(ccyList.length > 1
        ? { avalancheByCcy: padCcy(aPt?.byCcy, ccyList), minimumsByCcy: padCcy(mPt?.byCcy, ccyList) }
        : {}),
      // Per-loan series is taken from the scenario (avalanche) leg only —
      // the chart compares loan-vs-loan within the chosen strategy, not
      // against the minimums baseline.
      balancesByLoanIndex: aPt?.byLoanIndex,
      interest: aPt?.interest ?? 0,
      // Only when something was borrowed: most plans never are.
      ...((aPt?.gapDebt || mPt?.gapDebt) ? { gapDebt: aPt?.gapDebt ?? 0, minimumsGapDebt: mPt?.gapDebt ?? 0 } : {}),
    });
  }
  return points;
}

function byMonth(rows: TrajectoryPointRaw[]): Map<number, MonthBucket> {
  const out = new Map<number, MonthBucket>();
  for (const r of rows) {
    const byCcy: Record<string, number> = {};
    const raw = r.balances_by_currency ?? {};
    for (const [ccy, val] of Object.entries(raw)) {
      byCcy[ccy] = Number(val) || 0;
    }
    const byLoanIndex: Record<string, number> = {};
    const rawLoan = r.balances_by_loan_index ?? {};
    for (const [idx, val] of Object.entries(rawLoan)) {
      byLoanIndex[idx] = Number(val) || 0;
    }
    out.set(r.month, {
      total: Number(r.balance) || 0,
      byCcy,
      byLoanIndex,
      interest: Number(r.interest_paid) || 0,
      gapDebt: Number(r.gap_debt) || 0,
    });
  }
  return out;
}

function padCcy(
  byCcy: Record<string, number> | undefined,
  ccyList: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of ccyList) out[c] = byCcy?.[c] ?? 0;
  return out;
}
