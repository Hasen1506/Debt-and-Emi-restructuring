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
import { formatCurrencyCompact, formatCurrencyWhole } from '@/lib/api';
import { getCountryToday, monthIndexToCountryLabel, monthIndexToDate, MONTH_NAMES } from '@/lib/today';
import { STRATEGY_LABEL } from '@/lib/strategy';
import { L_T, LSectionHeader } from '@/components/ledger/primitives';
import { LTrajectory, type LTrajMilestone, type LTrajPoint } from '@/components/ledger/LTrajectory';
import { loanClears, owedNowAtStart } from './plan-milestones';
import { chartEndMonth, linesCoincide } from '@/lib/plan-gap';
import { minimumsClearMonth } from '@/lib/trajectory';

const CHART_NAME: Record<string, string> = {
  credit_card: 'CARD',
  personal_loan: 'PERSONAL LOAN',
  home_loan: 'HOME LOAN',
  auto_loan: 'CAR LOAN',
  education_loan: 'EDUCATION LOAN',
  gold_loan: 'GOLD LOAN',
  bnpl: 'BNPL',
};

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
    const shortDate = (month: number) => {
      const d = monthIndexToDate(month, today);
      // "OCT ’26", not "OCT 26", which reads as a day.
      return `${MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ’${String(d.getFullYear()).slice(-2)}`;
    };
    // The line starts at what's owed now (Home's OUTSTANDING, after what's
    // already paid this month; owed-fix), not after this month's payments.
    const start = traj[0].month === 1 ? owedNowAtStart(plan) : 0;
    // Total debt includes gap borrowing (grill #38): a short month goes on
    // a card, and that card balance is debt too.
    const withGap = traj.map((p) =>
      p.gapDebt || p.minimumsGapDebt
        ? { ...p, avalanche: p.avalanche + (p.gapDebt ?? 0), minimums: p.minimums + (p.minimumsGapDebt ?? 0) }
        : p,
    );
    const series = start > 0 ? [{ month: 0, avalanche: start, minimums: start }, ...withGap] : withGap;
    const first = series[0].month;
    const lastAll = traj[traj.length - 1].month;
    // The engine's date, short or not (live test #17): when short it is the
    // date with the gap borrowed, the same one the schedule shows. The axis
    // used to run to the end of the minimums line whenever the plan was short.
    const clears = plan.debtFreeMonth ?? null;
    // Live re-test 3 R3-1: one never-clears answer for the line, its note and
    // the screen-reader summary, in the plan and in the what-if.
    const minClear = minimumsClearMonth(traj, plan.baselineNeverClears);
    // Both lines whole: the axis runs to the month the minimums clear (or the
    // horizon when they never do), founder 18 Oct 2026.
    const end = chartEndMonth({
      planClears: clears,
      minClear,
      lastMonth: lastAll,
      growingGapFrom: !clears ? plan.gap?.firstBorrowMonth ?? null : null,
      notFundableFrom: plan.infeasibleFrom ?? null,
    });
    // Integration phase 5 (C11): a capped plan has no debt-free milestone
    // (plan.debtFreeMonth is null, load-plan's shownDebtFreeMonth); the line
    // stops at the first unfundable month and the note says so.
    const notFundableFrom = plan.infeasibleFrom ?? null;
    const shown = series.filter((p) => p.month <= end);
    const span = Math.max(1, end - first);
    const tOf = (m: number) => (m - first) / span;
    const maxBal = shown.reduce((mx, p) => Math.max(mx, p.avalanche, p.minimums), 0);
    const norm = (v: number) => (maxBal > 0 ? v / maxBal : 0);
    const points: LTrajPoint[] = shown.map((p) => ({ t: tOf(p.month), av: norm(p.avalanche), min: norm(p.minimums) }));
    const avAt = (m: number) => shown.find((p) => p.month === m)?.avalanche ?? 0;

    // One marker per month a loan is paid off; the last is the debt-free month.
    const { loans } = plan.user;
    const typeCount = new Map<string, number>();
    for (const l of loans) typeCount.set(l.loan_type, (typeCount.get(l.loan_type) ?? 0) + 1);
    const byMonth = new Map<number, string[]>();
    if (clears || notFundableFrom != null) {
      for (const c of loanClears(plan)) {
        if (c.month > end) continue;
        const loan = loans[c.index];
        const name =
          (typeCount.get(loan.loan_type) ?? 0) > 1 && loan.bank
            ? `${loan.bank.split(' ')[0].toUpperCase()} ${CHART_NAME[loan.loan_type] ?? 'LOAN'}`
            : (CHART_NAME[loan.loan_type] ?? 'LOAN');
        byMonth.set(c.month, [...(byMonth.get(c.month) ?? []), name]);
      }
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
    const minimumsNote =
      notFundableFrom != null
        ? `NOT FUNDABLE FROM ${shortDate(notFundableFrom)} →`
        : !clears && plan.gap?.firstBorrowMonth
        ? 'GAP BORROWING KEEPS GROWING →'
        : minClear
          ? `MINIMUMS ONLY: CLEAR ${shortDate(minClear)}`
          : lastShown && lastShown.minimums > 0.5
            ? 'MINIMUMS NEVER CLEAR IT →'
            : undefined;

    const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const m = first + Math.round(f * span);
      return { t: tOf(m), l: m === 0 ? 'NOW' : shortDate(m) };
    });
    // Compact (₹35.7L): the full figure didn't fit beside the axis on a phone.
    const yLabels = [
      { y: 1, l: formatCurrencyCompact(maxBal, ccy) },
      { y: 0.5, l: formatCurrencyCompact(maxBal / 2, ccy) },
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
          : '; not cleared within the plan. ') +
      (minClear
        ? `Paying only the minimums clears it in ${label(minClear)}.`
        : 'Paying only the minimums never clears it.');
    return { points, milestones, xLabels, yLabels, minimumsNote, title };
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
            {plan.gap?.firstBorrowMonth != null && <span>{linesCoincide(view.points) ? 'THE LINE INCLUDES GAP BORROWING' : 'BOTH LINES INCLUDE GAP BORROWING'}</span>}
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
