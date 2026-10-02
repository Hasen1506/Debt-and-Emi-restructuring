'use client';

/**
 * Cheaper rates (REDESIGN R2.4): balance transfers, consolidation and
 * refinancing the engine found, one row each — the top one open, the rest
 * one click away. Lives on Home only (Plan used to repeat it): it's the
 * first thing to do with a loan, before paying it down faster.
 */
import { useState } from 'react';
import { formatCurrencyWhole, formatPct } from '@/lib/api';
import type { RestructuringOpportunity, UserPayload } from '@/lib/api';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { formatAsOf } from '@/lib/as-of';
import { LBracket, LSectionHeader, L_T, lStrip } from '@/components/ledger/primitives';
import { EligibilityCaveat, OpportunityAlternative, UpdateTermsButton } from '@/components/plan/OpportunityAlternative';

const KIND: Record<RestructuringOpportunity['kind'], string> = {
  balance_transfer: 'BALANCE TRANSFER',
  consolidation: 'CONSOLIDATE',
  refinance: 'REFINANCE',
};

export function HomeRestructure({
  opportunities,
  user,
  totalAnnualSaving,
}: {
  opportunities: RestructuringOpportunity[];
  user: UserPayload;
  /** Year-one saving across every move, in the user's currency. */
  totalAnnualSaving: string;
}) {
  const [open, setOpen] = useState<number | null>(0);
  const userCcy = userDefaultCurrency(user.country);
  // The currency of the loans a move is about (the engine keeps them to one).
  const ccyOf = (o: RestructuringOpportunity) => {
    const loan = user.loans[o.affected_loan_indices?.[0] ?? -1];
    return loan ? loanCurrency(loan, user.country) : userCcy;
  };
  const loanNames = (o: RestructuringOpportunity) => {
    const names = (o.affected_loan_indices ?? [])
      .map((i) => user.loans[i])
      .filter(Boolean)
      .map((l) => (l.bank ? `${l.bank} ${LOAN_TYPE_NAME[l.loan_type]}` : LOAN_TYPE_NAME[l.loan_type]));
    const text = names.length > 0 ? names.join(' + ') : o.affected_loan_banks.join(' + ') || 'Your loan';
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <section aria-labelledby="home-cheaper">
      <LSectionHeader
        right={
          <span style={{ fontSize: 11, color: L_T.positive, fontWeight: 700, letterSpacing: '0.08em' }}>
            UP TO {formatCurrencyWhole(totalAnnualSaving, userCcy)} IN YEAR 1
          </span>
        }
      >
        <span id="home-cheaper">Cheaper rates · {opportunities.length}</span>
      </LSectionHeader>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
        Rate comparison estimates use today&apos;s outstanding balances and include fees.
        Paying balances down reduces these savings; they are not the savings from your payoff schedule.
      </p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: `2px solid ${L_T.ink}` }}>
        {opportunities.map((o, i) => {
          const isOpen = open === i;
          const ccy = ccyOf(o);
          const fc = (v: string | number) => formatCurrencyWhole(v, ccy);
          const saving = Number(o.estimated_annual_saving);
          const cost = Number(o.one_time_cost ?? 0);
          const months = o.breakeven_months;
          const panelId = `cheaper-${i}`;
          return (
            <li
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px minmax(0, 1fr) auto',
                columnGap: 10,
                rowGap: 6,
                padding: '12px 10px 12px 8px',
                borderBottom: `1px dashed ${L_T.ruleSoft}`,
                fontSize: 12,
                ...(i === 0 ? lStrip('accent') : null),
              }}
            >
              <span style={{ color: L_T.muted }}>{String(i + 1).padStart(2, '0')}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {loanNames(o)} → {o.target_bank ?? 'another lender'}
                </div>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', color: L_T.muted, marginTop: 3 }}>
                  <span style={{ color: L_T.accent, fontWeight: 700 }}>{KIND[o.kind]}</span> ·{' '}
                  {formatPct(o.current_rate)} → {formatPct(o.target_rate)}
                  {cost > 0 ? ` · FEE ${fc(cost)}` : ' · NO FEE'}
                  {months != null && cost > 0 ? ` · PAYS BACK IN ${Math.max(1, months)} MO` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: saving > 0 ? L_T.positive : L_T.negative }}>
                  {fc(o.estimated_annual_saving)}
                </div>
                <div style={{ fontSize: 10, color: L_T.muted }}>YEAR 1 ESTIMATE</div>
              </div>
              <div style={{ gridColumn: '2 / -1' }}>
                <LBracket
                  onClick={() => setOpen(isOpen ? null : i)}
                  label={`${isOpen ? 'Hide' : 'Show'} details: ${loanNames(o)}`}
                >
                  {isOpen ? 'HIDE DETAILS' : 'DETAILS ↓'}
                </LBracket>
              </div>
              {isOpen && (
                <div id={panelId} style={{ gridColumn: '2 / -1', fontSize: 12, lineHeight: 1.65 }}>
                  <p style={{ margin: '0 0 6px' }}>
                    {o.headline}. {o.rationale}
                  </p>
                  {(o.target_is_existing_relationship || o.target_rate_as_of || o.lifetime_net_saving != null) && (
                    <p style={{ margin: '0 0 6px', color: L_T.muted, fontSize: 11 }}>
                      {[
                        o.target_is_existing_relationship ? `You already bank with ${o.target_bank}` : null,
                        o.target_rate_as_of ? `Rate as of ${formatAsOf(o.target_rate_as_of)}; confirm it with the lender` : null,
                        o.lifetime_net_saving != null ? `${fc(o.lifetime_net_saving)} saved over the rest of the loan` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      .
                    </p>
                  )}
                  {/* The loan's own market: an NRI's rupee loan is refinanced in India. */}
                  <EligibilityCaveat kind={o.kind} country={ccy === 'INR' ? 'IN' : 'US'} variant="ledger" />
                  <UpdateTermsButton opportunity={o} user={user} currency={ccy} variant="ledger" />
                  <OpportunityAlternative opportunity={o} variant="ledger" currency={userCcy} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
