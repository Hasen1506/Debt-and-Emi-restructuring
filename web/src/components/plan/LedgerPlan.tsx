'use client';

/**
 * Ledger Plan — the printed amortisation statement.
 *
 * Sections (matches the prototype, top to bottom):
 *   1. CLI summary line
 *   2. 4-cell KPI: CLEAR DATE / TOTAL INTEREST / MONTHS SAVED / OUTLAY
 *   3. TRAJECTORY · TOTAL DEBT OVER TIME  (LTrajectory)
 *   4. CHEAPER RATES (restructure opportunities)
 *   5. AMORTISATION · NEXT 12 MO  (dense table)
 *   6. WHAT IF  (sliders that re-run the engine)
 *
 * Ledger is the only skin, so the panels the other two skins carried
 * (strategy, assumptions, per-loan clear dates, invest-vs-prepay, tax
 * alerts, life-event prompts) render here too.
 */

import { Fragment, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import type { PlanData } from './PlanData';
import { formatCurrency, formatCurrencyCompact, formatPct } from '@/lib/api';
import {
  monthIndexToCountryLabel,
  monthIndexToDate,
  MONTH_NAMES,
  FY_ANCHOR_MONTH,
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
import type { StoredProfile } from '@/lib/user-store';
import { LTrajectory, type LTrajPoint } from '@/components/ledger/LDebtsTable';
import {
  EligibilityCaveat,
  OpportunityAlternative,
  UpdateTermsButton,
} from './OpportunityAlternative';
import { StrategySwitcher } from '@/components/StrategySwitcher';
import { HikeToggle } from '@/components/HikeToggle';
import { TaxReinvestToggle } from '@/components/TaxReinvestToggle';
import { InflationToggle } from '@/components/InflationToggle';
import { EfSplitSlider } from '@/components/EfSplitSlider';
import { FxDriftToggle } from '@/components/FxDriftToggle';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { LifecycleArrivalPrompts } from '@/components/lifecycle/LifecycleArrivalPrompts';
import { FxCachePersister } from './FxCachePersister';
import { ActivityImpactBanner } from './ActivityImpactBanner';
import { BracketTransitionAlert } from './BracketTransitionAlert';
import { AdvanceTaxPanel } from './AdvanceTaxPanel';
import { CentralBankHint } from './CentralBankHint';
import { KeyClearanceDates } from './KeyClearanceDates';
import { DebtFreeRedirectPrompt } from './DebtFreeRedirectPrompt';
import { InvestVsPrepayCard } from './InvestVsPrepayCard';
import { SurplusWaterfall } from './SurplusWaterfall';

export function LedgerPlan({ plan }: { plan: PlanData }) {
  const ccy = plan.displayCurrency;
  const fc = (v: string | number) => formatCurrency(v, ccy);
  const marginalPct = (Number(plan.marginalRate) * 100).toFixed(0);
  const strategyUp = plan.strategy.toUpperCase();
  const interestSaved =
    Number(plan.baselineInterest) - Number(plan.totalInterest);
  const horizon = plan.trajectory.length;
  const clearLabel = plan.debtFreeMonth
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
  const isHybrid = plan.currenciesInPlay.length > 1;
  const hikeRate = Number(plan.user.annual_hike_rate ?? '0');
  const inflRate = Number(plan.user.inflation_rate ?? '0');
  const hikeMonthIdx = plan.user.hike_effective_month ?? FY_ANCHOR_MONTH[plan.user.country];
  const taxReinvestTotal = plan.taxReinvestProjection.reduce((sum, e) => sum + Number(e.amount), 0);

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

  const baselineClear = traj.find((p) => p.month > 0 && p.minimums <= 0.5)?.month ?? null;
  const chartTitle =
    traj.length === 0
      ? ''
      : `Total debt over time. ${strategyUp.toLowerCase()} plan: ${fc(traj[0].avalanche)} after this month, ` +
        (plan.debtFreeMonth
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
        {/* 1. CLI line + 2. KPI strip */}
        <section>
          <LCli>
            PLAN · {strategyUp} · {marginalPct}% TAX BRACKET
            {!plan.profileIsLive && ' · DEMO'}
            {!plan.live && ' · OFFLINE'}
          </LCli>
          <LKpi
            cols={4}
            items={[
              {
                l: 'DEBT-FREE',
                v: clearLabel,
                s: plan.debtFreeMonth
                  ? `IN ${plan.debtFreeMonth} MONTHS`
                  : 'RAISE SURPLUS OR CUT SPEND TO CLEAR',
              },
              {
                l: 'TOTAL INTEREST',
                v: fc(plan.totalInterest),
                s: `VS ${fc(plan.baselineInterest)} ON MINIMUMS`,
                tone: L_T.positive,
              },
              {
                l: 'MONTHS SAVED',
                v: String(plan.monthsSaved),
                s: 'VS PAYING MINIMUMS',
                tone: L_T.accent,
              },
              {
                l: 'MONTHLY OUTLAY',
                v: `${fc(monthlyOutlay)}/MO`,
                s: 'EMIS + EXTRA',
              },
            ]}
          />
        </section>

        <FxCachePersister rates={plan.fxRatesUsed} />
        <LifecycleArrivalPrompts user={plan.user} variant="ledger" />
        {plan.activityImpact && (
          <ActivityImpactBanner
            impact={plan.activityImpact}
            loans={plan.user.loans}
            country={plan.user.country}
            variant="ledger"
          />
        )}
        <BracketTransitionAlert
          transitions={plan.bracketTransitions}
          country={plan.user.country}
          displayCurrency={plan.displayCurrency}
          variant="ledger"
        />

        {/* How the plan is built: strategy + the assumptions behind it */}
        <section>
          <LSectionHeader>HOW THIS PLAN IS BUILT</LSectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <StrategySwitcher
              active={plan.strategy}
              variant="ledger"
              compare={plan.strategyCompare}
              country={plan.user.country}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
              <HikeToggle
                active={plan.hikeModeling}
                hikeRatePct={hikeRate > 0 ? `${(hikeRate * 100).toFixed(0)}%` : '0%'}
                hikeMonthLabel={MONTH_NAMES[Math.max(0, Math.min(11, hikeMonthIdx - 1))]}
                hikePhases={plan.user.hike_schedule}
                variant="ledger"
              />
              <InflationToggle
                active={plan.inflationModeling}
                inflationRatePct={inflRate > 0 ? `${(inflRate * 100).toFixed(1)}%` : '0%'}
                variant="ledger"
              />
              <TaxReinvestToggle
                active={plan.taxReinvest}
                totalProjectedSaving={formatCurrency(taxReinvestTotal.toFixed(0), ccy)}
                variant="ledger"
              />
              {isHybrid && (
                <FxDriftToggle
                  active={plan.fxDrift}
                  driftLabel="INR +2.5%/yr (CPI differential)"
                  variant="ledger"
                />
              )}
            </div>
            <EfSplitSlider
              active={plan.efSplit}
              hasGap={
                Number(plan.user.efund_target || 0) > 0 &&
                Number(plan.user.efund_balance || 0) < Number(plan.user.efund_target || 0)
              }
              ccySym={plan.user.country === 'IN' ? '₹' : '$'}
              variant="ledger"
            />
          </div>
        </section>

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
          <DebtFreeRedirectPrompt plan={plan} />
          <KeyClearanceDates plan={plan} />
        </section>

        <CentralBankHint
          country={plan.user.country}
          hasFloating={plan.user.loans.some((l) => l.rate_type === 'floating')}
        />

        {/* 4. Restructure */}
        {plan.opportunities.length > 0 && (
          <section>
            <LSectionHeader
              right={
                <span style={{ color: L_T.positive, fontWeight: 700 }}>
                  UP TO {fc(plan.totalAnnualSaving)} IN YEAR 1
                </span>
              }
            >
              CHEAPER RATES · DO THESE BEFORE PAYING EXTRA
            </LSectionHeader>
            <RestructureTable plan={plan} fc={fc} />
          </section>
        )}

        {/* Where the spare cash goes, and whether investing beats prepaying */}
        <SurplusWaterfall plan={plan} />
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
              user={plan.user}
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

// ─── Restructure table ──────────────────────────────────────────────────
// One row per move: which loan, where to, the rate change, what it costs up
// front, how many months until that cost is earned back, and the saving in
// the first year after the cost. Every kind is measured the same way (the
// engine's `estimated_annual_saving`). Under each row: the engine's
// one-line headline, the eligibility caveat and "I did this".
function loanLabel(plan: PlanData, idx: number): string {
  const l = plan.user.loans[idx];
  if (!l) return 'LOAN';
  return `${LOAN_SHORT[l.loan_type] ?? 'LOAN'} · ${(l.bank || '—').split(' ')[0].slice(0, 8)}`.toUpperCase();
}

function RestructureTable({
  plan,
  fc,
}: {
  plan: PlanData;
  fc: (v: string | number) => string;
}) {
  const heads = ['LOAN', 'MOVE TO', 'RATE', 'ONE-TIME COST', 'PAYS BACK IN', 'SAVES IN YEAR 1'];
  const cell = { padding: '12px 12px', verticalAlign: 'top' as const };
  return (
    <div
      role="region"
      aria-label="Cheaper-rate moves"
      tabIndex={0}
      style={{ overflowX: 'auto' }}
    >
      <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
            {heads.map((h, i) => (
              <th
                key={h}
                scope="col"
                style={{
                  padding: '8px 12px',
                  textAlign: i > 2 ? 'right' : 'left',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontSize: 10,
                  color: L_T.muted,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plan.opportunities.map((o, i) => {
            const loans = (o.affected_loan_indices ?? []).map((idx) => loanLabel(plan, idx));
            const saving = Number(o.estimated_annual_saving);
            const months = o.breakeven_months;
            return (
              <Fragment key={i}>
                <tr>
                  <td style={{ ...cell, fontWeight: 700, color: L_T.accent }}>
                    {loans.length > 0 ? loans.map((l) => <div key={l}>{l}</div>) : '—'}
                  </td>
                  <td style={cell}>
                    {(o.target_bank ?? '—').toUpperCase()}
                    <div style={{ color: L_T.muted, fontSize: 10, marginTop: 2 }}>
                      {o.kind.replace('_', ' ').toUpperCase()}
                    </div>
                  </td>
                  <td style={cell}>
                    {formatPct(o.current_rate)} → {formatPct(o.target_rate)}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {Number(o.one_time_cost ?? 0) > 0 ? fc(o.one_time_cost ?? 0) : '—'}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {months == null ? '—' : months <= 1 ? '1 MO' : `${months} MO`}
                  </td>
                  <td
                    style={{
                      ...cell,
                      textAlign: 'right',
                      color: saving > 0 ? L_T.positive : L_T.negative,
                      fontWeight: 700,
                    }}
                  >
                    {fc(o.estimated_annual_saving)}
                    {o.lifetime_net_saving != null && (
                      <div style={{ color: L_T.muted, fontWeight: 400, fontSize: 10, marginTop: 2 }}>
                        {fc(o.lifetime_net_saving)} OVER THE LOAN
                      </div>
                    )}
                  </td>
                </tr>
                <tr style={{ borderBottom: `1px dashed ${L_T.faint}` }}>
                  <td colSpan={heads.length} style={{ padding: '0 12px 12px', fontSize: 11, color: L_T.muted }}>
                    {o.headline}.
                    <EligibilityCaveat kind={o.kind} country={plan.user.country} variant="ledger" />
                    <UpdateTermsButton
                      opportunity={o}
                      user={plan.user}
                      currency={plan.displayCurrency}
                      variant="ledger"
                    />
                    <OpportunityAlternative opportunity={o} variant="ledger" currency={plan.displayCurrency} />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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

/** Every month of the schedule as a CSV file (the table may be collapsed). */
function downloadRowsCSV(rows: ScheduleCsvRow[], banks: string[]) {
  const header = ['month', 'date', ...banks.map((b) => `pay_${b}`), 'extra', 'interest', 'principal', 'balance', 'event'];
  const lines = rows.map((r) =>
    [
      r.mo,
      r.date,
      ...banks.map((_, i) => Math.round(Number(r.perLoan[i] ?? 0))),
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
          : Number(plan.user.loans[Number(idxStr)]?.outstanding ?? 0);
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
            <LBracket onClick={() => downloadRowsCSV(rows, plan.user.loans.map((l) => l.bank || 'loan'))}>
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
                    `${LOAN_SHORT[l.loan_type] ?? 'LOAN'} · ${(l.bank || '—').split(' ')[0].slice(0, 6)}`.toUpperCase(),
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
                          ? fc(Number(r.perLoan[idx]).toFixed(0))
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
          <LBracket href="/onboarding?step=loans">{hasLoans ? 'ADD A LOAN →' : 'ADD YOUR LOANS →'}</LBracket>
        </div>
      </div>
    </LShell>
  );
}
