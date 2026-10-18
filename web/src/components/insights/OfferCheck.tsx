'use client';

/**
 * Audit 80+ "Don't sign that": a top-up, a pre-approved personal loan or a
 * no-cost EMI checked against the user's own plan before they sign
 * (engine/offer_check.py). What it's compared against depends on what the
 * money is for: paying off debts already owed is compared with keeping
 * them; spending is compared with savings, with saving up from the plan's
 * spare cash, and with a personal loan at banks' published typical rate.
 */
import { useState } from 'react';
import { LButton, LChip, LChipRow, L_T, LSectionHeader, lStrip } from '@/components/ledger/primitives';
import { ApiFieldError } from '@/lib/api';
import { fetchOfferCheck, type InsightsArgs, type OfferBody, type OfferCheckData } from '@/lib/insights';

type Money = (v: number | string) => string;
const KIND_LABEL: Record<OfferBody['kind'], string> = {
  top_up: 'Top-up on my home loan',
  personal_loan: 'Personal loan offer',
  no_cost_emi: '“No-cost” / card EMI',
};
/** UX walkthrough fix 5: a US borrower gets US words (no top-up, no EMI). */
const KIND_LABEL_US: Partial<Record<OfferBody['kind'], string>> = {
  personal_loan: 'Personal loan offer',
  no_cost_emi: 'Pay-over-time offer (0% at checkout)',
};

function field(label: string, value: string, set: (v: string) => void, hint?: string) {
  return (
    <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value.replace(/[^\d.]/g, ''))}
        placeholder={hint}
        style={{ padding: '4px 6px', border: `1px solid ${L_T.ink}`, fontFamily: 'inherit', fontSize: 13, maxWidth: 220 }}
      />
    </label>
  );
}

export function OfferCheck({
  runArgs,
  money,
  loanNames,
  dateLabel,
  country = 'IN',
}: {
  country?: 'IN' | 'US';
  runArgs: InsightsArgs;
  money: Money;
  /** Open loans by position, for "pay off which?". */
  loanNames: { index: number; name: string }[];
  dateLabel: (m: number | null) => string;
}) {
  const [kind, setKind] = useState<OfferBody['kind'] | null>(null);
  const [purpose, setPurpose] = useState<OfferBody['purpose'] | null>(null);
  const [floating, setFloating] = useState<boolean | null>(null);
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [months, setMonths] = useState('');
  const [fee, setFee] = useState('');
  const [emi, setEmi] = useState('');
  const [cash, setCash] = useState('');
  const [repay, setRepay] = useState<number[]>([]);
  const [res, setRes] = useState<OfferCheckData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setErr(null);
    setRes(null);
    if (!kind || !purpose) return setErr('Pick the kind of offer and what the money is for.');
    if (kind !== 'no_cost_emi' && floating === null) return setErr(`Say whether the rate is floating or fixed (it’s on the offer${country === 'US' ? '' : ' or the KFS'}).`);
    const offer: OfferBody = {
      kind, purpose, amount: amount || '0', tenure_months: Number(months) || 0,
      rate: kind === 'no_cost_emi' ? undefined : rate ? (Number(rate) / 100).toFixed(4) : undefined,
      fee_pct: kind === 'no_cost_emi' ? undefined : fee ? (Number(fee) / 100).toFixed(4) : '0',
      fee_flat: kind === 'no_cost_emi' && fee ? fee : undefined,
      floating: kind === 'no_cost_emi' ? false : !!floating,
      monthly_emi: kind === 'no_cost_emi' ? emi : undefined,
      cash_price: kind === 'no_cost_emi' && cash ? cash : undefined,
      repay_indices: purpose === 'repay' ? repay : [],
    };
    setBusy(true);
    try {
      setRes(await fetchOfferCheck({ ...runArgs, offer }));
    } catch (e) {
      setErr(e instanceof ApiFieldError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const us = country === 'US';
  const kinds = us ? KIND_LABEL_US : KIND_LABEL;
  const sym = us ? '$' : '₹';
  const pay = us ? 'Payment' : 'EMI';
  const tone = res?.verdict === 'checks_out' ? 'positive' : 'negative';
  return (
    <section id="offer-check" aria-labelledby="offer-h" data-testid="offer-check" style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 16 }}>
      <LSectionHeader>
        <span id="offer-h">Got a loan offer? Check it before you sign</span>
      </LSectionHeader>
      <LChipRow label="What is it?">
        {(Object.keys(kinds) as OfferBody['kind'][]).map((k) => (
          <LChip small key={k} on={kind === k} onClick={() => setKind(k)}>{kinds[k]}</LChip>
        ))}
      </LChipRow>
      <LChipRow label="What’s the money for?">
        <LChip small on={purpose === 'repay'} onClick={() => setPurpose('repay')}>Paying off debts I have</LChip>
        <LChip small on={purpose === 'spend'} onClick={() => setPurpose('spend')}>Something new</LChip>
      </LChipRow>
      {purpose === 'repay' && (
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <legend style={{ fontSize: 11, marginBottom: 4 }}>Which ones would it pay off?</legend>
          {loanNames.map((l) => (
            <label key={l.index} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', minHeight: 32 }}>
              <input
                type="checkbox"
                checked={repay.includes(l.index)}
                onChange={(e) => setRepay((r) => (e.target.checked ? [...r, l.index] : r.filter((i) => i !== l.index)))}
              />
              {l.name}
            </label>
          ))}
        </fieldset>
      )}
      {kind && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {field(kind === 'no_cost_emi' ? `Price financed (${sym})` : `Loan amount (${sym})`, amount, setAmount)}
          {field('Months', months, setMonths)}
          {kind === 'no_cost_emi' ? (
            <>
              {field(`${pay} shown at checkout (${sym})`, emi, setEmi)}
              {field(`Price if you pay in full (${sym})`, cash, setCash, 'often lower')}
              {field(`Processing fee (${sym})`, fee, setFee)}
            </>
          ) : (
            <>
              {field('Rate a year (%)', rate, setRate)}
              {field('Processing fee (% of loan)', fee, setFee, us ? 'on the offer' : 'from the KFS')}
            </>
          )}
        </div>
      )}
      {kind && kind !== 'no_cost_emi' && (
        <LChipRow label="Floating or fixed rate?">
          <LChip small on={floating === true} onClick={() => setFloating(true)}>Floating</LChip>
          <LChip small on={floating === false} onClick={() => setFloating(false)}>Fixed</LChip>
        </LChipRow>
      )}
      <div>
        <LButton onClick={() => void check()} disabled={busy}>{busy ? 'CHECKING…' : 'CHECK IT AGAINST MY PLAN'}</LButton>
      </div>
      {err && <p role="alert" style={{ margin: 0, fontSize: 11, color: L_T.negative }}>{err}</p>}
      {res && (
        <div data-testid="offer-result" style={{ padding: '12px 14px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}`, ...lStrip(tone) }}>
          <p data-testid="offer-headline" style={{ margin: 0, fontSize: 12, fontWeight: 700, lineHeight: 1.5 }}>{res.headline}</p>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, lineHeight: 1.6 }}>
            <li>
              True cost {(Number(res.apr) * 100).toFixed(1)}% a year (APR, {us ? 'fee' : 'fee and GST'} in): {pay} {money(res.monthly_emi)}, {money(res.total_cost)} paid
              beyond what you get.
            </li>
            {res.comparisons.map((c) => (
              <li key={c.against}><strong>Against {c.label.toLowerCase()}:</strong> {c.detail}</li>
            ))}
            {res.debt_free_before != null && res.debt_free_after != null && res.debt_free_after !== res.debt_free_before && (
              <li>Debt-free {dateLabel(res.debt_free_after)} instead of {dateLabel(res.debt_free_before)}.</li>
            )}
            {res.notes.map((n) => <li key={n.slice(0, 30)}>{n}</li>)}
          </ul>
          <p style={{ margin: '8px 0 0', fontSize: 11, fontWeight: 600 }}>{res.neutrality}</p>
        </div>
      )}
    </section>
  );
}
