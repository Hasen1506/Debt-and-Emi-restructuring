'use client';

/**
 * US-only loan fields on the Profile loan card (sprint G3; grill #33, #34):
 * - Student loans: federal or private, and a forgiveness track (PSLF / IDR)
 *   that holds extra payments off the loan, with the 2026 rules in plain words.
 * - Mortgages: PMI or FHA MIP, the home's original value, when PMI can end and
 *   what paying down to 80% now is worth, and the escrow note.
 * Rules and sources: lib/us-loans.ts (engine/us_loans.py).
 */
import type { LoanPayload } from '@/lib/api';
import { Field, Select } from '@/components/ToolPrimitives';
import {
  ESCROW_NOTE, US_SOURCES, US_STATES, forgivenessPrepayBlock, pmiAnalysis, stateMortgageTreatment,
  studentLoanExplainer,
} from '@/lib/us-loans';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function UsLoanFields({
  loan,
  onChange,
}: {
  loan: LoanPayload;
  onChange: (patch: Partial<LoanPayload>) => void;
}) {
  if (loan.loan_type === 'education_loan') return <StudentLoanFields loan={loan} onChange={onChange} />;
  if (loan.loan_type === 'home_loan') return <MortgageFields loan={loan} onChange={onChange} />;
  return null;
}

function StudentLoanFields({ loan, onChange }: { loan: LoanPayload; onChange: (p: Partial<LoanPayload>) => void }) {
  const kind = (loan.student_loan_kind ?? '') as '' | 'federal' | 'private';
  const track = (loan.forgiveness_track ?? '') as '' | 'pslf' | 'idr' | 'none' | 'unsure';
  const blocked = forgivenessPrepayBlock(loan, 'US');
  return (
    <div data-testid="us-student-loan" style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
      <Select<'' | 'federal' | 'private'>
        label="Federal or private student loan?"
        value={kind}
        onChange={(v) =>
          onChange(v === 'private'
            ? { student_loan_kind: 'private', forgiveness_track: undefined }
            : { student_loan_kind: v || undefined })
        }
        options={[
          { value: '', label: 'Not sure (treated as federal)' },
          { value: 'federal', label: 'Federal (Direct, FFEL, Perkins)' },
          { value: 'private', label: 'Private (a bank or lender)' },
        ]}
        hint="Federal loans are listed in your studentaid.gov account."
      />
      {kind !== 'private' && (
        <Select<'' | 'pslf' | 'idr' | 'none' | 'unsure'>
          label="Heading for forgiveness?"
          value={track === 'unsure' ? '' : track}
          onChange={(v) => onChange({ forgiveness_track: v || undefined })}
          options={[
            // E7 (audit 80): no answer holds extra off the loan until the user says.
            { value: '', label: 'Not sure yet (extra held off until you say)' },
            { value: 'none', label: 'No, paying it off' },
            { value: 'pslf', label: 'Public Service Loan Forgiveness (PSLF)' },
            { value: 'idr', label: 'Income-driven plan forgiveness (RAP, IBR, ...)' },
          ]}
          info={
            <>
              <strong>PSLF</strong> (Public Service Loan Forgiveness): what&apos;s left is forgiven after 120
              qualifying payments while you work full time for a government or not-for-profit employer.{' '}
              <strong>IDR</strong> (income-driven repayment): your payment follows your income, and what&apos;s
              left is forgiven after 20 to 30 years. On either, paying extra only lowers what would be forgiven.{' '}
              <a href={US_SOURCES.pslf} target="_blank" rel="noreferrer">studentaid.gov</a>
            </>
          }
        />
      )}
      <ul className="muted" style={{ fontSize: 11, lineHeight: 1.55, margin: 0, paddingLeft: 16 }}>
        {studentLoanExplainer(loan).map((t) => (
          <li key={t}>{t}</li>
        ))}
        {kind !== 'private' && (
          <li>
            We never suggest moving a federal loan to a private lender: that ends its income-driven plans,
            forgiveness and federal deferment (
            <a href={US_SOURCES.refi} target="_blank" rel="noreferrer">CFPB</a>).
          </li>
        )}
      </ul>
      {blocked && (
        <p data-testid="forgiveness-hold" style={{ fontSize: 12, margin: 0 }}>
          This loan {blocked}.
        </p>
      )}
    </div>
  );
}

function MortgageFields({ loan, onChange }: { loan: LoanPayload; onChange: (p: Partial<LoanPayload>) => void }) {
  const mi = (loan.mortgage_insurance_kind ?? 'pmi') as 'pmi' | 'fha_mip';
  const a = pmiAnalysis(loan);
  return (
    <div data-testid="us-mortgage" style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
      <Field
        label="Mortgage insurance a month (PMI or FHA MIP)"
        kind="money"
        currency="USD"
        value={loan.pmi_monthly ?? ''}
        onChange={(v) => onChange({ pmi_monthly: v || undefined })}
        placeholder="0"
        hint="On your mortgage statement or escrow analysis; 0 if you put 20% or more down"
      />
      {Number(loan.pmi_monthly || 0) > 0 && (
        <>
          <Select<'pmi' | 'fha_mip'>
            label="Kind of mortgage insurance"
            value={mi}
            onChange={(v) => onChange({ mortgage_insurance_kind: v })}
            options={[
              { value: 'pmi', label: 'PMI (private mortgage insurance, conventional loan)' },
              { value: 'fha_mip', label: 'FHA MIP (FHA loan)' },
            ]}
          />
          {mi === 'pmi' ? (
            <Field
              label="Home's original value"
              kind="money"
              currency="USD"
              value={loan.original_home_value ?? ''}
              onChange={(v) => onChange({ original_home_value: v || undefined })}
              hint="The lower of the price you paid and the appraisal then (the appraisal at refinancing, if you refinanced)"
            />
          ) : (
            <Field
              label="Months of FHA MIP left"
              kind="integer"
              value={loan.pmi_months_remaining != null ? String(loan.pmi_months_remaining) : ''}
              onChange={(v) => onChange({ pmi_months_remaining: v === '' ? undefined : Number(v) })}
              hint="Blank: for the life of the loan"
            />
          )}
        </>
      )}
      {a && (
        <div data-testid="pmi-analysis" className="muted" style={{ fontSize: 11, lineHeight: 1.55 }}>
          {a.requestBalance && a.extraToRequestNow && a.extraToRequestNow.gt(0) && (
            <p style={{ margin: '0 0 4px', color: 'var(--ink)' }}>
              PMI ({usd(a.annual.toNumber())} a year) can end once you owe {usd(a.requestBalance.toNumber())},
              80% of the original value.
              {a.monthsToRequest != null && <> On your current payment that&apos;s in about {a.monthsToRequest} months.</>}{' '}
              Paying {usd(a.extraToRequestNow.toNumber())} extra gets you there now
              {a.pmiReturnPct && (
                <>
                  : while it makes the difference, that saves {usd(a.annual.toNumber())} a year, about{' '}
                  {(a.pmiReturnPct.toNumber() * 100).toFixed(1)}% of the extra, on top of the mortgage interest
                  it also saves
                </>
              )}
              .
            </p>
          )}
          {a.requestBalance && a.extraToRequestNow && a.extraToRequestNow.lte(0) && (
            <p style={{ margin: '0 0 4px', color: 'var(--ink)' }}>
              You already owe 80% or less of the original value: you can ask your servicer to cancel PMI now.
            </p>
          )}
          {a.notes.map((n) => (
            <p key={n} style={{ margin: '0 0 4px' }}>{n}</p>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 11, margin: 0 }}>{ESCROW_NOTE}</p>
    </div>
  );
}

/** The user's US state, and what it means for mortgage interest (#79). */
export function UsStateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = stateMortgageTreatment(value);
  return (
    <div data-testid="us-state" style={{ display: 'grid', gap: 4 }}>
      <Select<string>
        label="State you file taxes in"
        value={value}
        onChange={onChange}
        options={[{ value: '', label: 'Choose a state' }, ...US_STATES.map((s) => ({ value: s, label: s }))]}
      />
      <p className="muted" style={{ fontSize: 11, margin: 0 }}>
        {t.label}
        {t.sourceUrl && (
          <>
            {' '}
            <a href={t.sourceUrl} target="_blank" rel="noreferrer">Source</a>
          </>
        )}
      </p>
    </div>
  );
}
