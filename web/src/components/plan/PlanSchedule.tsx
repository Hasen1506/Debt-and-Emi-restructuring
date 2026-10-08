'use client';

/**
 * Plan's schedule (REDESIGN R3.3): every month of the plan, collapsed to
 * the months something happens — a loan paid off, a rate reset, a pay
 * change, a new loan starting, the end of each year. Below the table, the
 * next floating-rate reset (when it's within three months). The central
 * bank's next decision has its own section (RateDecisions).
 */
import { useState } from 'react';
import type { PlanData } from './PlanData';
import { formatCurrencyWhole, type LoanPayload } from '@/lib/api';
import { getCountryToday, localIsoDate, monthIndexToDate, MONTH_NAMES } from '@/lib/today';
import { loanCurrency } from '@/lib/currency';
import { loanLabel } from '@/lib/loan-types';
import { LBracket, LSectionHeader, L_T } from '@/components/ledger/primitives';
import { loanClears } from './plan-milestones';
import { isOpenCurrentLoan } from '@/lib/plan-controls';
import { resetDate } from '@/lib/rate-decision';
import { ADD_LIFE_EVENT } from '@/components/lifecycle/LifecycleEventsPanel';
import { deriveMetrics } from '@/lib/derived';
import { GST_RATE_IN } from '@/lib/gst';
import { reconcileSchedule, scheduleColumnHelp } from '@/lib/schedule-reconcile';
import type { StoredProfile } from '@/lib/user-store';

const LOAN_SHORT: Record<string, string> = {
  home_loan: 'Home',
  auto_loan: 'Car',
  personal_loan: 'Personal',
  credit_card: 'Card',
  education_loan: 'Edu',
  gold_loan: 'Gold',
  bnpl: 'BNPL',
};

/** "HDFC home loan" (not "HDFC Bank home loan"), or "Home loan" without a lender. */
const loanName = (l: LoanPayload): string => loanLabel(l);

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

/** What happens in each month of the plan, by month. Glyphs:
 *  ★ paid off · ⊕ rate change · ⊙ pay change or year end · + new loan. */
function scheduleEvents(plan: PlanData, short: boolean): Map<number, string[]> {
  const { loans } = plan.user;
  const events = new Map<number, string[]>();
  const add = (m: number, e: string) => {
    if (m >= 1) events.set(m, [...(events.get(m) ?? []), e]);
  };
  const clearsByMonth = new Map<number, string[]>();
  for (const c of loanClears(plan)) clearsByMonth.set(c.month, [...(clearsByMonth.get(c.month) ?? []), c.name]);
  for (const [m, names] of clearsByMonth) {
    const what = `${names.join(' + ').toUpperCase()} PAID OFF`;
    add(m, !short && m === plan.debtFreeMonth ? `★ DEBT-FREE · ${what}` : `★ ${what}`);
  }
  loans.forEach((l) => {
    if (isOpenCurrentLoan(l) && l.rate_type === 'floating' && l.next_reset_month) add(l.next_reset_month, `⊕ ${loanName(l).toUpperCase()} RATE RESETS`);
    if (l.planned_effective_month && l.planned_effective_month > 1) add(l.planned_effective_month, `+ ${loanName(l).toUpperCase()} STARTS`);
  });
  for (const e of plan.runArgs?.lifecycle_events ?? []) {
    if (e.kind === 'floating_rate_reset' && e.loan_index != null && loans[e.loan_index] && e.new_rate) {
      add(e.effective_month, `⊕ ${loanName(loans[e.loan_index]).toUpperCase()} RATE → ${(Number(e.new_rate) * 100).toFixed(2)}%`);
    } else if (e.kind === 'salary_reset') {
      add(e.effective_month, '⊙ PAY CHANGES');
    }
  }
  const last = plan.monthlyPayments.at(-1)?.month ?? 0;
  for (let m = 12; m < last; m += 12) {
    if (!events.has(m)) add(m, `⊙ END OF YEAR ${m / 12}`);
  }
  return events;
}

export function PlanSchedule({ plan }: { plan: PlanData }) {
  const [expanded, setExpanded] = useState(false);
  const ccy = plan.displayCurrency;
  const fc = (v: string | number) => formatCurrencyWhole(v, ccy);
  const today = getCountryToday(plan.user.country);
  const loanCols = plan.user.loans.slice(0, 4);
  const short = plan.shortfall > 0 || !!plan.futureShortfall;
  const events = scheduleEvents(plan, short);

  const trajByMonth = new Map<number, number>(plan.trajectory.map((p) => [p.month, p.avalanche]));
  const interestByMonth = new Map<number, number | undefined>(plan.trajectory.map((p) => [p.month, p.interest]));

  const rows: ScheduleCsvRow[] = plan.monthlyPayments.map((row) => {
    const d = monthIndexToDate(row.month, today);
    const date = `${MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ${d.getFullYear()}`;
    const bal = trajByMonth.get(row.month) ?? 0;
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
      engineInterest != null ? engineInterest : prevBal != null ? Math.max(0, totalPay - (prevBal - bal)) : 0;
    return {
      mo: row.month,
      date,
      perLoan: row.perLoan ?? {},
      extra: row.extraPaid,
      interest,
      principal: Math.max(0, totalPay - interest),
      balance: bal,
      event: (events.get(row.month) ?? []).join(' · '),
    };
  });

  // QA #19: with loans in two currencies a row showed ₹ and $ side by side
  // and no total anyone could match to a bank account. Each row now has the
  // month's total in the plan's currency, and a note says how it's added up.
  const totalByMonth = new Map<number, number>(plan.monthlyPayments.map((row) => [row.month, row.totalPaid]));
  const foreign = Array.from(new Set(loanCols.map((l) => loanCurrency(l, plan.user.country)).filter((c) => c !== ccy)));
  const mixed = foreign.length > 0;

  // How the columns add up to what's owed today (lib/schedule-reconcile).
  const owedToday = Number(deriveMetrics({ user: plan.user, marginalRate: plan.marginalRate } as StoredProfile).totalOutstanding);
  const totals = reconcileSchedule(rows, owedToday);
  const gstApplies = plan.user.country === 'IN' && plan.user.loans.some((l) => l.loan_type === 'credit_card');
  const help: Record<string, string> = {
    ...scheduleColumnHelp(gstApplies, GST_RATE_IN.mul(100).toFixed(0)),
    [`TOTAL (${ccy})`]: 'Everything paid that month (principal + interest), in your currency.',
  };

  const eventRows = rows.filter((r) => r.event);
  const visibleRows = expanded ? rows : eventRows;
  const totalCount = rows.length || plan.trajectory.length;

  return (
    <section id="schedule" style={{ scrollMarginTop: 16 }}>
      <LSectionHeader
        right={
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '14px 12px' }}>
            <LBracket onClick={() => downloadRowsCSV(rows, plan)}>CSV</LBracket>
            <LBracket onClick={() => window.print()}>PRINT</LBracket>
            <LBracket onClick={() => setExpanded((v) => !v)}>
              {expanded ? '↑ EVENTS ONLY' : `↓ ALL ${totalCount} MONTHS`}
            </LBracket>
          </span>
        }
      >
        MONTH BY MONTH ·{' '}
        {expanded ? `${totalCount} MO` : `${eventRows.length} EVENT${eventRows.length === 1 ? '' : 'S'}`}
      </LSectionHeader>
      {visibleRows.length === 0 ? (
        <div style={{ padding: '14px 0', fontSize: 11, color: L_T.muted }}>
          NO EVENTS · the next {totalCount} months hold steady. Show all months to see each one.
        </div>
      ) : (
        <>
        {mixed && (
          <div role="note" style={{ padding: '6px 0 8px', fontSize: 10, color: L_T.muted, lineHeight: 1.5 }}>
            Loan columns marked ({foreign.join(', ')}) are in that loan&apos;s own currency. TOTAL, EXTRA, INTEREST,
            PRINCIPAL and BALANCE are in {ccy}, converted at the exchange rate saved on your profile.
          </div>
        )}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 760 }}>
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
                  // Next to the date: in the collapsed view it's why the row
                  // is there, and on a phone it's on screen without scrolling.
                  'EVENT',
                  // Type first: two loans from one bank used to show as
                  // two identical "HDFC BAN" columns.
                  ...loanCols.map(
                    (l) =>
                      `${LOAN_SHORT[l.loan_type] ?? 'LOAN'}${l.bank ? ` · ${l.bank.split(' ')[0].slice(0, 6)}` : ''}`.toUpperCase() +
                      // A loan in another currency says so: its column is in it.
                      (loanCurrency(l, plan.user.country) !== ccy ? ` (${loanCurrency(l, plan.user.country)})` : ''),
                  ),
                  ...(mixed ? [`TOTAL (${ccy})`] : []),
                  'EXTRA',
                  'INTEREST',
                  'PRINCIPAL',
                  'BALANCE',
                ].map((h, i) => (
                  <th
                    key={i}
                    title={help[h]}
                    style={{
                      padding: '6px 10px',
                      textAlign: i < 3 ? 'left' : 'right',
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
              {visibleRows.map((r) => (
                <tr
                  key={r.mo}
                  style={{ borderBottom: `1px dashed ${L_T.faint}`, background: r.event ? L_T.highlight : 'transparent' }}
                >
                  <td style={{ padding: '7px 10px' }}>{String(r.mo).padStart(2, '0')}</td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{r.date}</td>
                  <td style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, minWidth: 180, maxWidth: 260, lineHeight: 1.5 }}>
                    {r.event}
                  </td>
                  {loanCols.map((l, idx) => (
                    <td key={idx} style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.perLoan[idx]
                        ? formatCurrencyWhole(Number(r.perLoan[idx]).toFixed(0), loanCurrency(l, plan.user.country))
                        : '—'}
                    </td>
                  ))}
                  {mixed && (
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {fc((totalByMonth.get(r.mo) ?? 0).toFixed(0))}
                    </td>
                  )}
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: L_T.accent, fontWeight: 700 }}>
                    {r.extra > 0 ? fc(r.extra.toFixed(0)) : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: L_T.negative }}>{fc(r.interest.toFixed(0))}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: L_T.positive }}>{fc(r.principal.toFixed(0))}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{fc(r.balance.toFixed(0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ScheduleFooter totals={totals} fc={fc} gstApplies={gstApplies} />
        </>
      )}
      <RateResetAlert plan={plan} />
    </section>
  );
}

/** Principal + interest = cash paid, and principal against today's balance. */
function ScheduleFooter({ totals, fc, gstApplies }: { totals: ReturnType<typeof reconcileSchedule>; fc: (v: string | number) => string; gstApplies: boolean }) {
  return (
    <div role="note" aria-label="How the schedule adds up" style={{ padding: '8px 0', fontSize: 10, color: L_T.muted, lineHeight: 1.6 }}>
      <strong style={{ color: L_T.ink, letterSpacing: '0.06em' }}>OVER THE PLAN · </strong>
      PRINCIPAL {fc(totals.principal.toFixed(0))} + INTEREST {fc(totals.interest.toFixed(0))}
      {gstApplies ? ' (GST ON CARD INTEREST INCLUDED)' : ''} = {fc(totals.cash.toFixed(0))} PAID.{' '}
      {totals.tiesOut
        ? `Principal repaid matches the ${fc(totals.outstanding.toFixed(0))} you owe today.`
        : `Principal repaid differs from the ${fc(totals.outstanding.toFixed(0))} you owe today by ${fc(Math.abs(totals.gap).toFixed(0))}: loans that start later, or a balance the plan doesn't clear.`}{' '}
      A payoff month is more than the balance because that month&apos;s interest is added first.
    </div>
  );
}

/** Days from today to an ISO date, in the user's country. */
function daysUntil(iso: string, today: Date): number {
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86_400_000);
}

/** The soonest floating-rate reset in the next three months. */
function RateResetAlert({ plan }: { plan: PlanData }) {
  const today = getCountryToday(plan.user.country);
  const todayIso = localIsoDate(today);
  const next = plan.user.loans
    .map((l) => ({ loan: l, on: resetDate(l) }))
    .filter((x): x is { loan: LoanPayload; on: string } => isOpenCurrentLoan(x.loan) && x.loan.rate_type === 'floating' && !!x.on && x.on >= todayIso)
    .map((x) => ({ loan: x.loan, on: x.on, days: daysUntil(x.on, today) }))
    .filter((x) => x.days <= 92)
    .sort((a, b) => a.days - b.days)[0];
  if (!next) return null;
  const [y, m, d] = next.on.split('-').map(Number);
  const when = `${d} ${MONTH_NAMES[m - 1].slice(0, 3).toUpperCase()} ${y}`;
  const benchmark = plan.user.country === 'IN' ? 'the RBI repo rate' : 'its index (usually SOFR)';
  return (
    <div
      role="note"
      style={{
        marginTop: 12,
        padding: '12px 14px',
        border: `1px solid ${L_T.ink}`,
        background: L_T.paper,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        flexWrap: 'wrap',
        fontSize: 11,
        lineHeight: 1.6,
      }}
    >
      <span>
        <strong style={{ letterSpacing: '0.06em' }}>
          ⏰ {loanName(next.loan).toUpperCase()} RATE RESETS{' '}
          {next.days === 0 ? 'TODAY' : `IN ${next.days} DAY${next.days === 1 ? '' : 'S'}`} · {when}
        </strong>
        {' '}· The bank sets the new rate from {benchmark}; the plan keeps today&apos;s rate until you add the new one.
      </span>
      <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <LBracket
          accent
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(ADD_LIFE_EVENT, {
                detail: { kind: 'floating_rate_reset', loanIndex: plan.user.loans.indexOf(next.loan) },
              }),
            )
          }
        >
          ADD THE NEW RATE →
        </LBracket>
        <LBracket href="#what-if">WHAT IF RATES MOVE →</LBracket>
      </span>
    </div>
  );
}
