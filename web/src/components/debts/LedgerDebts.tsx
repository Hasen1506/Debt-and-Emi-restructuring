'use client';

/**
 * Ledger Debts — open positions from the user's saved profile.
 *
 * Reads the real loans the user entered during onboarding (passed in via
 * server-loaded profile). Two sections:
 *   1. Header KPI strip: TOTAL OUTSTANDING / BLENDED EFFECTIVE APR / EMI BURDEN
 *   2. Per-loan table with expandable rows. Click [BREAKDOWN] on any row to
 *      reveal the effective-APR breakdown (nominal → tax shield → GST →
 *      fees → effective) — same component as Setup so the math matches.
 */

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import type { LoanPayload, LoanType } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { computeBreakdown, fmt } from '@/lib/effective-apr';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';
import { LifecycleEventsPanel } from '@/components/lifecycle/LifecycleEventsPanel';
import { StaleCardNudge } from '@/components/debts/StaleCardNudge';
import { CashManagementSection } from '@/components/debts/CashManagementSection';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'CREDIT CARD',
  personal_loan: 'PERSONAL LOAN',
  home_loan: 'HOME LOAN',
  auto_loan: 'AUTO LOAN',
  education_loan: 'EDUCATION LOAN',
  gold_loan: 'GOLD LOAN',
  bnpl: 'BNPL',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '0.18em',
        marginBottom: 6,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </div>
  );
}

export function LedgerDebts({ profile }: { profile: StoredProfile }) {
  const { user, marginalRate } = profile;
  const loans = user.loans ?? [];
  const country = user.country;
  const taxRegime = country === 'IN' ? user.tax_regime : undefined;

  const [expanded, setExpanded] = useState<number | null>(null);

  const metrics = useMemo(() => {
    if (loans.length === 0) {
      return {
        total: new Decimal(0),
        blendedEffective: new Decimal(0),
        emiBurden: new Decimal(0),
      };
    }
    // Convert per-loan amounts into user-residence currency before summing.
    // Hybrid users previously had ₹ + $ summed as if they shared units.
    const userCcy = userDefaultCurrency(country);
    const fxMap = user.fx_to_user_currency ?? {};
    const toUser = (amount: Decimal, loan: LoanPayload): Decimal => {
      const lc = loanCurrency(loan, country);
      if (lc === userCcy) return amount;
      return amount.mul(new Decimal(fxMap[lc] ?? '1'));
    };
    let total = new Decimal(0);
    let weightedEffSum = new Decimal(0);
    let emi = new Decimal(0);
    for (const l of loans) {
      const balUser = toUser(new Decimal(l.outstanding || 0), l);
      const emiUser = toUser(new Decimal(l.scheduled_emi || 0), l);
      const { effective } = computeBreakdown(l, marginalRate, country, taxRegime);
      total = total.add(balUser);
      weightedEffSum = weightedEffSum.add(balUser.mul(effective));
      emi = emi.add(emiUser);
    }
    return {
      total,
      blendedEffective: total.gt(0) ? weightedEffSum.div(total) : new Decimal(0),
      emiBurden: emi,
    };
  }, [loans, marginalRate, country, taxRegime, user.fx_to_user_currency]);

  const monthlyIncome = new Decimal(user.monthly_income || 0);
  const burdenPct = monthlyIncome.gt(0)
    ? metrics.emiBurden.div(monthlyIncome).mul(100).toFixed(0)
    : '—';

  if (loans.length === 0) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          padding: 24,
          border: '1px dashed var(--border)',
        }}
      >
        $ DEBTS · 0 OPEN
        <br />
        <br />
        No loans on file. Add your first debt:{' '}
        <a href="/onboarding?step=loans" style={{ color: 'var(--accent)' }}>
          [+ ADD DEBT →]
        </a>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <section>
        <SectionLabel>$ DEBTS · {loans.length} OPEN</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {[
            {
              l: 'TOTAL OUTSTANDING',
              v: formatCurrency(metrics.total.toString(), userDefaultCurrency(country)),
              s: 'SUM OF PRINCIPALS',
            },
            {
              l: 'BLENDED EFFECTIVE APR',
              v: fmt(metrics.blendedEffective),
              s: 'WEIGHTED BY BALANCE',
            },
            {
              l: 'EMI BURDEN',
              v: `${formatCurrency(metrics.emiBurden.toString(), userDefaultCurrency(country))}/MO`,
              s:
                burdenPct === '—'
                  ? 'NO INCOME ON FILE'
                  : `${burdenPct}% OF MONTHLY INCOME`,
            },
          ].map((m) => (
            <div
              key={m.l}
              style={{ background: 'var(--canvas)', padding: '10px 12px' }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  letterSpacing: '0.12em',
                  marginBottom: 4,
                }}
              >
                {m.l}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{m.v}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                {m.s}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
          }}
        >
          <span>$ POSITIONS · DETAIL</span>
          <a
            href="/onboarding?step=loans"
            style={{ color: 'var(--ink)', textDecoration: 'none' }}
          >
            [+ ADD / EDIT DEBT]
          </a>
        </div>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
          }}
        >
          <thead>
            <tr
              style={{
                borderTop: '2px solid var(--ink)',
                borderBottom: '1px solid var(--ink)',
              }}
            >
              {['#', 'LENDER', 'KIND', 'NOMINAL', 'EFFECTIVE', 'OUTSTANDING', 'EMI', 'TENURE', ''].map(
                (h, i) => (
                  <th
                    key={h || `c${i}`}
                    style={{
                      padding: '8px 12px',
                      textAlign: i > 2 ? 'right' : 'left',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      fontSize: 10,
                      color: 'var(--muted)',
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loans.map((l, i) => {
              const { effective } = computeBreakdown(l, marginalRate, country, taxRegime);
              const nominal = new Decimal(l.nominal_rate || 0);
              const isCard = l.loan_type === 'credit_card';
              const hl = isCard && effective.gt(D24);
              return (
                <RowGroup
                  key={i}
                  index={i}
                  loan={l}
                  nominal={nominal}
                  effective={effective}
                  highlight={hl}
                  expanded={expanded === i}
                  onToggle={() => setExpanded(expanded === i ? null : i)}
                  marginalRate={marginalRate}
                  country={country}
                  taxRegime={taxRegime}
                  incomeType={user.income_type}
                />
              );
            })}
            <tr style={{ borderTop: '2px solid var(--ink)' }}>
              <td colSpan={5} style={{ padding: '10px 12px', fontWeight: 700 }}>
                TOTAL
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                {formatCurrency(metrics.total.toString(), userDefaultCurrency(country))}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                {formatCurrency(metrics.emiBurden.toString(), userDefaultCurrency(country))}/mo
              </td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <SectionLabel>$ NOTE · RATES</SectionLabel>
        <div
          style={{
            border: '1px solid var(--ink)',
            padding: '12px 16px',
            background: 'var(--card)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          Effective APR = nominal − tax shield + GST + processing fee + insurance.
          Banks quote nominal only; the spread is what actually hits your
          statement. Tap <strong>[BREAKDOWN]</strong> on any row to see exactly
          how that loan's effective rate is built. The formula matches{' '}
          <span className="num">engine/formulas.py</span> exactly — if it
          changes there, the breakdown updates here.
        </div>
      </section>

      <StaleCardNudge user={profile.user} variant="ledger" />
      <CashManagementSection profile={profile} variant="ledger" />
      <LifecycleEventsPanel user={profile.user} variant="ledger" />
    </div>
  );
}

const D24 = new Decimal('0.24');

function RowGroup({
  index,
  loan,
  nominal,
  effective,
  highlight,
  expanded,
  onToggle,
  marginalRate,
  country,
  taxRegime,
  incomeType,
}: {
  index: number;
  loan: LoanPayload;
  nominal: Decimal;
  effective: Decimal;
  highlight: boolean;
  expanded: boolean;
  onToggle: () => void;
  marginalRate: string;
  country: 'IN' | 'US';
  taxRegime: 'new' | 'old' | undefined;
  incomeType: 'salaried' | 'business_owner';
}) {
  const kind = LOAN_TYPE_LABEL[loan.loan_type] ?? loan.loan_type;
  const tenure =
    loan.tenure_months_remaining > 0 ? `${loan.tenure_months_remaining} mo` : '—';
  const loanCcy = loanCurrency(loan, country);
  const emi =
    Number(loan.scheduled_emi) > 0
      ? formatCurrency(loan.scheduled_emi, loanCcy)
      : '—';
  return (
    <>
      <tr
        style={{
          borderBottom: expanded ? 'none' : '1px dashed var(--dash)',
          background: highlight ? '#fff3a3' : 'transparent',
        }}
      >
        <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
          {String(index + 1).padStart(2, '0')}
        </td>
        <td style={{ padding: '10px 12px', fontWeight: 700 }}>
          {loan.bank || '—'}
          {loan.currency && (
            <span
              className="muted"
              style={{
                marginLeft: 6,
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 5px',
                border: '1px solid var(--dash)',
                borderRadius: 3,
                letterSpacing: '0.05em',
              }}
            >
              {loan.currency}
            </span>
          )}
        </td>
        <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{kind}</td>
        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
          {fmt(nominal)}
        </td>
        <td
          style={{
            padding: '10px 12px',
            textAlign: 'right',
            color: highlight ? 'var(--negative)' : 'var(--ink)',
            fontWeight: highlight ? 700 : 400,
          }}
        >
          {fmt(effective)}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
          {formatCurrency(loan.outstanding || '0', loanCcy)}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{emi}</td>
        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--muted)' }}>
          {tenure}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
          <button
            type="button"
            onClick={onToggle}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {expanded ? '[CLOSE]' : '[BREAKDOWN]'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: '1px dashed var(--dash)' }}>
          <td colSpan={9} style={{ padding: '0 12px 14px' }}>
            <EffectiveAprBreakdown
              loan={loan}
              marginalTaxRate={marginalRate}
              country={country}
              taxRegime={taxRegime}
              variant="card"
              incomeType={incomeType}
            />
          </td>
        </tr>
      )}
    </>
  );
}
