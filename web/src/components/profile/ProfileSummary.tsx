'use client';

/**
 * Profile at rest (REDESIGN R1.5): everything saved, one ledger section per
 * part, each with [EDIT] opening just that part of the form. "Payoff order"
 * holds the three orders side by side (R6.3), worked out on the server and
 * passed in; it is left out when there's no debt to order.
 */
import { useEffect, type ReactNode } from 'react';
import Decimal from 'decimal.js';
import { LBracket, LSectionHeader, L_T } from '@/components/ledger/primitives';
import { formatCurrency } from '@/lib/api';
import type { AgeBracket, AssetPayload, UserPayload } from '@/lib/api';
import { formatLoanAmount, loanToUser, userDefaultCurrency } from '@/lib/currency';
import { loanLabel } from '@/lib/loan-types';

const AGE_LABEL: Record<AgeBracket, string> = {
  under_25: 'Under 25',
  '25_35': '25 to 35',
  '35_50': '35 to 50',
  '50_plus': '50 to 59',
  '60_plus': '60 or over',
};

/** Form sections, by the index the form uses for them. */
export const PROFILE_SECTIONS = [
  'You',
  'Where you live and tax',
  'Income and spending',
  'Loans',
  'Savings, banks and credit score',
] as const;

export function ProfileSummary({
  user,
  creditScore,
  assets,
  payoffOrder,
  onEdit,
  marginalRate,
}: {
  user: UserPayload;
  creditScore: string;
  assets: AssetPayload[];
  /** The tax rate on the next rupee/dollar earned, as the plan uses it. */
  marginalRate?: string;
  payoffOrder: ReactNode;
  onEdit: (section: number) => void;
}) {
  // The masthead's medallion links to #strategy, which only exists once
  // the profile has loaded in the browser, after the browser looked for it.
  useEffect(() => {
    if (window.location.hash === '#strategy') document.getElementById('strategy')?.scrollIntoView();
  }, []);
  const ccy = userDefaultCurrency(user.country);
  const money = (v: string | number | Decimal | undefined) => formatCurrency(v || '0', ccy);
  const loans = user.loans.filter((l) => Number(l.outstanding) > 0);
  const owed = loans.reduce((s, l) => s + (loanToUser(Number(l.outstanding), l, user.country, user.fx_to_user_currency) ?? 0), 0);
  const gross =
    user.income_type === 'salaried' ? user.annual_gross_salary : user.annual_business_income;
  const spendVar = Number(user.variable_expenses || 0);
  const hike = Number(user.annual_hike_rate || 0);
  const phases = (user.hike_schedule ?? []).length;
  const a = user.assumptions;
  const ownValues =
    Object.keys(user.asset_returns ?? {}).length +
    Object.keys(user.liquidation_costs ?? {}).length +
    [user.prepay_hurdle, a?.ef_months, a?.ef_save_amount, a?.goal_buffer_pct].filter((v) => v != null && v !== '').length;
  const held = assets.reduce((s, a) => s.add(Number(a.current_market_value) > 0 ? a.current_market_value : 0), new Decimal(0));
  const edit = (n: number) => (
    <LBracket accent onClick={() => onEdit(n)} label={`Edit ${PROFILE_SECTIONS[n]}`}>
      EDIT
    </LBracket>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <section aria-labelledby="pf-you">
        <LSectionHeader step={1} right={edit(0)}>
          <span id="pf-you">{PROFILE_SECTIONS[0]}</span>
        </LSectionHeader>
        <Rows
          rows={[
            ['Name', user.display_name?.trim() || <Muted>Not given (optional)</Muted>],
            ['Age', user.age_bracket ? AGE_LABEL[user.age_bracket] : <Muted>Not given (optional)</Muted>],
          ]}
        />
      </section>

      <section aria-labelledby="pf-tax">
        <LSectionHeader step={2} right={edit(1)}>
          <span id="pf-tax">{PROFILE_SECTIONS[1]}</span>
        </LSectionHeader>
        <Rows
          rows={[
            ['Country', `${user.country === 'IN' ? 'India' : 'USA'}${user.is_nri_us ? ', with loans in India' : ''}`],
            user.country === 'IN'
              ? ['Tax regime', user.tax_regime === 'old' ? 'Old regime' : 'New regime']
              : [
                  'Filing as',
                  `${{ single: 'Single', mfj: 'Married, filing jointly', hoh: 'Head of household' }[user.filing_status ?? 'single']}${
                    Number(user.state_marginal_rate) > 0
                      ? ` · state tax ${(Number(user.state_marginal_rate) * 100).toFixed(1)}%`
                      : ''
                  }`,
                ],
            ...(Number(marginalRate) > 0 || marginalRate === '0'
              ? [['Tax on your next ' + (user.country === 'IN' ? 'rupee' : 'dollar'), `${(Number(marginalRate) * 100).toFixed(1)}%`] as [string, ReactNode]]
              : []),
          ]}
        />
        {/* What the tax details change, and (India) which law the section numbers come from. */}
        <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>
          {user.country === 'IN'
            ? 'The plan uses these for the tax break on home-loan and education-loan interest (old regime only) and to weigh paying early against investing, after tax. Section numbers are the familiar 1961-Act ones (24(b), 80E, 87A); the Income-tax Act, 2025 renumbers them from 1 April 2026 with the same limits.'
            : 'The plan uses these for the mortgage and student-loan interest deductions and to weigh paying early against investing, after tax.'}
        </p>
      </section>

      <section aria-labelledby="pf-income">
        <LSectionHeader step={3} right={edit(2)}>
          <span id="pf-income">{PROFILE_SECTIONS[2]}</span>
        </LSectionHeader>
        <Rows
          rows={[
            [
              'Take-home',
              <>
                {money(user.monthly_income)} a month
                {(user.income_streams?.length ?? 0) > 0 && <Muted> · from {user.income_streams!.length} income sources</Muted>}
              </>,
            ],
            [
              user.income_type === 'salaried' ? 'Gross salary' : 'Business income',
              Number(gross) > 0 ? `${money(gross)} a year` : <Muted>Not entered, so the tax bracket is estimated</Muted>,
            ],
            [
              'Spending',
              spendVar > 0
                ? `${money(user.fixed_expenses)} fixed + ${money(user.variable_expenses)} flexible, a month`
                : `${money(user.fixed_expenses)} a month`,
            ],
            ['Pay rise', phases > 0 ? `${phases} phase${phases > 1 ? 's' : ''} set` : hike > 0 ? `${(hike * 100).toFixed(0)}% a year` : <Muted>None assumed</Muted>],
          ]}
        />
      </section>

      <section aria-labelledby="pf-loans">
        <LSectionHeader step={4} right={edit(3)}>
          <span id="pf-loans">{PROFILE_SECTIONS[3]}</span>
        </LSectionHeader>
        {loans.length === 0 ? (
          <Rows rows={[['Loans', <Muted key="n">None</Muted>]]} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: L_T.muted, fontSize: 10, letterSpacing: '0.12em', textAlign: 'right' }}>
                  <th scope="col" style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>LOAN</th>
                  <th scope="col" style={{ ...cell, fontWeight: 500 }}>OWED</th>
                  <th scope="col" style={{ ...cell, fontWeight: 500 }}>RATE</th>
                  <th scope="col" style={{ ...cell, fontWeight: 500 }}>EMI</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l, i) => (
                  <tr key={l.id ?? i} style={{ borderTop: `1px dashed ${L_T.ruleSoft}`, textAlign: 'right' }}>
                    <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>
                      {loanLabel(l)}
                    </th>
                    <td style={cell}>{formatLoanAmount(Number(l.outstanding), l, user.country, user.fx_to_user_currency)}</td>
                    <td style={cell}>{(Number(l.nominal_rate) * 100).toFixed(2)}%</td>
                    <td style={cell}>
                      {l.loan_type === 'credit_card' ? <Muted>minimum</Muted> : formatLoanAmount(Number(l.scheduled_emi), l, user.country, user.fx_to_user_currency)}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${L_T.ink}`, textAlign: 'right', fontWeight: 700 }}>
                  <th scope="row" style={{ ...cell, textAlign: 'left' }}>Total</th>
                  <td style={cell}>{money(owed)}</td>
                  <td style={cell} colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="pf-savings">
        <LSectionHeader step={5} right={edit(4)}>
          <span id="pf-savings">{PROFILE_SECTIONS[4]}</span>
        </LSectionHeader>
        <Rows
          rows={[
            [
              'Savings',
              <>
                {money(user.savings_balance)}
                {(user.cash_accounts?.length ?? 0) > 0 && <Muted> · in {user.cash_accounts!.length} accounts</Muted>}
              </>,
            ],
            [
              'Emergency fund',
              Number(user.efund_target) > 0
                ? `${money(user.efund_balance)} of ${money(user.efund_target)}`
                : <Muted>No target set</Muted>,
            ],
            ['Main bank', user.primary_bank || <Muted>Not given</Muted>],
            [user.country === 'IN' ? 'CIBIL score' : 'FICO score', creditScore || <Muted>Not given</Muted>],
          ]}
        />
      </section>

      <section aria-labelledby="pf-own">
        <LSectionHeader
          step={6}
          right={
            <span style={{ display: 'inline-flex', gap: 12 }}>
              <LBracket href="/portfolio" label="See what you own: holdings, cash and what selling would do">SEE ALL</LBracket>
              <LBracket accent href="/profile/assets" label="Edit what you own">EDIT</LBracket>
            </span>
          }
        >
          <span id="pf-own">What you own</span>
        </LSectionHeader>
        <Rows
          rows={[
            [
              'Holdings',
              assets.length > 0 ? (
                <>
                  {money(held)} <Muted>· {assets.length} holding{assets.length > 1 ? 's' : ''}</Muted>
                </>
              ) : (
                <Muted>None entered. Add them on Portfolio.</Muted>
              ),
            ],
          ]}
        />
      </section>

      {payoffOrder && (
        <section id="strategy" aria-labelledby="pf-order" style={{ scrollMarginTop: 16 }}>
          <LSectionHeader step={7} right={<LBracket accent href="/plan" label="See the payoff order on Plan">SEE ON PLAN</LBracket>}>
            <span id="pf-order">Payoff order</span>
          </LSectionHeader>
          {payoffOrder}
        </section>
      )}

      {/* The numbers the plan assumes (returns, selling costs, the emergency
          fund): reachable from here, not only from inside an edit. */}
      <section aria-labelledby="pf-assumptions">
        <LSectionHeader step={payoffOrder ? 8 : 7} right={<LBracket accent href="/profile/assumptions" label="Edit the plan's assumptions">EDIT</LBracket>}>
          <span id="pf-assumptions">Assumptions</span>
        </LSectionHeader>
        <Rows
          rows={[
            [
              'Your own values',
              ownValues > 0 ? (
                `${ownValues} set by you; the rest are defaults`
              ) : (
                <Muted>Defaults: savings and investment returns, selling costs, emergency fund months, prepay margin</Muted>
              ),
            ],
          ]}
        />
      </section>

      <section aria-labelledby="pf-privacy">
        <LSectionHeader step={payoffOrder ? 9 : 8}>
          <span id="pf-privacy">Privacy</span>
        </LSectionHeader>
        <p style={{ margin: 0, color: L_T.muted, lineHeight: 1.6 }}>
          Your details stay in this browser, and in your account if you sign in. The engine sees them only to work
          out your plan.
        </p>
      </section>
    </div>
  );
}

const cell = { padding: '8px 6px' } as const;

function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: L_T.muted }}>{children}</span>;
}

function Rows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl style={{ margin: 0 }}>
      {rows.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            padding: '8px 0',
            borderBottom: `1px dashed ${L_T.ruleSoft}`,
          }}
        >
          <dt style={{ color: L_T.muted, minWidth: 'min(160px, 40%)' }}>{k}</dt>
          <dd style={{ margin: 0, textAlign: 'right', flex: 1 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
