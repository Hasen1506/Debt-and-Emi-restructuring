/**
 * Round 3 part B (#13): Home's note for a loan marked behind on payments or
 * with a collection agency (no "pay the minimum" for it), and for a settled
 * one (closed, out of the plan, with what it does to the credit report).
 * Conservative: what to do and the borrower's rights, no settlement offers.
 * The rights text is a draft pending legal review (lib/legal-review).
 */
import type { LoanPayload } from '@/lib/api';
import { LBracket, L_T } from '@/components/ledger/primitives';
import { DraftLegalMarker } from '@/components/legal/DraftLegalMarker';
import { loanLabel } from '@/lib/loan-types';
import { SETTLED_NOTE, debtStatus, helpLines, isSettled, needsHelp, rightsNote } from '@/lib/loan-status';
import { US_LETTERS_PATH } from '@/lib/us-letters';
import dynamic from 'next/dynamic';
const CatchUpCheck = dynamic(() => import('./CatchUpCheck').then((m) => m.CatchUpCheck)); // only for a behind loan

const STATUS_WORDS = { behind: 'BEHIND ON PAYMENTS', collections: 'WITH A COLLECTION AGENCY' } as const;
const body = { fontSize: 'var(--fs-dense)', lineHeight: 1.55, margin: '4px 0' } as const;

export function HomeDebtHelp({ loans, country }: { loans: LoanPayload[]; country: 'IN' | 'US' }) {
  const help = loans.filter(needsHelp);
  const settled = loans.filter(isSettled);
  if (!help.length && !settled.length) return null;
  const collections = help.some((l) => debtStatus(l) === 'collections');
  return (
    <section aria-labelledby="debt-help-head" data-testid="home-debt-help"
      style={{ padding: '14px 0', borderBottom: `1px solid ${L_T.ruleSoft}` }}>
      {help.length > 0 && (
        <>
          <h2 id="debt-help-head" style={{ fontSize: 'var(--fs-label)', letterSpacing: '0.1em', margin: '0 0 6px' }}>
            {help.length === 1 ? 'ONE LOAN NEEDS A DIFFERENT STEP' : `${help.length} LOANS NEED A DIFFERENT STEP`}
          </h2>
          {help.map((l) => (
            <div key={l.id ?? loanLabel(l)} data-testid="home-debt-help-loan" style={{ marginBottom: 8 }}>
              <p style={{ ...body, fontWeight: 700 }}>
                {loanLabel(l)} · {STATUS_WORDS[debtStatus(l) as keyof typeof STATUS_WORDS]}
              </p>
              <ul style={{ ...body, paddingLeft: 18 }}>
                {helpLines(l, country).map((t) => <li key={t}>{t}</li>)}
              </ul>
              {debtStatus(l) === 'behind' && (
                <CatchUpCheck loan={l} index={loans.indexOf(l)} name={loanLabel(l)} country={country} />
              )}
              {country === 'US' && debtStatus(l) === 'collections' && (
                <p style={body}>
                  <LBracket href={`${US_LETTERS_PATH}?kind=debt_validation`}>ASK THEM TO PROVE THE DEBT</LBracket>{' '}
                  <LBracket href={`${US_LETTERS_PATH}?kind=cease_contact`}>TELL THEM TO STOP CONTACTING YOU</LBracket>
                  {l.loan_type === 'medical_loan' && <>{' '}<LBracket href={`${US_LETTERS_PATH}?kind=medical_bill`}>MEDICAL BILL LETTER</LBracket></>}
                </p>
              )}
            </div>
          ))}
          <DraftLegalMarker id="debt-rights" />
          <p style={{ ...body, color: L_T.muted }} data-testid="home-debt-rights">{rightsNote(country)}</p>
          <p style={body}>
            <LBracket active href="/cant-pay">WHAT TO DO IF YOU CAN&apos;T PAY</LBracket>
            {collections && country === 'IN' && <>{' '}<LBracket href="/cant-pay#cp-rights">YOUR RIGHTS WITH RECOVERY AGENTS</LBracket></>}
          </p>
        </>
      )}
      {settled.map((l) => (
        <p key={l.id ?? loanLabel(l)} style={{ ...body, color: L_T.muted }} data-testid="home-settled">
          <strong style={{ color: L_T.ink }}>{loanLabel(l)} · SETTLED.</strong> {SETTLED_NOTE[country]}
        </p>
      ))}
    </section>
  );
}
