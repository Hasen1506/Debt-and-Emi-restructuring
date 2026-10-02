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
import { loanClears } from './plan-milestones';

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
    const first = traj[0].month;
    const lastAll = traj[traj.length - 1].month;
    const clears = !short && plan.debtFreeMonth ? plan.debtFreeMonth : null;
    const lastMinOwed = traj.filter((p) => p.minimums > 0.5).at(-1)?.month ?? 0;
    const minClear = traj.find((p) => p.month > lastMinOwed && p.minimums <= 0.5)?.month ?? null;
    // Both lines whole when the minimums finish within twice the plan;
    // otherwise the plan plus a quarter (at least six months).
    const end = !clears
      ? lastAll
      : minClear && minClear <= clears * 2
        ? Math.max(minClear, clears)
        : Math.min(lastAll, Math.max(clears + 6, Math.ceil(clears * 1.25)));
    const shown = traj.filter((p) => p.month <= end);
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
    if (clears) {
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
        label: `${m === clears ? 'DEBT-FREE' : names.join(' + ')} · ${shortDate(m)}`,
      }));
    if (clears && !byMonth.has(clears) && clears <= end) {
      milestones.push({ t: tOf(clears), v: 0, label: `DEBT-FREE · ${shortDate(clears)}` });
    }

    const lastShown = shown[shown.length - 1];
    const minimumsNote =
      lastShown && lastShown.minimums > 0.5
        ? minClear
          ? `MINIMUMS: CLEAR ${shortDate(minClear)} →`
          : 'MINIMUMS NEVER CLEAR IT →'
        : undefined;

    const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const m = first + Math.round(f * span);
      return { t: tOf(m), l: shortDate(m) };
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
      `Total debt over time. ${strategy} plan: ${formatCurrencyWhole(traj[0].avalanche, ccy)} after this month` +
      (paidOff.length ? `; ${paidOff.join('; ')}` : '') +
      (clears ? `; debt-free in ${label(clears)}. ` : '; not cleared within the plan. ') +
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
            {key(
              <span style={{ display: 'inline-block', width: 14, height: 3, background: L_T.ink, verticalAlign: 'middle', marginRight: 6 }} />,
              `${strategy.toUpperCase()} · YOUR PLAN`,
            )}
            {key(
              <span style={{ display: 'inline-block', width: 14, borderTop: `2px dashed ${L_T.muted}`, verticalAlign: 'middle', marginRight: 6 }} />,
              'PAYING ONLY MINIMUMS',
            )}
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
