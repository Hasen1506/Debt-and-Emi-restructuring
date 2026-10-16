'use client';

/**
 * Plan's schedule (REDESIGN R3.3): every month of the plan, collapsed to
 * the months something happens — a loan paid off, a rate reset, a pay
 * change, a new loan starting, the end of each year. Below the table, the
 * next floating-rate reset (when it's within three months). The central
 * bank's next decision has its own section (RateDecisions).
 */
import { paymentWords } from '@/lib/terms';
import { useState } from 'react';
import type { PlanData } from './PlanData';
import { formatCurrencyWhole, formatPct, type LoanPayload } from '@/lib/api';
import { getCountryToday, localIsoDate, monthIndexToDate, MONTH_NAMES } from '@/lib/today';
import { owedTodayLine } from '@/lib/owed-today';
import { localTerms } from '@/lib/terms';
import { loanCurrency } from '@/lib/currency';
import { scheduleCsvCells, scheduleCsvFilename, scheduleCsvHeader, type ScheduleCsvRow } from '@/lib/schedule-csv';
import { loanLabel } from '@/lib/loan-types';
import { LBracket, LSectionHeader, L_T } from '@/components/ledger/primitives';
import { loanClears, owedAtStart } from './plan-milestones';
import { isOpenCurrentLoan } from '@/lib/plan-controls';
import { resetDate } from '@/lib/rate-decision';
import { ADD_LIFE_EVENT } from '@/components/lifecycle/LifecycleEventsPanel';
import { GST_RATE_IN } from '@/lib/gst';
import { reconcileSchedule, scheduleColumnHelp } from '@/lib/schedule-reconcile';
import { boundedMoney, gapEvents, gapRateWords, saneCap, scheduleStop, scheduleStopLine } from '@/lib/plan-gap';

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


function csvCell(v: string | number): string {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Every month of the schedule as a CSV file (the table may be collapsed).
 *  Each loan's column is in that loan's currency; the totals are in the
 *  user's, and every header says which. */
function downloadRowsCSV(rows: ScheduleCsvRow[], plan: PlanData, start: ScheduleCsvRow) {
  const { loans, country } = plan.user;
  const ccy = plan.displayCurrency.toLowerCase();
  // UX50 B-33: headers in words, a dated filename, the opening row named.
  const header = scheduleCsvHeader(loans, country, ccy);
  // The first line is what's owed at the start, as on screen.
  // Audit 80+ C19: balances go in their own "owed at start" columns, so a
  // SUM down a loan's paid column adds payments only.
  const lines = [start, ...rows].map((r) => scheduleCsvCells(r, r === start, loans.length).map(csvCell).join(','));
  const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n') + '\n'], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = scheduleCsvFilename(localIsoDate(getCountryToday(country)));
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
    // Short, the schedule's date is "as things stand" (gap borrowed), and
    // says so, so it can't read as a different story from the headline (#16).
    add(m, m === plan.debtFreeMonth ? `★ DEBT-FREE${short ? ' AS THINGS STAND' : ''} · ${what}` : `★ ${what}`);
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
  // Live test #15: say when a short month is borrowed and when it is paid
  // back, so an extra in a later month never appears from nowhere.
  if (plan.gap) {
    const money = (v: number) => formatCurrencyWhole(Math.round(v), plan.displayCurrency);
    for (const [m, e] of gapEvents(plan.gap, money, gapRateWords(plan.gap.rate))) add(m, e);
  }
  const nf = plan.scheduleCut?.notFundableFrom;
  if (nf != null) add(nf, '✕ NOT FUNDABLE FROM HERE · THE GAP CAN’T BE BORROWED');
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
  // Every loan gets a column (a fifth one used to be left out); the table
  // scrolls sideways on a narrow screen.
  const loanCols = plan.user.loans;
  const short = plan.shortfall > 0 || !!plan.futureShortfall;
  const events = scheduleEvents(plan, short);

  const trajByMonth = new Map<number, number>(plan.trajectory.map((p) => [p.month, p.avalanche]));
  const interestByMonth = new Map<number, number | undefined>(plan.trajectory.map((p) => [p.month, p.interest]));

  const allRows: ScheduleCsvRow[] = plan.monthlyPayments.map((row) => {
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
  const owedToday = owedAtStart(plan);
  // The month each loan's last payment goes out: its cell says FINAL, so a
  // small last payment doesn't read as what's owed on it.
  const finalMonth = new Map<number, number>(loanClears(plan).map((c) => [c.index, c.month]));
  const startLabel = (() => {
    const d = monthIndexToDate(1, today);
    return `${MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ${d.getFullYear()}`;
  })();
  const totals = reconcileSchedule(allRows, owedToday);
  const gstApplies = plan.user.country === 'IN' && plan.user.loans.some((l) => l.loan_type === 'credit_card');
  const help: Record<string, string> = {
    ...scheduleColumnHelp(gstApplies, GST_RATE_IN.mul(100).toFixed(0)),
    [`TOTAL (${ccy})`]: 'Everything paid that month (principal + interest), in your currency.',
  };

  // Gap borrowing (grill #38): a column only when the plan ever borrows.
  const gapMonths = plan.gap?.months ?? {};
  const showGap = Object.keys(gapMonths).length > 0;
  if (showGap) {
    help['GAP OWED'] =
      'Short months are paid from your emergency fund, then borrowed on a card; this is what is owed on that borrowing at the month’s end. Spare cash pays it back before any loan gets extra.';
  }
  // Live re-test 2 NEW-2: a plan that never clears stops at the horizon
  // (or before what's owed passes 100x today) and says why, instead of
  // 1,200 months of 30-digit GAP OWED figures. The CSV gets the same rows.
  const cap = saneCap(owedToday);
  const stop = scheduleStop({
    rows: allRows.map((r) => ({ mo: r.mo, balance: r.balance, gapDebt: gapMonths[r.mo]?.debt ?? 0 })),
    owedToday,
    cut: plan.scheduleCut,
  });
  const rows = stop.lastMonth == null ? allRows : allRows.filter((r) => r.mo <= stop.lastMonth!);
  const stopRow = stop.lastMonth != null ? rows.find((r) => r.mo === stop.lastMonth) : undefined;
  // Integration phase 5 (C11): a capped plan stops at its first unfundable
  // month, and the heading and stop line say "not fundable from <month>"
  // (there is no debt-free date: plan.debtFreeMonth is null).
  const notFundableFrom = plan.scheduleCut?.notFundableFrom ?? null;
  const nfLabel = (() => {
    if (notFundableFrom == null) return null;
    const d = monthIndexToDate(notFundableFrom, today);
    return `${MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ${d.getFullYear()}`;
  })();
  const money = (v: number) => fc(v.toFixed(0));
  const cell = (v: number) => boundedMoney(v, cap, money);
  const eventRows = rows.filter((r) => r.event || r.mo === stop.lastMonth);
  const visibleRows = expanded ? rows : eventRows;
  const totalCount = rows.length || plan.trajectory.length;
  // Audit 80+ E13: every column has its own name ("CARD", "CARD" for two
  // cards with no lender was read twice the same); scope="col" below.
  const loanHeads = uniqueLabels(
    loanCols.map(
      (l) =>
        // Type first: two loans from one bank used to show as two
        // identical "HDFC BAN" columns.
        `${LOAN_SHORT[l.loan_type] ?? 'LOAN'}${l.bank ? ` · ${l.bank.split(' ')[0].slice(0, 6)}` : ''}`.toUpperCase() +
        // A loan in another currency says so: its column is in it.
        (loanCurrency(l, plan.user.country) !== ccy ? ` (${loanCurrency(l, plan.user.country)})` : ''),
    ),
  );
  const headers = [
    'MO',
    'DATE',
    // Next to the date: in the collapsed view it's why the row is there.
    'EVENT',
    ...loanHeads,
    ...(mixed ? [`TOTAL (${ccy})`] : []),
    'EXTRA',
    'INTEREST',
    'PRINCIPAL',
    'BALANCE',
    ...(showGap ? ['GAP OWED'] : []),
  ];

  return (
    <section id="schedule" style={{ scrollMarginTop: 16 }}>
      <LSectionHeader
        right={
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '14px 12px' }}>
            <LBracket
              onClick={() =>
                downloadRowsCSV(rows, plan, {
                  mo: 0,
                  date: startLabel,
                  // Each loan's balance now (its column is payments below).
                  perLoan: Object.fromEntries(
                    loanCols.map((l, i) => [i, (l.planned_effective_month ?? 1) > 1 ? '0' : String(Number(l.outstanding) || 0)]),
                  ),
                  extra: 0,
                  interest: 0,
                  principal: 0,
                  balance: owedToday,
                  event: 'OWED AT THE START',
                })
              }
            >
              CSV
            </LBracket>
            <LBracket onClick={() => window.print()}>PRINT</LBracket>
            <LBracket onClick={() => setExpanded((v) => !v)}>
              {expanded ? '↑ EVENTS ONLY' : `↓ ALL ${totalCount} MONTHS`}
            </LBracket>
          </span>
        }
      >
        MONTH BY MONTH{short ? ' · AS THINGS STAND' : ''}{stopRow ? (nfLabel ? ` · NOT FUNDABLE FROM ${nfLabel}` : ' · NEVER CLEARS') : ''} ·{' '}
        {expanded ? `${totalCount} MO` : `${eventRows.length} EVENT${eventRows.length === 1 ? '' : 'S'}`}
      </LSectionHeader>
      {visibleRows.length === 0 ? (
        <div style={{ padding: '14px 0', fontSize: 'var(--fs-small)', color: L_T.muted }}>
          NO EVENTS · the next {totalCount} months hold steady. Show all months to see each one.
        </div>
      ) : (
        <>
        <p style={{ margin: '0 0 8px', fontSize: 'var(--fs-dense)', lineHeight: 1.6, color: L_T.inkSoft }}>
          The first row is what you owe on each loan at the start of {startLabel.charAt(0) + startLabel.slice(1, 3).toLowerCase()}, before
          this month&apos;s payments. Every row after it is what you pay that month: each loan&apos;s
          column is its {paymentWords(plan.user.country).one} or minimum plus any extra, not what&apos;s left on it. BALANCE is what&apos;s left on all of them
          at the month&apos;s end.
        </p>
        {mixed && (
          <div role="note" style={{ padding: '6px 0 8px', fontSize: 'var(--fs-small)', color: L_T.muted, lineHeight: 1.5 }}>
            Loan columns marked ({foreign.join(', ')}) are in that loan&apos;s own currency. TOTAL, EXTRA, INTEREST,
            PRINCIPAL and BALANCE are in {ccy}, converted at the exchange rate saved on your profile.
          </div>
        )}
        {/* Audit 80+ B18: up to 820px the months are cards, one per month,
            with each loan's split behind a tap; the full table (and the
            CSV and print) from there up. No sideways swipe. */}
        <style>{`.rd-month-cards{display:none}
@media (max-width: 820px){.rd-month-table{display:none !important}.rd-month-cards{display:block}}
@media print{.rd-month-table{display:block !important}.rd-month-cards{display:none !important}}`}</style>
        <MonthCards
          rows={visibleRows}
          startLabel={startLabel}
          owedToday={owedToday}
          loans={loanCols}
          loanHeads={loanHeads}
          country={plan.user.country}
          fc={fc}
          cell={cell}
          totalByMonth={totalByMonth}
          finalMonth={finalMonth}
          gapMonths={gapMonths}
        />
        <div
          className="rd-month-table"
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-table)', minWidth: 760 + Math.max(0, loanCols.length - 4) * 90 }}>
            <caption className="sr-only">
              Month by month: what you pay on each loan, the extra, interest, principal and what is left at each month&apos;s end
            </caption>
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
                {headers.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    title={help[h]}
                    style={{
                      padding: '6px 10px',
                      textAlign: i < 3 ? 'left' : 'right',
                      fontWeight: 700,
                      fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
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
              {/* Where the plan starts: what each loan owes before this
                  month's payments. The rows below are what's paid. */}
              <tr style={{ borderBottom: `1px solid ${L_T.ink}` }}>
                <td style={{ padding: '7px 10px', color: L_T.muted }}>—</td>
                <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{startLabel}</td>
                <td style={{ padding: '7px 10px', fontSize: 'var(--fs-small)', fontWeight: 700, lineHeight: 1.5 }}>OWED AT THE START</td>
                {loanCols.map((l, idx) => {
                  const owed = Number(l.outstanding) || 0;
                  const later = (l.planned_effective_month ?? 1) > 1;
                  return (
                    <td key={idx} style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>
                      {later || owed <= 0 ? '—' : formatCurrencyWhole(owed.toFixed(0), loanCurrency(l, plan.user.country))}
                    </td>
                  );
                })}
                {mixed && <td />}
                <td colSpan={3} />
                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{fc(owedToday.toFixed(0))}</td>
                {showGap && <td style={{ padding: '7px 10px', textAlign: 'right' }}>—</td>}
              </tr>
              {visibleRows.map((r) => (
                <tr
                  key={r.mo}
                  // UX50 B-16: in the events-only view every row is an event, so
                  // none is highlighted; in the full view the events stand out.
                  style={{ borderBottom: `1px dashed ${L_T.faint}`, background: expanded && r.event ? L_T.highlight : 'transparent' }}
                >
                  <td style={{ padding: '7px 10px' }}>{String(r.mo).padStart(2, '0')}</td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{r.date}</td>
                  <td style={{ padding: '7px 10px', fontSize: 'var(--fs-small)', fontWeight: 700, minWidth: 180, maxWidth: 260, lineHeight: 1.5 }}>
                    {r.event}
                  </td>
                  {loanCols.map((l, idx) => (
                    <td key={idx} style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.perLoan[idx]
                        ? formatCurrencyWhole(Number(r.perLoan[idx]).toFixed(0), loanCurrency(l, plan.user.country))
                        : '—'}
                      {r.perLoan[idx] && finalMonth.get(idx) === r.mo ? (
                        <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', color: L_T.positive }}>FINAL</div>
                      ) : null}
                    </td>
                  ))}
                  {mixed && (
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {fc((totalByMonth.get(r.mo) ?? 0).toFixed(0))}
                    </td>
                  )}
                  {/* Audit 80+ B19: planned extra and interest are ink, not
                      alarm colours; red is kept for short months and gap debt. */}
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: L_T.ink, fontWeight: 700 }}>
                    {r.extra > 0 ? fc(r.extra.toFixed(0)) : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: L_T.ink }}>{cell(r.interest)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: L_T.positive }}>{cell(r.principal)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{cell(r.balance)}</td>
                  {showGap && (
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: L_T.negative, whiteSpace: 'nowrap' }}>
                      {gapMonths[r.mo]?.debt ? cell(gapMonths[r.mo].debt) : '—'}
                      {gapMonths[r.mo]?.repaid ? (
                        <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: L_T.positive }}>
                          {cell(gapMonths[r.mo].repaid)} REPAID
                        </div>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stopRow ? (
          <div role="note" data-testid="schedule-stop" style={{ padding: '8px 0', fontSize: 'var(--fs-small)', lineHeight: 1.6, color: L_T.negative, fontWeight: 700 }}>
            {nfLabel ? scheduleStopLine(false, nfLabel, true) : scheduleStopLine(stop.growsWithoutLimit, stopRow.date)}
          </div>
        ) : (
          <ScheduleFooter
            totals={totals}
            fc={fc}
            gstApplies={gstApplies}
            gapReason={scheduleGapReason(plan.runArgs?.user.fx_drift_annualized)}
            owedLine={(() => {
              const line = owedTodayLine(plan.owedToday, MONTH_NAMES[getCountryToday(plan.user.country).getMonth()], (v) => fc(Math.round(v)));
              return line ? localTerms(line, plan.user.country) : null;
            })()}
          />
        )}
        </>
      )}
      <RateResetAlert plan={plan} />
    </section>
  );
}

/** "CARD", "CARD" → "CARD 1", "CARD 2"; unique labels are left alone. */
export function uniqueLabels(labels: string[]): string[] {
  const count = new Map<string, number>();
  for (const l of labels) count.set(l, (count.get(l) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((l) => {
    if ((count.get(l) ?? 0) < 2) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return `${l} ${n}`;
  });
}

/** Audit 80+ B18: the schedule on a phone, one card per month: the date and
 *  what happens, then paid, interest and what's left; each loan's share
 *  behind a tap. Same rows as the table (events only, or every month). */
function MonthCards({
  rows,
  startLabel,
  owedToday,
  loans,
  loanHeads,
  country,
  fc,
  cell,
  totalByMonth,
  finalMonth,
  gapMonths,
}: {
  rows: ScheduleCsvRow[];
  startLabel: string;
  owedToday: number;
  loans: LoanPayload[];
  loanHeads: string[];
  country: PlanData['user']['country'];
  fc: (v: string | number) => string;
  cell: (v: number) => string;
  totalByMonth: Map<number, number>;
  finalMonth: Map<number, number>;
  gapMonths: Record<number, { debt?: number; repaid?: number }>;
}) {
  const sentence = (d: string) => d.charAt(0) + d.slice(1).toLowerCase();
  const term: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-label)', letterSpacing: '0.08em', textTransform: 'uppercase', color: L_T.muted };
  const fig: React.CSSProperties = { margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-table)', fontWeight: 700, color: L_T.ink };
  return (
    <ol className="rd-month-cards" aria-label="Month by month" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      <li style={{ padding: '10px 0', borderTop: `2px solid ${L_T.ink}`, borderBottom: `1px solid ${L_T.ink}` }}>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-body)', fontWeight: 600 }}>Owed at the start of {sentence(startLabel)}</h3>
        <p style={{ ...fig, fontSize: 'var(--fs-body)', marginTop: 2 }}>{fc(Math.round(owedToday))}</p>
      </li>
      {rows.map((r) => {
        const paid = totalByMonth.get(r.mo) ?? r.interest + r.principal;
        const shares = loans
          .map((l, i) => ({ name: loanHeads[i], v: r.perLoan[i], ccy: loanCurrency(l, country), final: finalMonth.get(i) === r.mo }))
          .filter((x) => x.v && Number(x.v) > 0);
        const gap = gapMonths[r.mo];
        return (
          <li key={r.mo} data-testid="month-card" style={{ padding: '10px 0', borderBottom: `1px dashed ${L_T.faint}` }}>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-body)', fontWeight: 600 }}>
              {sentence(r.date)} <span style={{ color: L_T.muted, fontWeight: 400, fontSize: 'var(--fs-small)' }}>· month {r.mo}</span>
            </h3>
            {r.event && <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-small)', fontWeight: 700, lineHeight: 1.45 }}>{r.event}</p>}
            <dl style={{ margin: '6px 0 0', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <div>
                <dt style={term}>Paid</dt>
                <dd style={fig}>{fc(Math.round(paid))}</dd>
              </div>
              <div>
                <dt style={term}>Interest</dt>
                <dd style={fig}>{cell(r.interest)}</dd>
              </div>
              <div>
                <dt style={term}>Left</dt>
                <dd style={fig}>{cell(r.balance)}</dd>
              </div>
            </dl>
            {(shares.length > 0 || r.extra > 0 || gap?.debt) && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-small)', color: L_T.inkSoft }}>Each loan{r.extra > 0 ? ` · ${fc(Math.round(r.extra))} extra` : ''}</summary>
                <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-table)' }}>
                  {shares.map((x) => (
                    <li key={x.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>{x.name}</span>
                      <span>
                        {formatCurrencyWhole(Math.round(Number(x.v)), x.ccy)}
                        {x.final ? <span style={{ color: L_T.positive }}> · final</span> : null}
                      </span>
                    </li>
                  ))}
                  {gap?.debt ? (
                    <li style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: L_T.negative }}>
                      <span>Gap owed</span>
                      <span>{cell(gap.debt)}</span>
                    </li>
                  ) : null}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Principal + interest = cash paid, and principal against today's balance. */
/** UX walkthrough fix 14: why principal repaid differs from what's owed. An
 *  NRI's rupee loan shrinks in dollars as the plan assumes the rupee slides;
 *  that is the gap, not "a balance the plan doesn't clear". */
export function scheduleGapReason(drift: Record<string, string> | undefined | null): string {
  const slide = Object.entries(drift ?? {}).filter(([, r]) => Number(r) > 0);
  if (slide.length === 0) return "loans that start later, or a balance the plan doesn't clear";
  const [ccy, r] = slide[0];
  const name = ccy === 'INR' ? 'rupee' : ccy;
  return `in your currency, the ${name} loan's balance falls as the plan assumes the ${name} weakens ${formatPct(r, 1).replace(/\.0%$/, '%')} a year`;
}

function ScheduleFooter({ totals, fc, gstApplies, owedLine, gapReason = "loans that start later, or a balance the plan doesn't clear" }: { totals: ReturnType<typeof reconcileSchedule>; fc: (v: string | number) => string; gstApplies: boolean; owedLine?: string | null; gapReason?: string }) {
  // UX walkthrough fix 4: with EMIs already paid this month, the schedule
  // starts before them; say so beside what you owe today (engine/owed_today).
  const owed = owedLine ? 'owed at the start of the plan' : 'you owe today';
  return (
    <div role="note" aria-label="How the schedule adds up" style={{ padding: '8px 0', fontSize: 'var(--fs-small)', color: L_T.muted, lineHeight: 1.6 }}>
      <strong style={{ color: L_T.ink, letterSpacing: '0.06em' }}>OVER THE PLAN · </strong>
      PRINCIPAL {fc(totals.principal.toFixed(0))} + INTEREST {fc(totals.interest.toFixed(0))}
      {gstApplies ? ' (GST ON CARD INTEREST INCLUDED)' : ''} = {fc(totals.cash.toFixed(0))} PAID.{' '}
      {totals.tiesOut
        ? `Principal repaid matches the ${fc(totals.outstanding.toFixed(0))} ${owed}.`
        : `Principal repaid differs from the ${fc(totals.outstanding.toFixed(0))} ${owed} by ${fc(Math.abs(totals.gap).toFixed(0))}: ${gapReason}.`}{' '}
      {owedLine ? <span data-testid="owed-today-line">{owedLine} </span> : null}
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
        fontSize: 'var(--fs-small)',
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
