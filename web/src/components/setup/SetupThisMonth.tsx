/**
 * Setup step 3's "This month" box, first on the step (UX walkthrough fix 1
 * and 11: what to do this month comes before the date and any offer).
 * Short of cash it gives the order to pay in and links to what to say to
 * the bank (fix 8), instead of "Pay every EMI and card minimum".
 */
import Decimal from 'decimal.js';
import type { Country, LoanPayload, SimulateResponse, UserPayload } from '@/lib/api';
import { loanCurrency, type CurrencyCode } from '@/lib/currency';
import { loanName } from '@/lib/loan-types';
import { paymentWords } from '@/lib/r7-inputs';
import { setupExtraMove, setupPayMonth } from '@/lib/setup-this-month';
import { shortPriority, shortPriorityText } from '@/lib/short-priority';
import { LBracket, L_T, lStrip } from '@/components/ledger/primitives';

export function SetupThisMonth({
  plan,
  minimums,
  planUser,
  loans,
  country,
  money,
}: {
  plan: SimulateResponse;
  minimums: SimulateResponse;
  planUser: UserPayload;
  /** The loans as they'll be saved (named: "Card 1", "Card 2"). */
  loans: LoanPayload[];
  country: Country;
  money: (v: Decimal | string, ccy?: CurrencyCode) => string;
}) {
  const shortfall = Number(plan.shortfall || 0);
  const every = country === 'US' ? 'Make every payment' : `Pay every ${paymentWords(country).one}`;
  let body;
  if (shortfall > 0.5) {
    const lines = shortPriority(setupPayMonth(plan, minimums, { ...planUser, loans }), loans, shortfall);
    body = (
      <div data-testid="setup-this-month-short" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {shortPriorityText(lines, shortfall, (v) => money(String(Math.round(v))), country)}{' '}
        <LBracket href="/cant-pay">WHAT TO SAY TO THE {country === 'US' ? 'LENDER' : 'BANK'} →</LBracket>
      </div>
    );
  } else {
    const move = setupExtraMove(plan, minimums, planUser);
    const moveLoan = move ? loans[move.index] : null;
    body =
      move && moveLoan ? (
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>
          {every} and card minimum, then put{' '}
          <strong>{money(String(move.extra), loanCurrency(moveLoan, country))}</strong> extra on{' '}
          <strong>{moveLoan.nickname ? loanName(moveLoan) : `your ${loanName(moveLoan)}`}</strong>.
        </div>
      ) : (
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>
          {every} and card minimum. Nothing is left over for extra payments this month.
        </div>
      );
  }
  return (
    <div
      data-testid="setup-this-month"
      style={{ padding: '12px 14px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}`, ...lStrip(shortfall > 0.5 ? 'negative' : 'accent') }}
    >
      <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', color: L_T.muted, marginBottom: 4 }}>THIS MONTH</div>
      {body}
    </div>
  );
}
