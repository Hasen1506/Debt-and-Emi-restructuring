'use client';

/**
 * "Paste bank SMS" (G6, founder note on grill #3).
 *
 * The user pastes (or shares) bank and card SMS. lib/sms-parser reads them
 * here in the browser; no SMS text is sent anywhere. What it can update, each
 * only on a tap:
 *  - a card's balance and minimum due, from a statement SMS;
 *  - a card's monthly new spend, from the card-spend SMS pasted;
 *  - which loan an EMI / NACH debit belongs to (shown, so the user knows it
 *    went through), and a bounced EMI in plain words.
 * A website can't read the SMS inbox; that needs an Android app (see
 * docs/BOTTLENECKS.md "Data import").
 */
import { useMemo, useState } from 'react';
import type { LoanPayload } from '@/lib/api';
import { loanLabel } from '@/lib/loan-types';
import { cardSpendByCard, matchEmiToLoan, parseSmsBatch, type ParsedSms } from '@/lib/sms-parser';

const KIND_LABEL: Record<string, string> = {
  debit: 'Money out',
  credit: 'Money in',
  card_spend: 'Card spend',
  emi_debit: 'EMI paid',
  emi_bounce: 'EMI bounced',
  card_statement: 'Card statement',
  otp: 'OTP (skipped)',
  promo: 'Offer (skipped)',
  unknown: 'Not a transaction',
};

function rupees(v: string | number | null): string {
  if (v === null || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : String(v);
}

/** A loan proposed from an EMI debit SMS for a loan not in the list yet (UX50 D-10):
 *  the EMI and the account digits are known; the type is a guess the user can change
 *  and the balance is left for them (or I DON'T KNOW → estimate from the EMI). */
export function loanFromEmiSms(p: ParsedSms): Partial<LoanPayload> {
  return {
    loan_type: 'personal_loan',
    bank: p.bank ?? '',
    scheduled_emi: p.amount ?? undefined,
    account_last4: p.account_last4 ?? undefined,
    imported_from: 'sms',
  } as Partial<LoanPayload>;
}

export function SmsImport({
  loans,
  onPatchLoan,
  onAddLoan,
}: {
  loans: LoanPayload[];
  onPatchLoan: (index: number, patch: Partial<LoanPayload>) => void;
  onAddLoan?: (loan: Partial<LoanPayload>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedSms[] | null>(null);
  const [done, setDone] = useState<string[]>([]);

  const cards = useMemo(
    () => loans.map((l, i) => ({ l, i })).filter(({ l }) => l.loan_type === 'credit_card'),
    [loans],
  );
  const forMatch = loans.map((l, i) => ({
    id: String(i), bank: l.bank, scheduled_emi: l.scheduled_emi, account_last4: l.account_last4,
  }));

  function cardIndexFor(last4: string | null): number | null {
    if (last4) {
      const hit = cards.filter(({ l }) => l.account_last4 === last4);
      if (hit.length === 1) return hit[0].i;
    }
    return cards.length === 1 ? cards[0].i : null;
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost" data-testid="sms-open" onClick={() => setOpen(true)}>
        Paste bank or card SMS
      </button>
    );
  }

  const spend = parsed ? cardSpendByCard(parsed) : {};
  
  return (
    <section
      data-testid="sms-import"
      style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, display: 'grid', gap: 10 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong>Paste bank or card SMS</strong>
        <button type="button" className="btn-ghost" onClick={() => { setOpen(false); setParsed(null); setText(''); }}>
          Close
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
        Copy the SMS your bank sends (card spends, card statements, EMI debits) and paste them here, one per line
        or with a blank line between. They are read on this device only and never sent anywhere. OTPs and offers
        are skipped. Nothing changes until you tap it.
      </p>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        Paste SMS, one per line
        <textarea
          rows={6}
          data-testid="sms-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Rs 3,499.00 spent on … Credit Card XX4321 on 06-Oct-26 at …"
        />
      </label>
      <div>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="sms-read"
          disabled={!text.trim()}
          onClick={() => { setParsed(parseSmsBatch(text)); setDone([]); }}
        >
          Read them
        </button>
      </div>

      {parsed && (
        <div data-testid="sms-result" style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          {parsed.map((p, k) => {
            const match = p.kind === 'emi_debit' ? matchEmiToLoan(p, forMatch) : null;
            const stIdx = p.kind === 'card_statement' ? cardIndexFor(p.card_last4) : null;
            const key = `st-${k}`;
            const addKey = `add-${k}`;
            return (
              <div key={k} data-testid="sms-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <strong>{KIND_LABEL[p.kind]}</strong>
                {p.kind === 'card_statement' ? (
                  <>
                    {p.total_due ? ` · Total ${rupees(p.total_due)}` : ''}
                    {p.min_due ? ` · Min ${rupees(p.min_due)}` : ''}
                    {p.due_date ? ` · due ${p.due_date}` : ''}
                  </>
                ) : p.amount ? ` · ${rupees(p.amount)}` : ''}
                {p.merchant ? ` · ${p.merchant}` : ''}
                {(p.kind === 'emi_debit' || p.kind === 'emi_bounce') && p.bank ? ` · ${p.bank}` : ''}
                {p.card_last4 ? ` · card ${p.card_last4}` : p.account_last4 ? ` · a/c ${p.account_last4}` : ''}
                {p.date ? ` · ${p.date}` : ''}
                {match !== null && (
                  <div className="muted" style={{ fontSize: 12 }} data-testid="sms-emi-match">
                    Matches your {loanLabel(loans[Number(match)])}
                    {loans[Number(match)].scheduled_emi ? ` (EMI ${rupees(loans[Number(match)].scheduled_emi ?? null)})` : ''}.
                  </div>
                )}
                {p.kind === 'emi_debit' && match === null && (
                  <div style={{ fontSize: 12, display: 'grid', gap: 4 }}>
                    <span className="muted">It doesn&apos;t match one of your loans&apos; EMIs, so nothing is linked.</span>
                    {onAddLoan && p.amount && (
                      <button
                        type="button"
                        className="btn-ghost"
                        data-testid="sms-add-loan"
                        disabled={done.includes(addKey)}
                        onClick={() => { onAddLoan(loanFromEmiSms(p)); setDone([...done, addKey]); }}
                      >
                        {done.includes(addKey)
                          ? 'Added below. Check its type and balance, then save.'
                          : `Add this as a loan: ${p.bank ? `${p.bank} · ` : ''}EMI ${rupees(p.amount)}${p.account_last4 ? ` · a/c XX${p.account_last4}` : ''}`}
                      </button>
                    )}
                  </div>
                )}
                {p.kind === 'emi_bounce' && (
                  <div style={{ fontSize: 12 }}>
                    A bounced EMI usually carries a bounce charge and is reported to the credit bureaus. Pay it as
                    soon as you can and ask the lender to waive the charge.
                  </div>
                )}
                {stIdx !== null && (p.total_due || p.min_due) && (
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      data-testid="sms-apply-statement"
                      disabled={done.includes(key)}
                      onClick={() => {
                        onPatchLoan(stIdx, {
                          ...(p.total_due ? { outstanding: p.total_due } : {}),
                          ...(p.min_due ? { min_payment_override: p.min_due } : {}),
                        });
                        setDone([...done, key]);
                      }}
                    >
                      {done.includes(key)
                        ? 'Updated ✓. Save the profile to keep it.'
                        : p.total_due
                          ? `Update ${loanLabel(loans[stIdx])}: ${rupees(p.total_due)} owed${p.min_due ? `, minimum ${rupees(p.min_due)}` : ''}`
                          : `Use ${rupees(p.min_due)} as ${loanLabel(loans[stIdx])}'s minimum`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {Object.entries(spend).map(([last4, total]) => {
            const idx = cardIndexFor(last4 === 'unknown' ? null : last4);
            const key = `sp-${last4}`;
            if (idx === null) return null;
            return (
              <button
                key={key}
                type="button"
                className="btn-ghost"
                data-testid="sms-apply-spend"
                disabled={done.includes(key)}
                onClick={() => {
                  onPatchLoan(idx, { expected_monthly_spend: String(total) });
                  setDone([...done, key]);
                }}
              >
                {done.includes(key)
                  ? 'Updated ✓. Save the profile to keep it.'
                  : `Use ${rupees(total)} as ${loanLabel(loans[idx])}'s monthly spend (only if these SMS cover one month)`}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
