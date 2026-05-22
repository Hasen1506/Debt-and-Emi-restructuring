/**
 * Tax-prep panel shown on /plan.
 *
 * Surfaces projected year-1 interest per loan + the country-specific
 * deduction context (India Sec 24/80E, US Schedule A / student-loan).
 * Read-only — this is guidance, not configuration. Users still file
 * taxes against actual paid interest, not projected; the projection
 * exists to help them notice when a cap will or won't bind.
 *
 * Three layout variants mirror the Plan themes; chrome lives in PanelShell.
 */
import {
  formatCurrency,
  type Country,
  type LoanPayload,
  type TaxRegimeIN,
} from '@/lib/api';
import { projectYear1Interest } from '@/lib/tax-projection';
import { LOAN_TYPE_SHORT } from '@/lib/loan-types';
import { PanelShell } from '@/components/themed/PanelShell';

const CAVEAT =
  'Estimate from scheduled-EMI amortisation. Actual deductible interest depends on when you pay (file off the year-end statement, not this projection).';

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

  if (variant === 'ledger') {
    return (
      <PanelShell
        variant="ledger"
        eyebrow="TAX PLANNING · YEAR-1 INTEREST"
        caveat={CAVEAT}
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
      </PanelShell>
    );
  }

  if (variant === 'inline') {
    return (
      <PanelShell
        variant="inline"
        eyebrow="Tax planning — what you can claim next year"
        caveat={CAVEAT}
      >
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
      </PanelShell>
    );
  }

  // aside (editorial)
  return (
    <PanelShell
      variant="aside"
      eyebrow="Tax planning · what to claim next year"
      caveat={CAVEAT}
    >
      <div style={{ fontSize: 14, fontFamily: 'var(--font-sans)', lineHeight: 1.7 }}>
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
      </div>
    </PanelShell>
  );
}
