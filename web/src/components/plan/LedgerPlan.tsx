'use client';

/**
 * Plan (REDESIGN R3): when the debt clears, and what if.
 *
 * Top to bottom:
 *   1. "Schedule amended" when Activity has moved the plan
 *   2. What the plan assumes: facts from Profile, then one chip per
 *      assumption, each opening its control (PlanAssumptions)
 *   3. KPIs: debt-free, total interest, time saved, paying this month
 *   4. Trajectory, key dates, life events, amortisation, what-if
 *
 * Cheaper rates (restructuring) and this month's payments live on Home
 * (REDESIGN R2).
 */

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import type { PlanData } from './PlanData';
import { formatCurrencyWhole, formatCurrencyCompact } from '@/lib/api';
import {
  monthIndexToCountryLabel,
  monthIndexToDate,
  MONTH_NAMES,
  monthsSpan,
  getCountryToday,
} from '@/lib/today';
import {
  LShell,
  LSectionHeader,
  LCli,
  LKpi,
  LBracket,
  LCardHard,
  LRule,
  L_T,
  L_MONO,
} from '@/components/ledger/primitives';
import { deriveMetrics } from '@/lib/derived';
import { dec } from '@/lib/safe-decimal';
import { describeGap, type ProfileGap } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { loanCurrency } from '@/lib/currency';
import type { StoredProfile } from '@/lib/user-store';
import { LTrajectory, type LTrajPoint } from '@/components/ledger/LTrajectory';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { LifecycleArrivalPrompts } from '@/components/lifecycle/LifecycleArrivalPrompts';
import { LifecycleEventsPanel } from '@/components/lifecycle/LifecycleEventsPanel';
import { FxCachePersister } from './FxCachePersister';
import { ActivityImpactBanner } from './ActivityImpactBanner';
import { BracketTransitionAlert } from './BracketTransitionAlert';
import { AdvanceTaxPanel } from './AdvanceTaxPanel';
import { CentralBankHint } from './CentralBankHint';
import { KeyClearanceDates } from './KeyClearanceDates';
import { DebtFreeRedirectPrompt } from './DebtFreeRedirectPrompt';
import { InvestVsPrepayCard } from './InvestVsPrepayCard';
import { PlanAssumptions } from './PlanAssumptions';

export function LedgerPlan({ plan }: { plan: PlanData }) {
  const ccy = plan.displayCurrency;
  const fc = (v: string | number) => formatCurrencyWhole(v, ccy);
  const strategyUp = plan.strategy.toUpperCase();
  const interestSaved =
    Number(plan.baselineInterest) - Number(plan.totalInterest);
  const horizon = plan.trajectory.length;
  // Short of cash this month: the schedule below pays minimums the user
  // can't fund, so its date isn't one to plan around.
  const short = plan.shortfall > 0 || !!plan.futureShortfall;
  const clearLabel = short
    ? 'NO DATE YET'
    : plan.debtFreeMonth
      ? monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country).toUpperCase()
      : 'NOT IN LIFETIME';
  // What the plan pays the banks this month (EMIs, card minimums and the
  // extra), in the user's currency. Summing scheduled EMIs mixed ₹ and $,
  // counted paid-off loans and missed card minimums with no EMI set.
  const monthlyOutlay =
    plan.monthlyPayments.find((p) => p.month === 1)?.totalPaid ??
    deriveMetrics({ user: plan.user, marginalRate: plan.marginalRate } as StoredProfile)
      .emiBurden.toNumber() +
      Math.max(0, plan.surplusAllocation?.debtSlice ?? plan.surplus);
  // Nothing owed: every loan on file is at 0, or there are none.
  const debtFreeNow = !plan.user.loans.some((l) => dec(l.outstanding).gt(0));

  // ─── trajectory adapter ─────────────────────────────────────────────
  // x runs from month 1 (this month) to the last month either line is
  // still above zero; each point is the balance after that month's
  // payment.
  const today = getCountryToday(plan.user.country);
  const traj = plan.trajectory;
  const firstMonth = traj[0]?.month ?? 1;
  const lastMonth = traj[traj.length - 1]?.month ?? 1;
  const span = Math.max(1, lastMonth - firstMonth);
  const tOf = (month: number) => (month - firstMonth) / span;
  const maxBal = traj.reduce((mx, p) => Math.max(mx, p.avalanche, p.minimums), 0);
  const shortDate = (month: number) => {
    const d = monthIndexToDate(month, today);
    return `${MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ${String(d.getFullYear()).slice(-2)}`;
  };

  const trajPoints: LTrajPoint[] = useMemo(
    () =>
      traj.map((p) => ({
        t: tOf(p.month),
        av: maxBal > 0 ? p.avalanche / maxBal : 0,
        min: maxBal > 0 ? p.minimums / maxBal : 0,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [traj, maxBal],
  );

  if (debtFreeNow) return <DebtFreeNow hasLoans={plan.user.loans.length > 0} />;
  if (plan.gaps.length > 0) return <NeedsLoanDetails gaps={plan.gaps} />;

  const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const month = firstMonth + Math.round(f * span);
    return { t: tOf(month), l: shortDate(month) };
  });

  // Compact (₹35.7L): the full figure didn't fit beside the axis on a phone.
  const yLabels = [
    { y: 1, l: formatCurrencyCompact(maxBal, ccy) },
    { y: 0.5, l: formatCurrencyCompact(maxBal / 2, ccy) },
    { y: 0, l: formatCurrencyCompact(0, ccy) },
  ];

  const lastBaselineDebt = traj.filter(p => p.minimums > 0.5).at(-1)?.month ?? 0;
  const baselineClear = traj.find(p => p.month > lastBaselineDebt && p.minimums <= 0.5)?.month ?? null;
  const chartTitle =
    traj.length === 0
      ? ''
      : `Total debt over time. ${strategyUp.toLowerCase()} plan: ${fc(traj[0].avalanche)} after this month, ` +
        (!short && plan.debtFreeMonth
          ? `cleared in ${monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country)}. `
          : 'not cleared within the plan. ') +
        (baselineClear
          ? `Paying only the minimums clears it in ${monthIndexToCountryLabel(baselineClear, plan.user.country)}.`
          : 'Paying only the minimums does not clear it within the plan.');

  return (
    <LShell>
      <div
        style={{
          flex: 1,
          padding: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          fontFamily: L_MONO,
        }}
      >
        {plan.activityImpact && (
          <ActivityImpactBanner
            impact={plan.activityImpact}
            loans={plan.user.loans}
            country={plan.user.country}
            variant="ledger"
          />
        )}

        {/* What the plan assumes (editable chips), then what it comes to */}
        <PlanAssumptions plan={plan} />
        <LKpi
          cols={4}
          items={[
            short
              ? {
                  l: 'DEBT-FREE',
                  v: clearLabel,
                  s: plan.shortfall > 0 ? `SHORT ${fc(Math.round(plan.shortfall))}/MO` : 'FUTURE PAYMENTS NEED FUNDING',
                  tone: L_T.negative,
                }
              : {
                  l: 'DEBT-FREE',
                  v: clearLabel,
                  s: plan.debtFreeMonth
                    ? `IN ${monthsSpan(plan.debtFreeMonth).toUpperCase()}`
                    : 'RAISE SURPLUS OR CUT SPEND TO CLEAR',
                },
            {
              l: 'TOTAL INTEREST',
              v: fc(plan.totalInterest),
              s: interestSaved >= 1 ? `${fc(interestSaved)} LESS THAN MINIMUMS` : 'SAME AS PAYING MINIMUMS',
              tone: L_T.positive,
            },
            {
              l: 'TIME SAVED',
              v: !short && plan.monthsSaved > 0 ? monthsSpan(plan.monthsSaved).toUpperCase() : '—',
              // The minimums can run past the plan's horizon (a card whose
              // minimum barely covers its interest): there's no date to compare.
              s: short
                ? 'NEEDS A PAYOFF DATE FIRST'
                : plan.monthsSaved > 0 || baselineClear
                  ? 'VS PAYING ONLY MINIMUMS'
                  : 'MINIMUMS ALONE NEVER CLEAR IT',
              tone: L_T.accent,
            },
            {
              l: 'PAYING THIS MONTH',
              v: fc(monthlyOutlay),
              s: 'EMIS + MINIMUMS + EXTRA',
            },
          ]}
        />

        {plan.shortfall > 0 && <ShortfallBanner plan={plan} />}
        {plan.futureShortfall && <div role="alert" style={{color:L_T.negative,fontSize:12}}>
          FUTURE FUNDING GAP · SHORT {fc(plan.futureShortfall.amount)} IN {monthIndexToCountryLabel(plan.futureShortfall.month,plan.user.country).toUpperCase()}.
          The forecast assumes all minimum payments are funded. Revise the planned loan, income or expenses before relying on a payoff date.
        </div>}
        {plan.user.loans.some(l=>l.planned_effective_month) && <div style={{fontSize:12}}>
          Forecast includes planned loans: {plan.user.loans.filter(l=>l.planned_effective_month).map(l=>
            `${l.bank} from ${monthIndexToCountryLabel(l.planned_effective_month!,plan.user.country)}`).join('; ')}.
          Confirm, postpone or cancel the event when the date arrives.
        </div>}
        <FxCachePersister rates={plan.fxRatesUsed} />
        <LifecycleArrivalPrompts user={plan.user} variant="ledger" />
        <BracketTransitionAlert
          transitions={plan.bracketTransitions}
          country={plan.user.country}
          displayCurrency={plan.displayCurrency}
          variant="ledger"
        />

        {/* 3. Trajectory */}
        <section>
          <LSectionHeader>
            TRAJECTORY · TOTAL DEBT OVER TIME
          </LSectionHeader>
          {trajPoints.length > 0 ? (
            <>
              <LTrajectory
                points={trajPoints}
                clear={
                  plan.debtFreeMonth
                    ? {
                        t: tOf(plan.debtFreeMonth),
                        label: `${shortDate(plan.debtFreeMonth)} · CLEAR`,
                      }
                    : undefined
                }
                axisLabels={xLabels}
                yLabels={yLabels}
                title={chartTitle}
              />
              <div
                style={{
                  display: 'flex',
                  gap: 18,
                  fontSize: 10,
                  color: L_T.muted,
                  marginTop: 8,
                  letterSpacing: '0.1em',
                }}
              >
                <span>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 14,
                      height: 2,
                      background: L_T.ink,
                      verticalAlign: 'middle',
                      marginRight: 6,
                    }}
                  />
                  {strategyUp}
                </span>
                <span>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 14,
                      borderTop: `2px dashed ${L_T.muted}`,
                      verticalAlign: 'middle',
                      marginRight: 6,
                    }}
                  />
                  MINIMUMS
                </span>
              </div>
            </>
          ) : (
            <div style={{ padding: 18, fontSize: 12, color: L_T.muted }}>
              $ NO TRAJECTORY · simulation returned no points.
            </div>
          )}
        </section>

        {/* When each loan clears */}
        <section>
          <LSectionHeader>KEY DATES · WHEN EACH LOAN CLEARS</LSectionHeader>
          {!short && <><DebtFreeRedirectPrompt plan={plan} /><KeyClearanceDates plan={plan} /></>}
          {short && <p style={{fontSize:12}}>Resolve the funding gap to get reliable clearance milestones. The schedule below assumes every minimum payment is funded.</p>}
        </section>

        {/* Planned salary changes, rate resets and new loans (moved here from
            the Debts page in R2; R3.4 restyles it). */}
        <div id="life-events" style={{ scrollMarginTop: 16 }}>
          <LifecycleEventsPanel user={plan.user} variant="ledger" />
        </div>

        <CentralBankHint
          country={plan.user.country}
          hasFloating={plan.user.loans.some((l) => l.rate_type === 'floating')}
        />

        {/* Whether investing beats prepaying */}
        <InvestVsPrepayCard plan={plan} variant="ledger" />

        {plan.advanceTaxSchedule && (
          <AdvanceTaxPanel
            schedule={plan.advanceTaxSchedule}
            country={plan.user.country}
            displayCurrency={plan.displayCurrency}
            monthlyPenaltyCost={plan.advanceTaxPenaltyMonthly}
            variant="ledger"
          />
        )}

        {/* 5. Amortisation */}
        <AmortisationSection plan={plan} fc={fc} horizon={horizon} />

        {/* 6. What if — real engine runs, not estimates */}
        <section id="what-if" style={{ scrollMarginTop: 16 }}>
          <LSectionHeader>WHAT IF · TRY A SCENARIO</LSectionHeader>
          <div style={{ fontSize: 11, color: L_T.muted, marginBottom: 10, lineHeight: 1.5 }}>
            Each slider re-runs your plan. Nothing here changes your saved plan
            until you press apply.
          </div>
          <LCardHard>
            <WhatIfPanel
              user={plan.runArgs?.user ?? {...plan.user,loans:plan.user.loans.filter(l=>!l.planned_effective_month)}}
              marginalRate={plan.marginalRate}
              strategy={plan.strategy}
              runArgs={plan.runArgs}
            />
          </LCardHard>
        </section>
      </div>
    </LShell>
  );
}

const LOAN_SHORT: Record<string, string> = {
  home_loan: 'Home',
  auto_loan: 'Car',
  personal_loan: 'Personal',
  credit_card: 'Card',
  education_loan: 'Edu',
  gold_loan: 'Gold',
  bnpl: 'BNPL',
};

type ScheduleCsvRow = {
  mo: number;
  date: string;
  perLoan: Record<number, string>;
  extra: number;
  interest: number;
  principal: number;
  balance: number;
  event: string;
};

function csvCell(v: string | number): string {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** A spreadsheet-safe column name: "pay_2_credit_card_hdfc_bank_inr". The
 *  position keeps two unnamed loans (or two from one bank) apart. */
function payColumn(loan: PlanData['user']['loans'][number], i: number, country: PlanData['user']['country']): string {
  const bank = (loan.bank || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const ccy = loanCurrency(loan, country).toLowerCase();
  return ['pay', i + 1, loan.loan_type, bank, ccy].filter(Boolean).join('_');
}

/** Every month of the schedule as a CSV file (the table may be collapsed).
 *  Each loan's column is in that loan's currency; the totals are in the
 *  user's, and every header says which. */
function downloadRowsCSV(rows: ScheduleCsvRow[], plan: PlanData) {
  const { loans, country } = plan.user;
  const ccy = plan.displayCurrency.toLowerCase();
  const header = [
    'month',
    'date',
    ...loans.map((l, i) => payColumn(l, i, country)),
    `extra_${ccy}`,
    `interest_${ccy}`,
    `principal_${ccy}`,
    `balance_${ccy}`,
    'event',
  ];
  const lines = rows.map((r) =>
    [
      r.mo,
      r.date,
      ...loans.map((_, i) => Math.round(Number(r.perLoan[i] ?? 0))),
      Math.round(r.extra),
      Math.round(r.interest),
      Math.round(r.principal),
      Math.round(r.balance),
      r.event,
    ]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n') + '\n'], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'debt-plan-schedule.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Amortisation §4.4 ──────────────────────────────────────────────────
// Spec: default state is COLLAPSED — only event-bearing rows render, each
// with a yellow wash. The bracket flips `[↓ EXPAND ALL N]` ↔ `[↑ COLLAPSE]`.
// Glyphs: ⊕ rate reset · ⊙ annual review · ★ debt cleared / windfall.
function AmortisationSection({
  plan,
  fc,
  horizon,
}: {
  plan: PlanData;
  fc: (v: string | number) => string;
  horizon: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const today = getCountryToday(plan.user.country);
  const loanCols = plan.user.loans.slice(0, 4);

  // Build all rows once with derived event + numbers, then filter at render
  // time depending on collapse state. Keeps event-detection logic in one
  // place and lets us count rows for the header label.
  const trajByMonth = new Map<number, number>(
    plan.trajectory.map((p) => [p.month, p.avalanche]),
  );
  const interestByMonth = new Map<number, number | undefined>(
    plan.trajectory.map((p) => [p.month, p.interest]),
  );
  // ⊕ rate reset + ⊙ salary reset glyphs are gated on threading
  // `lifecycle_events` into PlanData — see LEDGER_MISSING §G.1 follow-up.
  // For now we surface ★ cleared (from trajectory) and ⊙ annual review
  // (every 12th month), which both derive purely from plan data.

  type Row = ScheduleCsvRow;

  const rows: Row[] = plan.monthlyPayments.map((row) => {
    const d = monthIndexToDate(row.month, today);
    const date = `${MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ${String(d.getFullYear()).slice(-2)}`;
    const bal = trajByMonth.get(row.month) ?? 0;
    const perLoan = row.perLoan ?? {};
    // The engine's totals, in the user's currency: summing perLoan mixed
    // ₹ and $, and "extra" was the total less every scheduled EMI, so a
    // card's minimum (EMI 0) read as extra and a cleared loan's EMI kept
    // being taken off.
    const totalPay = row.totalPaid;
    // The engine's interest for the month. Deriving it from the balance
    // drop made month 1 all interest (there is no month 0 to compare with).
    const engineInterest = interestByMonth.get(row.month);
    const prevBal = trajByMonth.get(row.month - 1);
    const interest =
      engineInterest != null
        ? engineInterest
        : prevBal != null
          ? Math.max(0, totalPay - (prevBal - bal))
          : 0;
    const principal = Math.max(0, totalPay - interest);
    const extra = row.extraPaid;
    // Event resolution — pick the loudest event for this month.
    let event = '';
    const balancesNow = plan.trajectory.find(
      (p) => p.month === row.month,
    )?.balancesByLoanIndex;
    const balancesPrev = plan.trajectory.find(
      (p) => p.month === row.month - 1,
    )?.balancesByLoanIndex;
    // Month 1 has no earlier row: compare with today's balances, or a
    // loan cleared in the first month never got its ★.
    if (balancesNow) {
      for (const [idxStr, n] of Object.entries(balancesNow)) {
        const prev = balancesPrev
          ? Number(balancesPrev[idxStr] ?? 0)
          : (plan.user.loans[Number(idxStr)]?.planned_effective_month ?? 1) > 1
            ? 0 : Number(plan.user.loans[Number(idxStr)]?.outstanding ?? 0);
        if (prev > 0 && Number(n) <= 0.01) {
          const lender = plan.user.loans[Number(idxStr)]?.bank ?? 'LOAN';
          event = `★ ${lender.toUpperCase()} CLEARED`;
          break;
        }
      }
    }
    if (!event && row.month > 1 && row.month % 12 === 0) {
      event = `⊙ ANNUAL REVIEW`;
    }
    return {
      mo: row.month,
      date,
      perLoan,
      extra,
      interest,
      principal,
      balance: bal,
      event,
    };
  });

  const eventRows = rows.filter((r) => r.event);
  const visibleRows = expanded ? rows : eventRows;
  const totalCount = rows.length || horizon;

  return (
    <section>
      <LSectionHeader
        right={
          <>
            <LBracket onClick={() => downloadRowsCSV(rows, plan)}>
              CSV
            </LBracket>{' '}
            <LBracket onClick={() => window.print()}>PRINT</LBracket>{' '}
            <LBracket onClick={() => setExpanded((v) => !v)}>
              {expanded ? '↑ COLLAPSE' : `↓ EXPAND ALL ${totalCount}`}
            </LBracket>
          </>
        }
      >
        AMORTISATION ·{' '}
        {expanded
          ? `${totalCount} MO`
          : `${eventRows.length} EVENT${eventRows.length === 1 ? '' : 'S'} · EXPAND FOR ${totalCount} MO`}
      </LSectionHeader>
      {visibleRows.length === 0 ? (
        <div style={{ padding: '14px 0', fontSize: 11, color: L_T.muted }}>
          $ NO EVENTS · the next {totalCount} months hold steady. Expand to
          inspect every row.
        </div>
      ) : (
        <div
          role="region"
          aria-label="Month-by-month schedule"
          tabIndex={0}
          style={{
            overflowX: 'auto',
            maxHeight: expanded ? 460 : undefined,
            overflowY: expanded ? 'auto' : undefined,
            borderBottom: expanded ? `1px solid ${L_T.faint}` : undefined,
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 11,
              minWidth: 760,
            }}
          >
            <thead>
              <tr
                style={{
                  borderTop: `2px solid ${L_T.ink}`,
                  borderBottom: `1px solid ${L_T.ink}`,
                  background: L_T.bg,
                  position: expanded ? 'sticky' : undefined,
                  top: 0,
                  zIndex: 1,
                }}
              >
                {[
                  'MO',
                  'DATE',
                  // Type first: two loans from one bank used to show as
                  // two identical "HDFC BAN" columns.
                  ...loanCols.map((l) =>
                    `${LOAN_SHORT[l.loan_type] ?? 'LOAN'} · ${(l.bank || '—').split(' ')[0].slice(0, 6)}`.toUpperCase() +
                    // A loan in another currency says so: its column is in it.
                    (loanCurrency(l, plan.user.country) !== plan.displayCurrency
                      ? ` (${loanCurrency(l, plan.user.country)})`
                      : ''),
                  ),
                  'EXTRA',
                  'INT PAID',
                  'PRIN',
                  'BALANCE',
                  'EVENT',
                ].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: '6px 10px',
                      textAlign: i < 2 ? 'left' : 'right',
                      fontWeight: 700,
                      fontSize: 9,
                      color: L_T.muted,
                      letterSpacing: '0.06em',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => {
                const highlight = !!r.event;
                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom: `1px dashed ${L_T.faint}`,
                      background: highlight ? L_T.highlight : 'transparent',
                    }}
                  >
                    <td style={{ padding: '6px 10px' }}>
                      {String(r.mo).padStart(2, '0')}
                    </td>
                    <td style={{ padding: '6px 10px' }}>{r.date}</td>
                    {loanCols.map((_, idx) => (
                      <td
                        key={idx}
                        style={{ padding: '6px 10px', textAlign: 'right' }}
                      >
                        {r.perLoan[idx]
                          ? formatCurrencyWhole(
                              Number(r.perLoan[idx]).toFixed(0),
                              loanCurrency(loanCols[idx], plan.user.country),
                            )
                          : '—'}
                      </td>
                    ))}
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        color: L_T.accent,
                        fontWeight: 700,
                      }}
                    >
                      {r.extra > 0 ? fc(r.extra.toFixed(0)) : '—'}
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        color: L_T.negative,
                      }}
                    >
                      {fc(r.interest.toFixed(0))}
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        color: L_T.positive,
                      }}
                    >
                      {fc(r.principal.toFixed(0))}
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        fontWeight: 700,
                      }}
                    >
                      {fc(r.balance.toFixed(0))}
                    </td>
                    <td
                      style={{
                        padding: '6px 10px',
                        textAlign: 'right',
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {r.event}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Re-export for type narrowing in the page wrapper.
export type { PlanData };
// (Decimal is imported above so future contributors keep precise math
// in this file when they wire real engine deltas.)
void Decimal;


/** /plan when nothing is owed: the plan's cards (date, outlay, chart)
 *  would all be made up ("NOT IN LIFETIME", an outlay with no loans). */
/** Income doesn't cover costs plus minimums: say by how much and what the
 *  schedule assumes, instead of offering its date as a plan. */
function ShortfallBanner({ plan }: { plan: PlanData }) {
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), plan.displayCurrency);
  const income = dec(plan.user.monthly_income).toNumber();
  const costs = dec(plan.user.fixed_expenses).add(dec(plan.user.variable_expenses)).toNumber();
  // The engine's minimums, so the three figures add up to its shortfall.
  const minimums = Math.max(0, plan.shortfall + income - costs);
  return (
    <section
      role="status"
      style={{ border: `2px solid ${L_T.negative}`, padding: '14px 18px', fontSize: 12, lineHeight: 1.7 }}
    >
      <div style={{ fontWeight: 700, color: L_T.negative, letterSpacing: '0.08em', marginBottom: 6 }}>
        $ SHORT {fc(plan.shortfall)} A MONTH · NO PAYOFF DATE YET
      </div>
      Your costs ({fc(costs)}) and minimum payments ({fc(minimums)}) come to more
      than your income ({fc(income)}). The schedule below assumes the minimums get
      paid anyway; each month they can&apos;t be, the balance grows and late fees
      start. First close the gap: cut costs (try the what-if below), raise income,
      or ask the bank for a lower payment (a longer tenure, or moving a card
      balance to a cheaper loan).
    </section>
  );
}

/** A loan is missing its rate or EMI: no projection until it's added. */
function NeedsLoanDetails({ gaps }: { gaps: ProfileGap[] }) {
  return (
    <LShell>
      <div style={{ padding: '40px 0', fontFamily: L_MONO }}>
        <LCli>PLAN · NEEDS YOUR LOAN DETAILS</LCli>
        <LRule length={200} />
        <div style={{ marginTop: 18, fontSize: 12, color: L_T.muted, lineHeight: 1.7 }}>
          There&apos;s no payoff date yet.{' '}
          {gaps.some((g) => g.missing.includes('fx'))
            ? 'Without an exchange rate a loan in another currency would be counted one-for-one, ₹ as $.'
            : 'Without these the plan would treat a loan as interest-free or never paid down.'}
          <ul style={{ margin: '10px 0 14px', paddingLeft: 18, color: L_T.ink }}>
            {gaps.map((g) => (
              <li key={g.index}>
                {(g.loan.bank || 'Your').toUpperCase()} {LOAN_TYPE_NAME[g.loan.loan_type].toUpperCase()}: add{' '}
                {describeGap(g.missing, g.loan)}
              </li>
            ))}
          </ul>
          <LBracket href="/profile?step=loans">ADD THE DETAILS →</LBracket>
        </div>
      </div>
    </LShell>
  );
}

function DebtFreeNow({ hasLoans }: { hasLoans: boolean }) {
  return (
    <LShell>
      <div style={{ padding: '40px 0', fontFamily: L_MONO }}>
        <LCli>{hasLoans ? 'PLAN · DEBT-FREE' : 'PLAN · NO DEBTS ON FILE'}</LCli>
        <LRule length={200} />
        <div style={{ marginTop: 18, fontSize: 12, color: L_T.muted, lineHeight: 1.7 }}>
          {hasLoans
            ? 'Every loan on file is paid off, so there is nothing to plan here. '
            : 'Add a loan to see your payoff date and monthly plan. '}
          <LBracket href="/goals">GOALS →</LBracket>{' '}
          <LBracket href="/profile?step=loans">{hasLoans ? 'ADD A LOAN →' : 'ADD YOUR LOANS →'}</LBracket>
        </div>
      </div>
    </LShell>
  );
}
