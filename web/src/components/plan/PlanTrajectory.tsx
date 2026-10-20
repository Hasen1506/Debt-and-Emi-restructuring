'use client';

/**
 * Plan's chart (REDESIGN R3.2): total debt on the plan (shaded) against
 * paying only the minimums (dashed), with a marker where each loan is
 * paid off. The x-axis ends a little after the plan's debt-free month:
 * stretching it to where the minimums clear (decades, sometimes) squeezed
 * the plan into the first fifth. When the dashed line runs on past the
 * edge, a note says where it ends.
 */
import { useMemo } from 'react';
import type { PlanData } from './PlanData';
import { formatCurrencyWhole } from '@/lib/api';
import { formatMonthDate, getCountryToday, monthIndexToCountryLabel, monthIndexToDate, trajectoryPointDate, trajectoryTimeFraction } from '@/lib/today';
import { STRATEGY_LABEL } from '@/lib/strategy';
import { L_T, LSectionHeader } from '@/components/ledger/primitives';
import { LTrajectory, type LTrajMilestone, type LTrajPoint } from '@/components/ledger/LTrajectory';
import { loanClears } from './plan-milestones';
import { chartBalances } from '@/lib/schedule-chart';
import { balanceSettledMonth, chartAxisMonths, chartEndMonth, linesCoincide } from '@/lib/plan-gap';
import { minimumsClearMonth } from '@/lib/trajectory';

const CHART_NAME: Record<string, string> = {
  credit_card: 'CARD',
  personal_loan: 'PERSONAL LOAN',
  home_loan: 'HOME LOAN',
  auto_loan: 'CAR LOAN',
  education_loan: 'EDUCATION LOAN',
  gold_loan: 'GOLD LOAN',
  bnpl: 'BNPL',
  people_loan: 'PERSON',
};

/** Short name on a payoff marker. A loan from a person is the person's name. */
function markerName(loan: { loan_type: string; bank?: string }, typeCount: Map<string, number>): string {
  if (loan.loan_type === 'people_loan' && loan.bank) return loan.bank.toUpperCase();
  const kind = CHART_NAME[loan.loan_type] ?? 'LOAN';
  if ((typeCount.get(loan.loan_type) ?? 0) > 1 && loan.bank) return `${loan.bank.split(' ')[0].toUpperCase()} ${kind}`;
  return kind;
}

export function PlanTrajectory({ plan, short }: { plan: PlanData; short: boolean }) {
  const ccy = plan.displayCurrency;
  const country = plan.user.country;
  const traj = plan.trajectory;
  const strategy = STRATEGY_LABEL[plan.strategy];
  const outcomes = Object.values(plan.strategyCompare ?? {});
  const allOrdersSame = !short && plan.live && outcomes.length === 3 && outcomes.every((o) =>
    o.debtFreeMonth === outcomes[0].debtFreeMonth && Math.abs(Number(o.totalInterest) - Number(outcomes[0].totalInterest)) < 1,
  );

  const view = useMemo(() => {
    if (traj.length === 0) return null;
    const today = getCountryToday(country);
    const shortDate = (month: number) => formatMonthDate(monthIndexToDate(month, today), 'short');
    // The same balances as the table's BALANCE column, including the start
    // row (owed now). Gap borrowing stays in the table's GAP OWED column.
    const series = chartBalances(plan).map((p) => ({ month: p.month, avalanche: p.balance, minimums: p.minimums }));
    const start = series[0]?.month === 0 ? series[0].avalanche : 0;
    const first = series[0].month;
    const lastAll = traj[traj.length - 1].month;
    // The engine's date, short or not (live test #17): when short it is the
    // date with the gap borrowed, the same one the schedule shows. The axis
    // used to run to the end of the minimums line whenever the plan was short.
    const clears = plan.debtFreeMonth ?? null;
    // Live re-test 3 R3-1: one never-clears answer for the line, its note and
    // the screen-reader summary, in the plan and in the what-if.
    const minClear = minimumsClearMonth(traj, plan.baselineNeverClears);
    // A gap that is still borrowed keeps growing; one that was repaid does not.
    const gapGrows = !clears && plan.gap?.firstBorrowMonth != null && plan.gap.repaidMonth == null;
    // A leftover the plan stops paying (a 0% loan) is not a 30-year story.
    // The axis ends when the balance settles, or the markers pile into the
    // first sliver and the leftover sits on the ₹0 line.
    const notFundableFrom = plan.infeasibleFrom ?? null;
    const settled =
      !clears && notFundableFrom == null && !gapGrows ? balanceSettledMonth(series.map((p) => ({ month: p.month, balance: p.avalanche }))) : null;
    // End at the stack's payoff month. A longer axis left the plan line at ₹0
    // until the minimums line finished; the note still says when that is.
    const end = chartEndMonth({
      planClears: clears,
      minClear,
      lastMonth: lastAll,
      growingGapFrom: gapGrows ? plan.gap?.firstBorrowMonth ?? null : null,
      notFundableFrom,
      settledMonth: settled,
    });
    // Integration phase 5 (C11): a capped plan has no debt-free milestone
    // (plan.debtFreeMonth is null, load-plan's shownDebtFreeMonth); the line
    // stops at the first unfundable month and the note says so.
    const shown = series.filter((p) => p.month <= end);
    // One point per month, spaced by the calendar: today to the end of
    // this month is a few days, and each later month is its own length.
    const tOf = (m: number) => trajectoryTimeFraction(m, first, end, today);
    const maxBal = shown.reduce((mx, p) => Math.max(mx, p.avalanche, p.minimums), 0);
    const norm = (v: number) => (maxBal > 0 ? v / maxBal : 0);
    const money = (v: number) => formatCurrencyWhole(Math.round(v), ccy);
    const points: LTrajPoint[] = shown.map((p) => {
      // A rounding dip below zero would draw under the axis. The tip keeps
      // the figure the schedule shows.
      const balance = Math.round(p.avalanche);
      return {
        t: tOf(p.month),
        av: norm(Math.max(0, p.avalanche)),
        min: norm(Math.max(0, p.minimums)),
        tip: `${p.month === 0 ? 'Now' : shortDate(p.month)} · ${money(balance)}`,
        month: p.month,
        balance,
      };
    });
    const avAt = (m: number) => shown.find((p) => p.month === m)?.avalanche ?? 0;

    // One marker per month a loan is paid off; the last is the debt-free month.
    const { loans } = plan.user;
    const typeCount = new Map<string, number>();
    for (const l of loans) typeCount.set(l.loan_type, (typeCount.get(l.loan_type) ?? 0) + 1);
    const byMonth = new Map<number, string[]>();
    // Markers for loans that do clear, even when a leftover means the whole
    // stack has no debt-free date. Skipping them hid every payoff.
    for (const c of loanClears(plan)) {
      if (c.month > end || notFundableFrom != null) continue;
      const loan = loans[c.index];
      const name = markerName(loan, typeCount);
      byMonth.set(c.month, [...(byMonth.get(c.month) ?? []), name]);
    }
    const milestones: LTrajMilestone[] = [...byMonth.entries()]
      .sort(([a], [b]) => a - b)
      .map(([m, names]) => ({
        t: tOf(m),
        v: norm(avAt(m)),
        label: `${m === clears ? (short ? 'DEBT-FREE AS THINGS STAND' : 'DEBT-FREE') : names.join(' + ')} · ${shortDate(m)}`,
      }));
    if (clears && !byMonth.has(clears) && clears <= end) {
      milestones.push({ t: tOf(clears), v: 0, label: `${short ? 'DEBT-FREE AS THINGS STAND' : 'DEBT-FREE'} · ${shortDate(clears)}` });
    }
    const repaid = plan.gap?.repaidMonth;
    if (repaid && repaid <= end && !byMonth.has(repaid) && repaid !== clears) {
      milestones.push({ t: tOf(repaid), v: norm(avAt(repaid)), label: `GAP BORROWING REPAID · ${shortDate(repaid)}` });
      milestones.sort((a, b) => a.t - b.t);
    }

    const lastShown = shown[shown.length - 1];
    const leftover = settled != null ? Math.round(avAt(settled)) : 0;
    const minimumsNote =
      notFundableFrom != null
        ? `NOT FUNDABLE FROM ${shortDate(notFundableFrom)} →`
        : gapGrows
        ? 'GAP BORROWING KEEPS GROWING →'
        : settled != null
          ? `${money(leftover)} STAYS`
          : minClear
          ? `MINIMUMS ONLY: CLEAR ${shortDate(minClear)}`
          : lastShown && lastShown.minimums > 0.5
            ? 'MINIMUMS NEVER CLEAR IT →'
            : undefined;

    const tickMonths = chartAxisMonths(first, end, 5);
    const seenMonth = new Set<string>();
    const xLabels = tickMonths.flatMap((m) => {
      const d = trajectoryPointDate(m, today);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      // NOW and the end of this month name the same calendar month. Keep
      // the last tick (the debt-free month); drop a middle one that repeats it.
      if (seenMonth.has(key) && m !== tickMonths[tickMonths.length - 1]) return [];
      seenMonth.add(key);
      return [{ t: tOf(m), l: m === 0 ? 'NOW' : shortDate(m) }];
    });
    // The same whole-rupee figures as the BALANCE cells, not a compact scale.
    const yLabels = [
      { y: 1, l: formatCurrencyWhole(Math.round(maxBal), ccy) },
      { y: 0.5, l: formatCurrencyWhole(Math.round(maxBal / 2), ccy) },
      { y: 0, l: formatCurrencyWhole(0, ccy) },
    ];

    const label = (m: number) => monthIndexToCountryLabel(m, country);
    const paidOff = [...byMonth.entries()]
      .filter(([m]) => m !== clears)
      .map(([m, names]) => `${names.join(' and ').toLowerCase()} paid off in ${label(m)}`);
    const title =
      `Total debt over time. ${strategy} plan: ${start > 0 ? `${formatCurrencyWhole(start, ccy)} now, ` : ''}${formatCurrencyWhole(traj[0].avalanche, ccy)} after this month` +
      (paidOff.length ? `; ${paidOff.join('; ')}` : '') +
      (clears
        ? `; debt-free in ${label(clears)}. `
        : notFundableFrom != null
          ? `; not fundable from ${label(notFundableFrom)} as things stand, so no debt-free date. `
          : settled != null
            ? `; ${money(leftover)} stays from ${label(settled)}, because the plan does not pay that leftover down. `
            : '; not cleared within the plan. ') +
      (minClear
        ? `Paying only the minimums clears it in ${label(minClear)}.`
        : 'Paying only the minimums never clears it.');
    return { points, milestones, xLabels, yLabels, minimumsNote, noteOn: settled != null ? 'av' as const : 'min' as const, title };
  }, [traj, short, plan, country, ccy, strategy]);

  const key = (line: React.ReactNode, text: string) => (
    <span>
      {line}
      {text}
    </span>
  );

  return (
    <section>
      <LSectionHeader>TRAJECTORY · TOTAL DEBT OVER TIME</LSectionHeader>
      {allOrdersSame && <p style={{ fontSize: 12, color: L_T.muted, margin: '0 0 10px' }}>
        With these debts, all three payoff orders give the same date and interest. The graph therefore stays the same when you switch.
      </p>}
      {view ? (
        <>
          <LTrajectory
            points={view.points}
            milestones={view.milestones}
            axisLabels={view.xLabels}
            yLabels={view.yLabels}
            title={view.title}
            minimumsNote={view.minimumsNote}
            noteOn={view.noteOn}
          />
          <div
            aria-hidden="true"
            style={{ display: 'flex', gap: '6px 18px', fontSize: 10, color: L_T.muted, marginTop: 8, letterSpacing: '0.1em', flexWrap: 'wrap' }}
          >
            {linesCoincide(view.points) ? (
              // Live re-test 2 R2-10: one line on screen, so one legend item.
              <span data-testid="legend-same-line">
                {key(
                  <span style={{ display: 'inline-block', width: 14, height: 3, background: L_T.ink, verticalAlign: 'middle', marginRight: 6 }} />,
                  `${strategy.toUpperCase()} · YOUR PLAN, THE SAME AS PAYING ONLY MINIMUMS`,
                )}
              </span>
            ) : (
              <>
                {key(
                  <span style={{ display: 'inline-block', width: 14, height: 3, background: L_T.ink, verticalAlign: 'middle', marginRight: 6 }} />,
                  `${strategy.toUpperCase()} · YOUR PLAN`,
                )}
                {key(
                  <span style={{ display: 'inline-block', width: 14, borderTop: `2px dashed ${L_T.muted}`, verticalAlign: 'middle', marginRight: 6 }} />,
                  'PAYING ONLY MINIMUMS',
                )}
              </>
            )}
            {plan.gap?.firstBorrowMonth != null && <span>GAP BORROWING IS IN THE TABLE, NOT ON THESE LINES</span>}
            {view.milestones.length > 0 &&
              key(
                <span style={{ display: 'inline-block', width: 8, height: 8, background: L_T.accent, verticalAlign: 'middle', marginRight: 6 }} />,
                'A LOAN PAID OFF',
              )}
          </div>
        </>
      ) : (
        <div style={{ padding: 18, fontSize: 12, color: L_T.muted }}>
          NO TRAJECTORY · the plan returned no months to draw.
        </div>
      )}
    </section>
  );
}
