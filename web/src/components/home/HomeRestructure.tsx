'use client';

/**
 * Cheaper rates (REDESIGN R2.4): balance transfers, consolidation and
 * refinancing the engine found, one row each, details one click away
 * (the row already gives the saving, the fee and the pay-back). Lives on Home only (Plan used to repeat it): it's the
 * first thing to do with a loan, before paying it down faster.
 */
import { useState, type ReactNode } from 'react';
import { formatCurrencyWhole, formatPct } from '@/lib/api';
import type { RestructuringHeldBack, RestructuringOpportunity, UserPayload } from '@/lib/api';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { LOAN_TYPE_NAME, disambiguateLoans, loanNickname } from '@/lib/loan-types';
import { formatAsOf } from '@/lib/as-of';
import { LBracket, LSectionHeader, L_T, lStrip } from '@/components/ledger/primitives';
import { EligibilityCaveat, OpportunityAlternative, UpdateTermsButton } from '@/components/plan/OpportunityAlternative';

const KIND: Record<RestructuringOpportunity['kind'], string> = {
  balance_transfer: 'BALANCE TRANSFER',
  consolidation: 'CONSOLIDATE',
  refinance: 'REFINANCE',
};

/** Where the offer comes from and what the user's credit score means for
 *  it: an advertised rate is not the rate a lender offers everyone. */
function OfferSource({ o, score }: { o: RestructuringOpportunity; score: number | null }) {
  const bank = o.target_bank ?? 'The lender';
  const asOf = o.target_rate_as_of ? `, last checked ${formatAsOf(o.target_rate_as_of)}` : '';
  const best = o.score_needed ?? 750;
  let credit: ReactNode;
  if (o.credit_fit === 'best' && score) {
    credit = <>Your credit score of {score} is in the range for its best rates.</>;
  } else if (o.credit_fit === 'higher' && score) {
    credit =
      o.kind === 'balance_transfer' ? (
        <>At your credit score of {score} the bank may give a smaller limit or say no.</>
      ) : (
        <>At your credit score of {score} lenders usually quote more, so this uses the middle of the bank&apos;s range.</>
      );
  } else {
    credit = (
      <>
        What you&apos;re offered depends on your credit score: banks keep their best rates for {best} and up.{' '}
        <a href="/profile?step=savings&focus=credit" style={{ color: L_T.accent }}>
          Add your score
        </a>
        .
      </>
    );
  }
  return (
    <div style={{ fontSize: 11, lineHeight: 1.55, color: L_T.inkSoft, marginTop: 4 }}>
      {bank}&apos;s advertised {o.kind === 'balance_transfer' ? 'offer' : 'rate'}
      {asOf}. {credit}
    </div>
  );
}

/** "0% for 6 months + 1.5% fee": a transfer as the bank advertises it,
 *  not the fee spread over the promo. */
function targetText(o: RestructuringOpportunity): string {
  const d = o.detail ?? {};
  if (o.kind === 'balance_transfer' && d.promo_months) {
    const fee = Number(d.fee_pct ?? 0);
    // "0%", "1.5%": as a bank prints it.
    const pct = (v: string | number) => formatPct(v);
    return `${pct(d.promo_rate ?? '0')} FOR ${d.promo_months} MO${fee > 0 ? ` + ${pct(fee)} FEE` : ''}`;
  }
  return formatPct(o.target_rate);
}

/** E1 (audit 80+): the bank's published range and where the user could
 *  land in it, instead of its floor quoted as theirs. */
function RangeLine({ o, fc }: { o: RestructuringOpportunity; fc: (v: string | number) => string }) {
  const d = o.detail ?? {};
  if (!d.range_low || !d.range_high) return null;
  const lo = Number(d.saving_at_range_low ?? 0);
  const hi = Number(d.saving_at_range_high ?? 0);
  return (
    <div data-testid="cheaper-range" style={{ fontSize: 'var(--fs-small)', lineHeight: 1.55, color: L_T.inkSoft, marginTop: 4 }}>
      {o.target_bank ?? 'The bank'} quotes {formatPct(d.range_low)} to {formatPct(d.range_high)}; this uses the middle.{' '}
      Year one: {hi > 0 ? fc(hi) : 'no saving'} at the top of the range to {fc(lo)} at the bottom, depending on your score.
    </div>
  );
}

export function HomeRestructure({
  opportunities,
  heldBack = [],
  user,
  totalAnnualSaving,
}: {
  opportunities: RestructuringOpportunity[];
  /** Moves looked at and not recommended, with why. */
  heldBack?: RestructuringHeldBack[];
  user: UserPayload;
  /** Year-one saving across every move, in the user's currency. */
  totalAnnualSaving: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const userCcy = userDefaultCurrency(user.country);
  // The currency of the loans a move is about (the engine keeps them to one).
  const ccyOf = (o: RestructuringOpportunity) => {
    const loan = user.loans[o.affected_loan_indices?.[0] ?? -1];
    return loan ? loanCurrency(loan, user.country) : userCcy;
  };
  const score = Number(user.credit_score) || null;
  const onPlan = opportunities.length > 0 && opportunities.every((o) => o.saving_basis === 'plan');
  const loanNames = (o: { affected_loan_indices?: number[]; affected_loan_banks?: string[] }) => {
    // UX walkthrough fix 7: "Card 1" / "Card 2", the names the loan list uses.
    const named = disambiguateLoans(user.loans);
    const names = (o.affected_loan_indices ?? [])
      .map((i) => named[i])
      .filter(Boolean)
      .map((l) => loanNickname(l) || (l.bank ? `${l.bank} ${LOAN_TYPE_NAME[l.loan_type]}` : LOAN_TYPE_NAME[l.loan_type]));
    const text = names.length > 0 ? names.join(' + ') : (o.affected_loan_banks ?? []).join(' + ') || 'Your loan';
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <section aria-labelledby="home-cheaper">
      <LSectionHeader
        right={
          opportunities.length > 0 ? (
            <span style={{ fontSize: 11, color: L_T.positive, fontWeight: 700, letterSpacing: '0.08em' }}>
              ABOUT {formatCurrencyWhole(totalAnnualSaving, userCcy)} IN YEAR 1
            </span>
          ) : undefined
        }
      >
        <span id="home-cheaper">Cheaper rates · {opportunities.length}</span>
      </LSectionHeader>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
        {opportunities.length === 0
          ? 'We checked what banks advertise against your debts. Nothing is worth moving right now:'
          : onPlan
            ? 'What moving a debt to a cheaper lender would save, worked out on the balance your plan leaves each month, after fees. Rates are what each bank advertises; get yours in writing before you move.'
            : "Rate comparison estimates use today's outstanding balances and include fees. Paying balances down reduces these savings. Rates are what each bank advertises; get yours in writing before you move."}
      </p>
      {opportunities.length > 0 && (
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
                  {formatPct(o.current_rate)} NOW → {targetText(o)}
                  {o.kind === 'balance_transfer' && cost > 0 ? ` (${fc(cost)})` : cost > 0 ? ` · FEE ${fc(cost)}` : ' · NO FEE'}
                  {months != null && cost > 0 ? ` · PAYS BACK IN ${Math.max(1, months)} MO` : ''}
                  {o.plan_clears_in_months ? ` · YOUR PLAN CLEARS IT IN ${o.plan_clears_in_months} MO` : ''}
                </div>
                <OfferSource o={o} score={score} />
                <RangeLine o={o} fc={fc} />
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
                  label={`${isOpen ? 'Hide details' : 'Details'}: ${loanNames(o)}`}
                >
                  {isOpen ? 'HIDE DETAILS' : 'DETAILS ↓'}
                </LBracket>
              </div>
              {isOpen && (
                <div id={panelId} style={{ gridColumn: '2 / -1', fontSize: 12, lineHeight: 1.65 }}>
                  <p style={{ margin: '0 0 6px' }}>
                    {o.headline}. {o.rationale}
                  </p>
                  {(o.target_is_existing_relationship || o.lifetime_net_saving != null) && (
                    <p style={{ margin: '0 0 6px', color: L_T.muted, fontSize: 11 }}>
                      {[
                        o.target_is_existing_relationship ? `You already bank with ${o.target_bank}` : null,
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
      )}
      {heldBack.length > 0 && (
        <div style={{ marginTop: opportunities.length > 0 ? 14 : 0 }}>
          {opportunities.length > 0 && (
            <div style={{ fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, marginBottom: 6 }}>
              LOOKED AT, NOT WORTH IT NOW
            </div>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {heldBack.map((h, i) => (
              <li key={i} style={{ fontSize: 12, lineHeight: 1.55, padding: '8px 10px', border: `1px dashed ${L_T.ruleSoft}`, background: L_T.paper }}>
                <b>
                  {KIND[h.kind].charAt(0) + KIND[h.kind].slice(1).toLowerCase()}: {loanNames(h)} → {h.target_bank ?? 'another lender'}.
                </b>{' '}
                {h.note}
                {h.reason === 'credit_score' && (
                  <>
                    {' '}
                    <a href="/profile?step=savings&focus=credit" style={{ color: L_T.accent }}>
                      Update your score
                    </a>
                    .
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
