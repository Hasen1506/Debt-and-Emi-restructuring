'use client';

// Split out of app/profile/ProfileClient.tsx by scripts/split-profile-client.cjs
// (Audit 80 E15). Moved verbatim; edit here, not in ProfileClient.

import { LBracket, LButton, L_T } from '@/components/ledger/primitives';
import type { Country } from '@/lib/api';
import { currencySymbol, userDefaultCurrency } from '@/lib/currency';
import { validSwitchRate } from '@/lib/country-switch';

/** Asks how existing amounts move to the new country's currency. Nothing
 *  changes until the user confirms; Cancel keeps the old country. */
export function CountrySwitchPanel({
  from, to, rate, rateState, onRate, loanCount, keepLoans, onKeepLoans, onConfirm, onCancel,
}: {
  from: Country;
  to: Country;
  rate: string;
  rateState: 'idle' | 'loading' | 'failed';
  onRate: (v: string) => void;
  loanCount: number;
  keepLoans: boolean;
  onKeepLoans: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fromCcy = userDefaultCurrency(from), toCcy = userDefaultCurrency(to);
  const sFrom = currencySymbol(fromCcy), sTo = currencySymbol(toCcy);
  const name = (c: Country) => (c === 'IN' ? 'India' : 'the USA');
  const r = Number(rate);
  const rateOk = validSwitchRate(r);
  return (
    <div
      role="dialog"
      aria-label="Change country"
      style={{ border: `1px solid ${L_T.negative}`, padding: '12px 14px', display: 'grid', gap: 10, fontSize: 'var(--fs-body)', lineHeight: 1.55 }}
    >
      <strong>Your amounts are in {sFrom}. {name(to) === 'the USA' ? 'The USA' : 'India'} uses {sTo}.</strong>
      <span>
        Switching to {name(to)} won&apos;t re-read {sFrom}20,00,000 as {sTo}2,000,000. Choose how your
        income, spending, savings{loanCount ? ' and loans' : ''} move over, or cancel to stay in {name(from)}.
      </span>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>Exchange rate: {sFrom}1 = {sTo}…</span>
        <input
          className="num"
          inputMode="decimal"
          value={rate}
          onChange={(e) => onRate(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder={rateState === 'loading' ? 'Fetching today’s rate…' : fromCcy === 'INR' ? 'e.g. 0.012' : 'e.g. 83'}
          aria-invalid={rate.trim() !== '' && !rateOk}
          style={{ padding: '8px 10px', border: `1px solid ${rate.trim() !== '' && !rateOk ? L_T.negative : 'var(--border)'}`, maxWidth: 220 }}
        />
        {rateState === 'failed' && <span style={{ color: L_T.negative }}>Today&apos;s rate couldn&apos;t be fetched. Enter it from your bank&apos;s app.</span>}
        {rate.trim() !== '' && !rateOk && <span style={{ color: L_T.negative }}>Enter a rate above 0.</span>}
      </label>
      {loanCount > 0 && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={keepLoans} onChange={(e) => onKeepLoans(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Keep my {loanCount} existing loan{loanCount === 1 ? '' : 's'} in {sFrom} (they are still {fromCcy} loans).
            Untick to convert {loanCount === 1 ? 'it' : 'them'} to {sTo} at this rate.
          </span>
        </label>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ opacity: rateOk ? 1 : 0.4 }}>
          <LButton onClick={rateOk ? onConfirm : undefined} disabled={!rateOk}>{`CONVERT AND SWITCH TO ${to === 'US' ? 'USA' : 'INDIA'}`}</LButton>
        </span>
        <LBracket onClick={onCancel}>{`CANCEL · STAY IN ${from === 'US' ? 'USA' : 'INDIA'}`}</LBracket>
      </div>
    </div>
  );
}
