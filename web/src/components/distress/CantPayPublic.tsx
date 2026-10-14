'use client';

/**
 * Can't pay, signed out (Audit 80 A17 / B3 / B12). The founder's rule is
 * sign-in before value, with Loan Check as the exception; this page is the
 * second exception for the same reason: someone being called by a recovery
 * agent at 9 pm won't do an email code and three Setup steps to read their
 * rights. Everything here is general (no profile): the rules, a blank
 * hardship letter and, in India, a recovery-agent complaint. What to protect
 * first *with your own loans* still needs sign-in, and says so.
 *
 * Nothing typed here is sent or saved: the letters are built in the browser.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { LShell, LSectionHeader, LBracket, L_T } from '@/components/ledger/primitives';
import { formatCurrencyWhole } from '@/lib/api';
import type { LoanType } from '@/lib/api';
import { TIER_REASON, TRIAGE_RULES, TRIAGE_VERIFIED_ON, US_COLLECTOR_RULE } from '@/lib/distress-triage';
import { LetterSection, Rule, type Line } from './CantPay';
import { AgentComplaintSection } from './AgentComplaint';

type C = 'IN' | 'US';

/** Kinds offered in the blank letter, in each country's words. */
export const PUBLIC_LETTER_KINDS: Record<C, Array<{ type: LoanType; label: string }>> = {
  IN: [
    { type: 'personal_loan', label: 'Personal loan' },
    { type: 'credit_card', label: 'Credit card' },
    { type: 'home_loan', label: 'Home loan' },
    { type: 'auto_loan', label: 'Car loan' },
    { type: 'education_loan', label: 'Education loan' },
    { type: 'gold_loan', label: 'Gold loan' },
  ],
  US: [
    { type: 'credit_card', label: 'Credit card' },
    { type: 'personal_loan', label: 'Personal loan' },
    { type: 'auto_loan', label: 'Auto loan' },
    { type: 'home_loan', label: 'Mortgage' },
    { type: 'education_loan', label: 'Private student loan' },
  ],
};

/** The general protect-first order, before any loan is known. */
export const PUBLIC_PROTECT: Record<C, string[]> = {
  IN: [TIER_REASON.secured, TIER_REASON.card_minimum, TIER_REASON.unsecured],
  US: [
    'Secured first: your mortgage, rent and car payment. The lender can take the home or car if these go unpaid.',
    'Then every card minimum, paid by the due date. A payment 30 or more days late can be reported to the credit bureaus, and a late fee is charged.',
    'Unsecured loans next. If something has to wait, it is safer here, but call the lender before the due date and ask for its hardship program.',
  ],
};

function readCountryCookie(): C {
  if (typeof document === 'undefined') return 'IN';
  return /(?:^|; )rd_country=US(?:;|$)/.test(document.cookie) ? 'US' : 'IN';
}

const toggleStyle = (on: boolean): CSSProperties => ({
  background: on ? L_T.ink : 'transparent',
  color: on ? 'var(--canvas, #fff)' : L_T.ink,
  border: `1px solid ${L_T.ink}`,
  padding: '6px 12px',
  font: 'inherit',
  fontSize: 'var(--fs-dense)',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: 32,
});

export function CantPayPublic() {
  const [country, setCountry] = useState<C>('IN');
  useEffect(() => setCountry(readCountryCookie()), []);
  const [kind, setKind] = useState<LoanType>('personal_loan');
  const kinds = PUBLIC_LETTER_KINDS[country];
  const k = kinds.find((x) => x.type === kind) ?? kinds[0];
  const line: Line = {
    key: k.type,
    label: k.label,
    loan_type: k.type,
    required: 0,
    ratePct: 0,
    floating: false,
    bank: '',
    tier: 'unsecured',
    reason: '',
    covered: 'none',
    pay: 0,
    short: 0,
  };
  const ccy = country === 'IN' ? 'INR' : 'USD';
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), ccy);
  const isIN = country === 'IN';
  const signIn = '/login?next=%2Fcant-pay';
  return (
    <LShell>
      <div style={{ padding: '24px 0 48px', display: 'flex', flexDirection: 'column', gap: 28, width: '100%' }} data-testid="cp-public">
        <section aria-labelledby="cp-head">
          <h1 id="cp-head" style={{ fontSize: 20, margin: 0, letterSpacing: '0.02em' }}>
            CAN&apos;T PAY EVERYTHING THIS MONTH?
          </h1>
          <p style={{ fontSize: 'var(--fs-body)', lineHeight: 1.6, marginTop: 8 }}>
            No sign-in needed. What to pay first, a letter to your lender and your rights. Nothing you type here is
            sent or saved.
          </p>
          <div role="group" aria-label="Whose rules" style={{ display: 'flex', gap: 0, marginTop: 10 }}>
            <button type="button" aria-pressed={isIN} style={toggleStyle(isIN)} onClick={() => { setCountry('IN'); setKind('personal_loan'); }} data-testid="cp-country-in">India</button>
            <button type="button" aria-pressed={!isIN} style={toggleStyle(!isIN)} onClick={() => { setCountry('US'); setKind('credit_card'); }} data-testid="cp-country-us">USA</button>
          </div>
        </section>

        <section aria-labelledby="cp-protect" data-testid="cp-protect">
          <LSectionHeader step={1}>
            <span id="cp-protect">WHAT TO PROTECT FIRST</span>
          </LSectionHeader>
          <ol style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
            {PUBLIC_PROTECT[country].map((t) => <li key={t}>{t}</li>)}
          </ol>
          <p style={{ fontSize: 'var(--fs-body)', lineHeight: 1.6, marginTop: 12 }} data-testid="cp-public-signin">
            Want this worked out for <em>your</em> loans, with what each one gets from the money you have this month?{' '}
            <LBracket href={signIn}>SIGN IN FREE →</LBracket>
          </p>
        </section>

        <LetterSection
          lines={[line]}
          name=""
          fc={fc}
          country={country}
          step={2}
          loanPicker={
            <label style={{ display: 'block', marginBottom: 10 }}>
              <span style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', color: L_T.muted, display: 'block', marginBottom: 4 }}>Kind of loan</span>
              <select value={k.type} onChange={(e) => setKind(e.target.value as LoanType)} data-testid="cp-letter-kind">
                {kinds.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
              </select>
            </label>
          }
        />

        {isIN ? (
          <>
            <AgentComplaintSection step={3} />
            <section aria-labelledby="cp-rights" data-testid="cp-rights">
              <LSectionHeader step={4}>
                <span id="cp-rights">YOUR RIGHTS WITH RECOVERY AGENTS</span>
              </LSectionHeader>
              <Rule r={TRIAGE_RULES.recovery} />
              <Rule r={TRIAGE_RULES.recovery_2027} />
              <p style={{ fontSize: 'var(--fs-dense)', color: L_T.muted, lineHeight: 1.7 }}>
                If an agent breaks these rules: write to the lender&apos;s grievance officer with dates and times (the
                complaint above). If it isn&apos;t fixed in 30 days, the RBI Ombudsman complaint route (cms.rbi.org.in)
                is free.
              </p>
            </section>
            <section aria-labelledby="cp-miss" data-testid="cp-miss-rules">
              <LSectionHeader step={5}>
                <span id="cp-miss">WHAT A MISSED PAYMENT COSTS</span>
              </LSectionHeader>
              <Rule r={TRIAGE_RULES.penal} />
              <Rule r={TRIAGE_RULES.card_past_due} />
              <Rule r={TRIAGE_RULES.sma} />
            </section>
            <section aria-labelledby="cp-settle" data-testid="cp-settle">
              <LSectionHeader step={6}>
                <span id="cp-settle">SETTLEMENT VS YOUR CREDIT SCORE</span>
              </LSectionHeader>
              <Rule r={TRIAGE_RULES.settlement} />
              <Rule r={TRIAGE_RULES.restructuring} />
              <p style={{ fontSize: 'var(--fs-dense)', color: L_T.muted, lineHeight: 1.7 }}>
                Debt-settlement firms usually ask you to stop paying and save instead, then negotiate. That pushes every
                account into default first. RightDue earns nothing from lenders or settlement firms.
              </p>
            </section>
          </>
        ) : (
          <section aria-labelledby="cp-rights" data-testid="cp-rights">
            <LSectionHeader step={3}>
              <span id="cp-rights">YOUR RIGHTS WITH DEBT COLLECTORS</span>
            </LSectionHeader>
            <Rule r={US_COLLECTOR_RULE} />
          </section>
        )}

        <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>
          {isIN ? <>Rules checked against the RBI text on {TRIAGE_VERIFIED_ON}.</> : <>Collector rules from the CFPB&apos;s Regulation F, read 14 Oct 2026.</>}{' '}
          A calculator and a draft, not legal advice.
        </p>
      </div>
    </LShell>
  );
}
