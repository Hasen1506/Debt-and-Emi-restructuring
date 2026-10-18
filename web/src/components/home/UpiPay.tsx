'use client';

/**
 * PAY VIA UPI on a "Pay this month" row (roadmap PR H). With the lender's
 * UPI ID saved on the loan it is a `upi://pay` link with the amount and a
 * note; the phone's UPI app opens and the user approves there.
 *
 * The page can't see whether the payment went through (the UPI app
 * reports nothing back to a web page, and RightDue isn't the payee:
 * docs/retention/UPI-CONFIRMATION.md). So after the app opens it asks:
 * YES records the payment (as MARK PAID does), NO records nothing and
 * says what to do if money left anyway, NOT SURE keeps a check for later
 * with the 12-digit UPI reference if the user has it (lib/upi-confirm).
 *
 * Without a UPI ID it asks for one once and saves it on the loan. Rupee
 * loans only: UPI moves rupees.
 */
import { useEffect, useState } from 'react';
import type { LoanPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import { canPayByUpi, normalizeVpa, upiLimitNote, upiNote, upiPayLink, vpaError } from '@/lib/upi';
import { UPI_FAILED_NOTE, clearPending, readPending, savePending, utrError } from '@/lib/upi-confirm';
import { L_T, lPayBtn } from '@/components/ledger/primitives';

type Asked = 'idle' | 'asking' | 'failed' | 'unsure';

export function UpiPay({
  loan,
  name,
  amount,
  currency,
  monthLabel,
  onSaveVpa,
  rowKey,
  month,
  onConfirmed,
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
  /** The Pay-this-month row and month ("2026-10"), for a check kept for later. */
  rowKey?: string;
  month?: string;
  /** The user says it went through: record it as paid. */
  onConfirmed?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [vpa, setVpa] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked>('idle');
  const [utr, setUtr] = useState('');
  const [utrErr, setUtrErr] = useState<string | null>(null);

  // A check left open on an earlier visit asks again.
  useEffect(() => {
    if (rowKey && month && readPending().some((p) => p.key === rowKey && p.month === month)) setAsked('asking');
  }, [rowKey, month]);

  if (!loan || currency !== 'INR' || !(amount > 0)) return null;

  if (canPayByUpi(loan, currency) && !editing) {
    const to = normalizeVpa(loan.upi_vpa);
    const href = upiPayLink({ vpa: loan.upi_vpa!, name: loan.bank || undefined, amount: Math.round(amount * 100) / 100, note: upiNote(name, monthLabel) });
    const small = { fontSize: 'var(--fs-small)', color: L_T.muted, flexBasis: '100%' } as const;
    const quiet = { background: 'none', border: 0, padding: 0, color: L_T.muted, textDecoration: 'underline', cursor: 'pointer', fontSize: 'var(--fs-small)' } as const;
    const done = () => {
      if (rowKey && month) clearPending(rowKey, month);
    };
    return (
      <>
        <a
          href={href}
          onClick={() => {
            setAsked('asking');
            if (rowKey && month) savePending({ key: rowKey, name, amount, vpa: to, openedAt: new Date().toISOString(), month });
          }}
          style={{ ...lPayBtn(false), textDecoration: 'none' }}
          aria-label={`Pay via UPI: ${name} ${formatCurrencyWhole(amount, 'INR')} to ${to}`}
        >
          PAY VIA UPI
        </a>
        {asked === 'asking' ? (
          <span role="group" aria-label={`Did the UPI payment to ${name} go through?`} style={{ ...small, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Did {formatCurrencyWhole(amount, 'INR')} to {to} go through? RightDue can&apos;t see your bank, so tell us.</span>
            <button type="button" style={lPayBtn(true)} onClick={() => { done(); setAsked('idle'); onConfirmed?.(); }}>
              YES, IT WENT THROUGH
            </button>
            <button type="button" style={lPayBtn(false)} onClick={() => { done(); setAsked('failed'); }}>
              NO
            </button>
            <button type="button" style={quiet} onClick={() => setAsked('unsure')}>
              Not sure yet
            </button>
          </span>
        ) : asked === 'failed' ? (
          <span role="status" style={small}>{UPI_FAILED_NOTE}</span>
        ) : asked === 'unsure' ? (
          <span style={{ ...small, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Look for a debit SMS from your bank or the payment in your UPI app&apos;s history. We&apos;ll ask again next time.</span>
            <label style={{ fontSize: 'var(--fs-small)' }}>
              UPI reference (optional){' '}
              <input
                aria-label="UPI reference number, 12 digits"
                inputMode="numeric"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="12 digits"
                style={{ width: 120 }}
              />
            </label>
            <button
              type="button"
              style={lPayBtn(false)}
              onClick={() => {
                const e = utrError(utr);
                if (e) return setUtrErr(e);
                setUtrErr(null);
                if (rowKey && month) {
                  savePending({ key: rowKey, name, amount, vpa: to, openedAt: new Date().toISOString(), month, ...(utr.trim() ? { utr: utr.replace(/\s+/g, '') } : {}) });
                }
                setAsked('asking');
              }}
            >
              KEEP AS A CHECK
            </button>
            {utrErr && <span role="alert" style={{ color: L_T.negative }}>{utrErr}</span>}
          </span>
        ) : (
          <span style={small}>
            {`To ${to}. `}
            {upiLimitNote(amount)}
            <button type="button" onClick={() => { setVpa(loan.upi_vpa ?? ''); setEditing(true); }} style={quiet}>
              Change UPI ID
            </button>
          </span>
        )}
      </>
    );
  }

  if (!editing) {
    return (
      // A quiet link until a UPI ID is saved: two full buttons per row
      // (MARK PAID, OTHER AMOUNT) are enough to scan down a list of four.
      <button type="button" onClick={() => setEditing(true)} style={{ background: 'none', border: 0, padding: '4px 0', minHeight: 24, color: L_T.inkSoft, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-label)', letterSpacing: '0.06em' }} aria-label={`Pay via UPI: ${name}, add the lender's UPI ID`}>
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
      <label style={{ fontSize: 'var(--fs-dense)' }}>
        Lender&apos;s UPI ID for {name}{' '}
        <input aria-label={`UPI ID for ${name}`} value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="loans.123@hdfcbank" autoCapitalize="none" spellCheck={false} />
      </label>
      <button type="button" onClick={save} style={lPayBtn(true)}>SAVE UPI ID</button>
      <button type="button" onClick={() => { setEditing(false); setErr(null); }} style={lPayBtn(false)}>CANCEL</button>
      <span style={{ fontSize: 'var(--fs-small)', color: L_T.muted, flexBasis: '100%' }}>
        It&apos;s on your lender&apos;s repayment page or statement. Check it there: a payment to a wrong UPI ID can&apos;t be pulled back.
      </span>
      {err && <span role="alert" style={{ color: L_T.negative }}>{err}</span>}
    </span>
  );
}
