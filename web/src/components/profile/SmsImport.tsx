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

export function SmsImport({
  loans,
  onPatchLoan,
}: {
  loans: LoanPayload[];
  onPatchLoan: (index: number, patch: Partial<LoanPayload>) => void;
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
  const statements = (parsed ?? []).filter((p) => p.kind === 'card_statement');

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
      <textarea
        rows={6}
        data-testid="sms-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Rs 3,499.00 spent on … Credit Card XX4321 on 06-Oct-26 at …"
      />
      <div>
        <button
          type="button"
          className="btn-primary"
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
            return (
              <div key={k} data-testid="sms-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <strong>{KIND_LABEL[p.kind]}</strong>
                {p.amount ? ` · ${rupees(p.amount)}` : ''}
                {p.merchant ? ` · ${p.merchant}` : ''}
                {p.card_last4 ? ` · card ${p.card_last4}` : p.account_last4 ? ` · a/c ${p.account_last4}` : ''}
                {p.date ? ` · ${p.date}` : ''}
                {match !== null && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    This matches the EMI on {loans[Number(match)].bank || 'your loan'}.
                  </div>
                )}
                {p.kind === 'emi_debit' && match === null && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    It doesn&apos;t match one of your loans&apos; EMIs exactly, so nothing is linked.
                  </div>
                )}
                {p.kind === 'emi_bounce' && (
                  <div style={{ fontSize: 12 }}>
                    A bounced EMI usually carries a bounce charge and is reported to the credit bureaus. Pay it as
                    soon as you can and ask the lender to waive the charge.
                  </div>
                )}
              </div>
            );
          })}

          {statements.map((p, k) => {
            const idx = cardIndexFor(p.card_last4);
            const key = `st-${k}`;
            if (idx === null || !p.total_due) return null;
            return (
              <button
                key={key}
                type="button"
                className="btn-ghost"
                data-testid="sms-apply-statement"
                disabled={done.includes(key)}
                onClick={() => {
                  onPatchLoan(idx, {
                    outstanding: p.total_due ?? undefined,
                    ...(p.min_due ? { min_payment_override: p.min_due } : {}),
                  });
                  setDone([...done, key]);
                }}
              >
                {done.includes(key)
                  ? 'Updated'
                  : `Set ${loans[idx].bank || 'card'} to ${rupees(p.total_due)} owed${p.min_due ? `, minimum ${rupees(p.min_due)}` : ''}`}
              </button>
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
                  ? 'Updated'
                  : `Use ${rupees(total)} as ${loans[idx].bank || 'this card'}'s monthly spend (only if these SMS cover one month)`}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
