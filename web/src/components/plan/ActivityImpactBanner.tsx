/**
 * Banner shown on /plan when activity-ledger deltas have been applied
 * to the projection. Surfaces what the engine actually used so the
 * user can verify the trajectory reflects their reported history.
 *
 * Three variants mirror the Plan layouts:
 *   • ledger   → bracketed mono callout
 *   • inline   → soft tinted card (Existing)
 *   • aside    → italic prose with hairline rule (Editorial)
 */

import { formatCurrency, type Country, type LoanPayload } from '@/lib/api';
import { loanCurrency } from '@/lib/currency';
import type { ActivityImpact } from './PlanData';

const LOAN_TYPE_SHORT: Record<string, string> = {
  home_loan: 'home',
  auto_loan: 'auto',
  personal_loan: 'personal',
  credit_card: 'card',
  education_loan: 'education',
  gold_loan: 'gold',
  bnpl: 'BNPL',
};

export function ActivityImpactBanner({
  impact,
  loans,
  country,
  variant,
}: {
  impact: ActivityImpact;
  loans: LoanPayload[];
  country: Country;
  variant: 'ledger' | 'inline' | 'aside';
}) {
  const headline =
    impact.entryCount === 1
      ? '1 missed/partial payment is reflected in your plan'
      : `${impact.entryCount} missed/partial payments are reflected in your plan`;

  const lines = impact.perLoanBumps.map((b) => {
    const loan = loans[b.loanIndex];
    if (!loan) return null;
    const bank = loan.bank || 'Unnamed lender';
    const tag = LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type;
    const events = b.entryCount === 1 ? 'event' : 'events';
    const ccy = loanCurrency(loan, country);
    return {
      key: b.loanIndex,
      label: `${bank} · ${tag}`,
      detail: `+${formatCurrency(b.totalBump, ccy)} · ${b.entryCount} ${events}`,
    };
  }).filter((l): l is { key: number; label: string; detail: string } => l !== null);

  // Aggregate the headline bump per-currency so hybrid users don't see
  // a meaningless ₹+$ sum. perLoanBumps already has the per-loan bump;
  // bucket it by each loan's resolved currency.
  const bumpsByCcy = impact.perLoanBumps.reduce<Record<string, number>>(
    (acc, b) => {
      const loan = loans[b.loanIndex];
      if (!loan) return acc;
      const ccy = loanCurrency(loan, country);
      acc[ccy] = (acc[ccy] ?? 0) + Number(b.totalBump);
      return acc;
    },
    {},
  );
  // Ordered for stable rendering — user-default first, then alphabetic.
  const ccyOrder = Object.keys(bumpsByCcy).sort((a, b) => {
    const def = country === 'US' ? 'USD' : 'INR';
    if (a === def) return -1;
    if (b === def) return 1;
    return a.localeCompare(b);
  });
  const totalBumpDisplay = ccyOrder
    .map((c) => formatCurrency(bumpsByCcy[c], c))
    .join(' + ');

  if (variant === 'ledger') {
    return (
      <section>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
            fontFamily: 'var(--font-mono)',
          }}
        >
          $ ACTIVITY · {impact.entryCount} ENTR
          {impact.entryCount === 1 ? 'Y' : 'IES'} · BUMP {totalBumpDisplay}
        </div>
        <div
          style={{
            border: '1px dashed var(--negative)',
            padding: '10px 12px',
            background: 'var(--card)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--ink)',
            lineHeight: 1.6,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <strong style={{ color: 'var(--negative)' }}>NOTE</strong>{' '}
            <span style={{ color: 'var(--muted)' }}>
              · The engine bumped your loan balances by these amounts before
              simulating, drawing from your{' '}
              <a href="/insights" style={{ color: 'var(--ink)' }}>
                /insights
              </a>{' '}
              ledger. Edit there to refresh the projection.
            </span>
          </div>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              marginTop: 4,
            }}
          >
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td
                    style={{
                      padding: '4px 0',
                      color: 'var(--ink)',
                      width: '60%',
                    }}
                  >
                    → {l.label}
                  </td>
                  <td
                    style={{
                      padding: '4px 0',
                      textAlign: 'right',
                      color: 'var(--negative)',
                      fontWeight: 700,
                    }}
                  >
                    {l.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        style={{
          borderLeft: '3px solid var(--negative)',
          background: 'var(--card)',
          padding: 14,
          borderRadius: 8,
          border: '1px solid var(--border)',
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{headline}</div>
        <div className="muted" style={{ marginBottom: 8 }}>
          Your loan balances were bumped by <strong>+{totalBumpDisplay}</strong>{' '}
          (unpaid principal + penalties) before this projection was computed.
          Edit your <a href="/insights">activity ledger</a> to refresh.
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 12,
          }}
        >
          {lines.map((l) => (
            <li
              key={l.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span>{l.label}</span>
              <span className="num" style={{ color: 'var(--negative)', fontWeight: 600 }}>
                {l.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // aside (editorial)
  return (
    <div
      style={{
        marginTop: 28,
        marginBottom: 28,
        paddingTop: 20,
        paddingBottom: 20,
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
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
        From your activity ledger
      </div>
      <p
        style={{
          fontSize: 17,
          lineHeight: 1.65,
          margin: 0,
          fontStyle: 'italic',
          color: 'var(--ink)',
        }}
      >
        Before drawing the trajectory above, we honoured your record:{' '}
        <strong>{headline.toLowerCase()}</strong>. Your loan balances were
        lifted by <strong>{totalBumpDisplay}</strong> — unpaid principal
        and accrued penalty — so what you see below reflects the path forward
        from a real present, not the optimistic one.{' '}
        <a href="/insights" style={{ color: 'var(--accent)' }}>
          Edit the ledger →
        </a>
      </p>
    </div>
  );
}
