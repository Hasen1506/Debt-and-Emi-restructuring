/**
 * Tax-prep panel shown on /plan.
 *
 * Surfaces projected year-1 interest per loan + the country-specific
 * deduction context (India Sec 24/80E, US Schedule A / student-loan).
 * Read-only — this is guidance, not configuration. Users still file
 * taxes against actual paid interest, not projected; the projection
 * exists to help them notice when a cap will or won't bind.
 *
 * Three layout variants mirror the Plan themes (ledger / inline / aside).
 * Kept compact: a heading + a small table + a single caveat.
 */
import {
  formatCurrency,
  type Country,
  type LoanPayload,
  type TaxRegimeIN,
} from '@/lib/api';
import { projectYear1Interest } from '@/lib/tax-projection';

const LOAN_TYPE_SHORT: Record<string, string> = {
  home_loan: 'home',
  auto_loan: 'auto',
  personal_loan: 'personal',
  credit_card: 'card',
  education_loan: 'education',
  gold_loan: 'gold',
  bnpl: 'BNPL',
};

export function TaxBreakdown({
  user,
  variant,
}: {
  user: {
    country: Country;
    loans: LoanPayload[];
    tax_regime?: TaxRegimeIN;
  };
  variant: 'ledger' | 'inline' | 'aside';
}) {
  const rows = projectYear1Interest(user);
  // Surface the panel when at least one loan would be eligible (under
  // current regime) OR has actionable regime-switch context. Pure no-debt
  // users or all-cards-only users see nothing.
  const anyShowable = rows.some(
    (r) => r.deductionEligible || r.deductionContext != null,
  );
  if (!anyShowable) return null;

  const lines = rows
    .map((r) => {
      const loan = user.loans[r.loanIndex];
      if (!loan) return null;
      // Skip rows that are both ineligible AND have no actionable context —
      // these are loans where no deduction exists in any regime (personal,
      // auto, cards). Listing them as "not deductible" adds noise.
      if (!r.deductionEligible && r.deductionContext == null) return null;
      return {
        key: r.loanIndex,
        bank: loan.bank || 'Unnamed lender',
        type: LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type,
        interest: r.year1Interest,
        currency: r.currency,
        eligible: r.deductionEligible,
        context: r.deductionContext,
      };
    })
    .filter(<T,>(l: T): l is NonNullable<T> => l !== null);

  const caveat =
    'Estimate from scheduled-EMI amortisation. Actual deductible interest depends on when you pay (file off the year-end statement, not this projection).';

  if (variant === 'ledger') {
    return (
      <section style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
            fontFamily: 'var(--font-mono)',
          }}
        >
          $ TAX PLANNING · YEAR-1 INTEREST
        </div>
        <div
          style={{
            border: '1px solid var(--border)',
            padding: '10px 12px',
            background: 'var(--card)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td style={{ padding: '4px 0', color: 'var(--ink)', width: '40%' }}>
                    → {l.bank} · {l.type}
                  </td>
                  <td
                    style={{
                      padding: '4px 0',
                      color: l.eligible ? 'var(--ink)' : 'var(--muted)',
                      textAlign: 'right',
                      fontWeight: l.eligible ? 700 : 400,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatCurrency(l.interest.toFixed(0), l.currency)}
                  </td>
                  <td
                    style={{
                      padding: '4px 0 4px 10px',
                      color: 'var(--muted)',
                      fontSize: 11,
                    }}
                  >
                    {l.context}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 11 }}>
            {caveat}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        style={{
          background: 'var(--card)',
          padding: 14,
          borderRadius: 8,
          border: '1px solid var(--border)',
          fontSize: 13,
          lineHeight: 1.55,
          marginTop: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Tax planning — what you can claim next year
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontSize: 12,
          }}
        >
          {lines.map((l) => (
            <li key={l.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>
                  {l.bank} · {l.type}
                </span>
                <span
                  className="num"
                  style={{
                    color: l.eligible ? 'var(--ink)' : 'var(--muted)',
                    fontWeight: l.eligible ? 600 : 400,
                  }}
                >
                  {formatCurrency(l.interest.toFixed(0), l.currency)}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {l.context}
              </div>
            </li>
          ))}
        </ul>
        <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
          {caveat}
        </div>
      </div>
    );
  }

  // aside (editorial)
  return (
    <div
      style={{
        marginTop: 28,
        paddingTop: 20,
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-display)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--soft)',
          marginBottom: 10,
        }}
      >
        Tax planning · what to claim next year
      </div>
      <div
        style={{
          fontSize: 14,
          fontFamily: 'var(--font-sans)',
          lineHeight: 1.7,
        }}
      >
        {lines.map((l) => (
          <div
            key={l.key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              paddingBottom: 6,
            }}
          >
            <span>
              <strong>{l.bank}</strong> · <em>{l.type}</em> ·{' '}
              <span style={{ color: l.eligible ? 'var(--ink)' : 'var(--muted)' }}>
                {l.context}
              </span>
            </span>
            <span
              className="num"
              style={{
                color: l.eligible ? 'var(--ink)' : 'var(--muted)',
                fontWeight: l.eligible ? 600 : 400,
              }}
            >
              {formatCurrency(l.interest.toFixed(0), l.currency)}
            </span>
          </div>
        ))}
        <p
          style={{
            marginTop: 14,
            fontStyle: 'italic',
            fontSize: 12,
            color: 'var(--muted)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {caveat}
        </p>
      </div>
    </div>
  );
}
