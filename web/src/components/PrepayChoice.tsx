'use client';

/** UX2 #20: "Lower your EMI or finish sooner?" asked after a lump sum, with
 *  what each answer does to this loan. No answer is picked for the user. */
import type { Country, PrepayMode } from '@/lib/api';
import { prepayChoiceNote, prepayLabel } from '@/lib/prepay-choice';
import { L_T } from '@/components/ledger/primitives';

export function PrepayChoice({
  country,
  value,
  onChange,
  detail,
  error,
}: {
  country: Country;
  value: PrepayMode | null;
  onChange: (m: PrepayMode) => void;
  /** One line per answer: what it does to this loan. */
  detail?: Partial<Record<PrepayMode, string>>;
  error?: string | null;
}) {
  const q = country === 'US' ? 'Lower your payment or finish sooner?' : 'Lower your EMI or finish sooner?';
  return (
    <fieldset
      data-testid="prepay-choice"
      aria-invalid={error ? true : undefined}
      style={{ border: `1px solid ${error ? L_T.negative : L_T.ruleSoft}`, padding: '8px 10px', margin: 0, fontSize: 'var(--fs-dense)', lineHeight: 1.5 }}
    >
      <legend style={{ fontWeight: 700, padding: '0 4px' }}>{q}</legend>
      {(['reduce_tenure', 'reduce_emi'] as const).map((m) => (
        <label key={m} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', cursor: 'pointer' }}>
          <input type="radio" name="prepay-mode" checked={value === m} onChange={() => onChange(m)} style={{ marginTop: 4 }} />
          <span>
            <strong>{prepayLabel(m, country)}</strong>
            {detail?.[m] && <span style={{ color: L_T.muted }}> · {detail[m]}</span>}
          </span>
        </label>
      ))}
      <div style={{ color: L_T.muted, fontSize: 'var(--fs-small)' }}>{prepayChoiceNote(country)}</div>
      {error && <div role="alert" style={{ color: L_T.negative, fontSize: 'var(--fs-small)' }}>{error}</div>}
    </fieldset>
  );
}
