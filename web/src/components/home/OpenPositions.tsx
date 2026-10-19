'use client';

/**
 * Your loans and cards (REDESIGN R2.5, was Open positions): every open loan, one row each — the
 * statement rate and what it costs a year (compounded, with GST, after the
 * tax break: lib/marginal-cost), EMI or card minimum, months left, balance.
 * A row opens to how that cost is worked out. The loan an extra payment
 * goes to first by cost is flagged DEAREST. Replaces the separate Debts page.
 */
import { Term } from '@/components/Term';
import { localTerms, paymentWords } from '@/lib/terms';
import { useState, type ReactNode } from 'react';
import type { StoredProfile } from '@/lib/user-store';
import { formatCurrencyWhole } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import type { DerivedMetrics } from '@/lib/derived';
import { usMortgageShieldShare } from '@/lib/deductions';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { loanGaps } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME, loanNickname } from '@/lib/loan-types';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';
import { LBracket, LSectionHeader, L_T, lStrip } from '@/components/ledger/primitives';
import { StaleCardNudge } from './StaleCardNudge';
import { FxRateLine } from '@/components/fx/FxRateLine';
import { useOwedNow } from '@/lib/owed-now';
import { convertedBalanceLine, emiStatusLine } from '@/lib/position-status';
import { formatMonth, getCountryToday } from '@/lib/today';

export function OpenPositions({ profile, m, dues }: { profile: StoredProfile; m: DerivedMetrics; dues?: ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const { user } = profile;
  const country = user.country;
  // R8-2: the tag a US borrower reads ("PAYMENT") instead of India's "EMI".
  const emiTag = country === 'US' ? 'PAYMENT' : 'EMI';
  const userCcy = userDefaultCurrency(country);
  const gapCtx = { country, fx: user.fx_to_user_currency };
  // With a rate missing the dearest loan isn't known, so none is flagged.
  const anyGap = m.loans.some((d) => loanGaps(d.loan, gapCtx).length > 0);
  const dearest = anyGap ? null : m.loudest;
  const itemises = usMortgageShieldShare(user);
  const noFx = m.fxMissing.length > 0;
  // What's owed now: a loan whose EMI has gone out this month shows the
  // balance after it (lib/owed-now).
  const now = useOwedNow(user.loans, country);
  const today = getCountryToday(country);
  const mon = formatMonth(today.getFullYear(), today.getMonth(), 'short');
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMon = formatMonth(next.getFullYear(), next.getMonth(), 'short');
  const totalNow = m.loans.reduce((s, d) => s.add(m.toUserCcy(now.rows[d.index]?.owed ?? d.outstanding, d.loan)), m.totalOutstanding.mul(0));

  return (
    <section aria-labelledby="positions-h" id="positions" style={{ scrollMarginTop: 16 }}>
      <LSectionHeader right={<LBracket href="/profile?step=loans">+ ADD A LOAN</LBracket>}>
        <span id="positions-h">Your loans and cards · {m.loans.length}</span>
      </LSectionHeader>
      {/* Where these numbers come from: the user, not the bank. */}
      <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>
        As entered in Profile, not linked to your bank: check them against a
        statement now and then. A loan moves on by its {paymentWords(country).one} once you mark it
        paid; a card shows what you've paid this month off the balance you
        entered, until you enter the next statement.
      </p>
      <StaleCardNudge user={user} />
      <FxRateLine user={user} nowMs={Date.now()} />
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: `2px solid ${L_T.ink}` }}>
        {m.loans.map((d, i) => {
          const { loan } = d;
          const ccy = loanCurrency(loan, country);
          const fc = (v: string | number) => formatCurrencyWhole(v, ccy);
          const gaps = loanGaps(loan, gapCtx);
          const isCard = loan.loan_type === 'credit_card';
          const months = Number(loan.tenure_months_remaining || 0);
          // UX2B-15: a pay-later bill is a payment, not an EMI ("EMI ₹6,500 · 1 MO LEFT" after it was paid).
          const later = loan.loan_type === 'bnpl';
          const payTag = later ? 'PAYMENT' : emiTag;
          const leftTag = (n: number) => (later ? (n > 0 ? `${n} PAYMENT${n === 1 ? '' : 'S'} LEFT` : 'NOTHING MORE DUE') : `${n} MO LEFT`);
          const isDearest = d === dearest;
          const isOpen = open === i;
          const owed = now.rows[d.index]?.owed ?? d.outstanding;
          const status = now.rows[d.index]?.status ?? null;
          const base = loan.bank ? `${loan.bank} ${LOAN_TYPE_NAME[loan.loan_type]}` : LOAN_TYPE_NAME[loan.loan_type];
          // The user's own name first when the loan has one (live test #4).
          const name = loanNickname(loan) ? `${loanNickname(loan)} · ${base}` : base;
          const missing = (what: string) => <span style={{ color: L_T.negative, fontWeight: 700 }}>ADD THE {what}</span>;
          const parts = [
            gaps.includes('rate') ? (
              missing('RATE')
            ) : d.effective.sub(d.nominal).abs().lt(0.00005) ? (
              // No fees, GST or tax saving: one rate.
              <span style={{ color: isDearest ? L_T.negative : L_T.ink, fontWeight: 700 }}>{fmtPct(d.effective)}</span>
            ) : (
              // Audit 80 B13/E2: the statement's rate first, the one all-in
              // figure second (lib/card-rate), no arrow implying the user's
              // number was wrong.
              <>
                <span style={{ color: isDearest ? L_T.negative : L_T.ink, fontWeight: 700 }}>{fmtPct(d.nominal)} A YEAR</span>{' '}
                {/* UX fix 19: a rate filled by "I don't know" says so until the real one is typed. */}
                {d.loan.estimated_fields?.includes('rate') ? <span data-testid="rate-estimated" style={{ color: L_T.muted }}>(ESTIMATE · CHECK YOUR STATEMENT) </span> : null}
                · ABOUT {fmtPct(d.effective)} {d.effective.lt(d.nominal) ? 'AFTER THE TAX BREAK' : <Term id="cost_a_year" about={name}>ALL-IN</Term>}
              </>
            ),
            gaps.includes('emi') ? (
              missing(emiTag)
            ) : d.required.gt(0) && !(status && status !== 'paid') ? (
              `${isCard ? 'MINIMUM' : payTag} ${fc(d.required.toFixed(0))}`
            ) : null,
            // Once this month's EMI is paid it's no longer one of the months left.
            isCard ? <Term key="rev" id="revolving" about={name}>REVOLVING</Term> : months > 0 ? leftTag(now.rows[d.index]?.status === 'paid' ? months - 1 : months) : null,
          ].filter(Boolean);
          return (
            <li
              key={loan.id ?? d.index}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px minmax(0, 1fr) auto',
                columnGap: 10,
                rowGap: 6,
                padding: '12px 10px 12px 8px',
                borderBottom: `1px dashed ${L_T.ruleSoft}`,
                fontSize: 'var(--fs-dense)',
                ...(isDearest ? lStrip('negative') : null),
              }}
            >
              <span style={{ color: L_T.muted }}>{String(i + 1).padStart(2, '0')}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                  {isDearest && (
                    <span style={{ marginLeft: 8, fontSize: 10, letterSpacing: '0.12em', color: L_T.negative }}>
                      · COSTLIEST
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, letterSpacing: '0.08em', color: L_T.muted, marginTop: 3, lineHeight: 1.6 }}>
                  {parts.map((p, k) => (
                    <span key={k}>
                      {k > 0 && ' · '}
                      {p}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {now.rows[d.index]?.cardBefore ? `≈ ${fc(owed.toFixed(0))}` : fc(owed.toFixed(0))}
                </div>
                {now.rows[d.index]?.cardBefore && (
                  // UX50 B-12: the card moves when it's marked paid, as an
                  // estimate until the next statement is entered.
                  <div data-testid="card-paid-down" style={{ fontSize: 10, color: L_T.muted, maxWidth: 180, marginLeft: 'auto' }}>
                    WAS {fc(now.rows[d.index]!.cardBefore!.toFixed(0))} · LESS THIS MONTH&apos;S PAYMENT, BEFORE INTEREST ·{' '}
                    <a href="/profile?step=loans" style={{ color: L_T.accent }}>ENTER THE STATEMENT</a>
                  </div>
                )}
                {ccy !== userCcy && !noFx && (
                  <div style={{ fontSize: 10, color: L_T.muted }}>
                    {convertedBalanceLine(formatCurrencyWhole(m.toUserCcy(owed, loan).toFixed(0), userCcy))}
                  </div>
                )}
              </div>
              {status && (
                // UX50 B-06: the EMI status gets its own full-width line under
                // the loan, so the details beside the balance don't wrap into
                // a narrow column on a phone.
                <div
                  style={{
                    gridColumn: '2 / -1',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    color: status === 'paid' ? L_T.positive : status === 'due' ? L_T.muted : L_T.negative,
                  }}
                >
                  {emiStatusLine(status, mon, nextMon, isCard ? 'MINIMUM' : payTag, !gaps.includes('emi') && d.required.gt(0) ? fc(d.required.toFixed(0)) : null)}
                </div>
              )}
              <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {!gaps.includes('rate') && d.effective.gt(0) && (
                  <LBracket onClick={() => setOpen(isOpen ? null : i)} label={isOpen ? `Hide what the ${name} costs a year, line by line` : `Why ${fmtPct(d.effective)}? What the ${name} costs a year, line by line`}>
                    {isOpen ? 'HIDE' : `WHY ${fmtPct(d.effective)}? ↓`}
                  </LBracket>
                )}
                <LBracket href="/profile?step=loans" label={`Edit ${name}`}>
                  EDIT
                </LBracket>
              </div>
              {isOpen && (
                <div style={{ gridColumn: '2 / -1' }}>
                  <EffectiveAprBreakdown
                    loan={loan}
                    variant="inline"
                    marginalTaxRate={profile.marginalRate}
                    country={country}
                    taxRegime={country === 'IN' ? user.tax_regime : undefined}
                    incomeType={user.income_type}
                    itemises={itemises}
                    cost={d.cost}
                  />
                </div>
              )}
            </li>
          );
        })}
        <li
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            padding: '10px 10px 10px 46px',
            borderTop: `2px solid ${L_T.ink}`,
            fontSize: 12,
          }}
        >
          <span style={{ color: L_T.muted, letterSpacing: '0.1em', fontSize: 10 }}>
            TOTAL OWED{m.loans.some((d) => loanCurrency(d.loan, country) !== userCcy) ? ` IN ${userCcy}` : ''}
          </span>
          {noFx ? (
            // ₹ can't be added to $ without a rate.
            <a href="/profile?step=loans" style={{ color: L_T.negative, fontWeight: 700 }}>
              ADD THE EXCHANGE RATE
            </a>
          ) : (
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {formatCurrencyWhole(totalNow.toFixed(0), userCcy)}
              <span style={{ color: L_T.muted, fontWeight: 400 }}>
                {' '}· {localTerms('EMIS', country)} + MINIMUMS {dues ?? formatCurrencyWhole(m.emiBurden.toFixed(0), userCcy)}/MO
              </span>
            </span>
          )}
        </li>
      </ol>
    </section>
  );
}
