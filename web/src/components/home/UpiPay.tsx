'use client';

/**
 * PAY VIA UPI on a "Pay this month" row (roadmap PR H). With the lender's
 * UPI ID saved on the loan it is a `upi://pay` link with the amount and a
 * note; the phone's UPI app opens, the user approves there, then taps
 * MARK PAID here. Without one, it asks for the UPI ID once and saves it on
 * the loan. Rupee loans only: UPI moves rupees.
 */
import { useState } from 'react';
import type { LoanPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import { canPayByUpi, normalizeVpa, upiNote, upiPayLink, UPI_TYPICAL_LIMIT, vpaError } from '@/lib/upi';
import { L_T, lPayBtn } from '@/components/ledger/primitives';

export function UpiPay({
  loan,
  name,
  amount,
  currency,
  monthLabel,
  onSaveVpa,
}: {
  loan: LoanPayload | undefined;
  /** "HDFC credit card". */
  name: string;
  /** What this payment sends, in the loan's currency. */
  amount: number;
  currency: string;
  /** "Oct 2026", for the note. */
  monthLabel: string;
  /** Save the UPI ID on this loan; false when it didn't save. */
  onSaveVpa: (vpa: string) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [vpa, setVpa] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  if (!loan || currency !== 'INR' || !(amount > 0)) return null;

  if (canPayByUpi(loan, currency) && !editing) {
    const href = upiPayLink({ vpa: loan.upi_vpa!, name: loan.bank || undefined, amount: Math.round(amount * 100) / 100, note: upiNote(name, monthLabel) });
    return (
      <>
        <a href={href} onClick={() => setOpened(true)} style={{ ...lPayBtn(false), textDecoration: 'none' }} aria-label={`Pay ${name} ${formatCurrencyWhole(amount, 'INR')} via UPI to ${normalizeVpa(loan.upi_vpa)}`}>
          PAY VIA UPI
        </a>
        <span style={{ fontSize: 11, color: L_T.muted, flexBasis: '100%' }}>
          {opened ? 'Paid in your UPI app? Tap MARK PAID to record it. ' : `To ${normalizeVpa(loan.upi_vpa)}. `}
          {amount > UPI_TYPICAL_LIMIT && 'Most banks cap a UPI payment at ₹1,00,000; yours may allow more for a loan. '}
          <button type="button" onClick={() => { setVpa(loan.upi_vpa ?? ''); setEditing(true); }} style={{ background: 'none', border: 0, padding: 0, color: L_T.muted, textDecoration: 'underline', cursor: 'pointer', fontSize: 11 }}>
            Change UPI ID
          </button>
        </span>
      </>
    );
  }

  if (!editing) {
    return (
      // A quiet link until a UPI ID is saved: two full buttons per row
      // (MARK PAID, OTHER AMOUNT) are enough to scan down a list of four.
      <button type="button" onClick={() => setEditing(true)} style={{ background: 'none', border: 0, padding: '4px 0', minHeight: 24, color: L_T.inkSoft, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.06em' }} aria-label={`Pay ${name} via UPI: add the lender's UPI ID`}>
        PAY VIA UPI
      </button>
    );
  }

  function save() {
    const e = vpaError(vpa);
    if (e) return setErr(e);
    if (!onSaveVpa(normalizeVpa(vpa))) return setErr('That didn’t save. Try again.');
    setErr(null);
    setEditing(false);
  }

  return (
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexBasis: '100%' }}>
      <label style={{ fontSize: 12 }}>
        Lender&apos;s UPI ID for {name}{' '}
        <input aria-label={`UPI ID for ${name}`} value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="loans.123@hdfcbank" autoCapitalize="none" spellCheck={false} />
      </label>
      <button type="button" onClick={save} style={lPayBtn(true)}>SAVE UPI ID</button>
      <button type="button" onClick={() => { setEditing(false); setErr(null); }} style={lPayBtn(false)}>CANCEL</button>
      <span style={{ fontSize: 11, color: L_T.muted, flexBasis: '100%' }}>
        It&apos;s on your lender&apos;s repayment page or statement. Check it there: a payment to a wrong UPI ID can&apos;t be pulled back.
      </span>
      {err && <span role="alert" style={{ fontSize: 11, color: L_T.negative }}>{err}</span>}
    </span>
  );
}
