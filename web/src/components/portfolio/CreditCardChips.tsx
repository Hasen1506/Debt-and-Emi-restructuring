'use client';

/**
 * Credit-card chip strip on /portfolio. Renders one card-shaped tile per
 * credit_card loan with the masked number, cardholder name, bank,
 * outstanding, and what it costs a year. Helps the user recognise *which* card
 * the trajectory is talking about — a /plan KPI saying "HDFC credit card"
 * is one thing; seeing the actual masked number and cardholder is what
 * makes it click.
 *
 * Hidden cleanly when the user has no credit_card loans.
 */

import type { UserPayload, LoanType, Country } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { loanMarginalCost } from '@/lib/marginal-cost';
import Decimal from 'decimal.js';

function formatLast6(digits: string | undefined): string {
  if (!digits || digits.length < 4) return '•••• •• •••• ••••';
  const padded = digits.slice(-6).padStart(6, '•');
  return `•••• •••• ${padded.slice(0, 2)} ${padded.slice(2)}`;
}

export function CreditCardChips({
  user,
  marginalRate,
}: {
  user: UserPayload;
  marginalRate: string;
}) {
  const cards = (user.loans ?? []).filter(
    (l) => (l.loan_type as LoanType) === 'credit_card',
  );
  if (cards.length === 0) return null;

  const country = user.country as Country;
  const ccy = country === 'IN' ? 'INR' : 'USD';
  const marg = new Decimal(marginalRate || '0');

  return (
    <section>
      <h3
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 10,
        }}
      >
        Your cards · what you owe on them
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {cards.map((c, i) => {
          // What the card costs a year: compounded, with GST (lib/marginal-cost).
          const cost = loanMarginalCost(c, country, marg, user.tax_regime);
          return (
            <div
              key={`${c.bank}-${i}`}
              style={{
                position: 'relative',
                aspectRatio: '1.586 / 1',
                background:
                  'linear-gradient(135deg, var(--ink) 0%, color-mix(in srgb, var(--ink) 65%, var(--accent)) 100%)',
                borderRadius: 12,
                padding: 16,
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 1px 6px rgba(0,0,0,0.12)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: 11, opacity: 0.7 }}>
                  {c.bank || 'Credit card'}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    background: 'rgba(255,255,255,0.18)',
                    padding: '2px 6px',
                    borderRadius: 3,
                  }}
                >
                  {fmt(cost.annualCost)}/yr
                </span>
              </div>
              <div
                style={{
                  fontSize: 16,
                  letterSpacing: '0.12em',
                }}
              >
                {formatLast6(c.card_last_6)}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                }}
              >
                <div>
                  <div style={{ fontSize: 9, opacity: 0.65, letterSpacing: '0.08em' }}>
                    CARDHOLDER
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {c.cardholder_name || '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, opacity: 0.65, letterSpacing: '0.08em' }}>
                    OUTSTANDING
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {formatCurrency(c.outstanding, ccy)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
