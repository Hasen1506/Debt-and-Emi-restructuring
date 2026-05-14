'use client';

/**
 * Shared form / result primitives for /tools/* screens. Each tool is a
 * narrow decision: a few inputs → one verdict + a couple of numbers.
 */
import { ReactNode, useId } from 'react';
import { BANKS_IN, BANKS_US } from '@/lib/banks';

export type FieldKind = 'decimal' | 'integer' | 'text' | 'date';

/**
 * Numeric inputs render in mono with a decimal/numeric inputMode so mobile
 * keyboards open as number pads. Text inputs render in sans with a text
 * inputMode so they don't. Date inputs use the native picker. Default kind
 * stays 'decimal' to preserve every existing call site.
 */
export function Field({
  label,
  value,
  onChange,
  hint,
  kind = 'decimal',
  placeholder,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  kind?: FieldKind;
  placeholder?: string;
  list?: string;
}) {
  const isNumeric = kind === 'decimal' || kind === 'integer';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <input
        className={isNumeric ? 'num' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={kind === 'date' ? 'date' : 'text'}
        inputMode={
          kind === 'decimal' ? 'decimal' : kind === 'integer' ? 'numeric' : 'text'
        }
        autoComplete={kind === 'text' ? 'off' : undefined}
        placeholder={placeholder}
        list={list}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--canvas)',
          color: 'var(--ink)',
          fontFamily: isNumeric ? 'var(--font-mono)' : 'var(--font-sans)',
        }}
      />
      {hint && (
        <span className="muted" style={{ fontSize: 11 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * Bank-name input backed by a native <datalist>. User types freely; the
 * dropdown surfaces known banks for the chosen country (45 today, per
 * engine/rate_cards.py). Unmatched values are accepted as-is so users
 * whose lender isn't on the list aren't blocked.
 */
export function BankCombobox({
  label,
  value,
  onChange,
  country,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  country: string;
  hint?: string;
}) {
  const id = `bank-${useId()}`;
  const banks = country === 'US' ? BANKS_US : BANKS_IN;
  return (
    <>
      <Field
        label={label}
        value={value}
        onChange={onChange}
        kind="text"
        list={id}
        placeholder={country === 'US' ? 'e.g. JPMorgan Chase' : 'e.g. HDFC Bank'}
        hint={hint}
      />
      <datalist id={id}>
        {banks.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
    </>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--canvas)',
          color: 'var(--ink)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Stat({
  label,
  value,
  color = 'var(--ink)',
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: 18, fontWeight: 600, color }}>
        {value}
      </div>
    </div>
  );
}

export function VerdictHeader({
  label,
  color,
  detail,
}: {
  label: string;
  color: string;
  detail: string;
}) {
  return (
    <>
      <div className="muted" style={{ fontSize: 12 }}>
        Verdict
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color }}>{label}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        {detail}
      </div>
      <hr
        style={{
          border: 0,
          borderTop: '1px solid var(--border)',
          margin: '12px 0',
        }}
      />
    </>
  );
}

const BAND_LABEL: Record<string, string> = {
  poor: 'Poor',
  fair: 'Fair',
  good: 'Good',
  very_good: 'Very Good',
  excellent: 'Excellent',
};

export function ScoreChip({
  deltaLow,
  deltaHigh,
  daysToRealise,
  currentBand,
  projectedBandHigh,
  source,
  rationale,
}: {
  deltaLow: number;
  deltaHigh: number;
  daysToRealise: number;
  currentBand: string;
  projectedBandHigh: string;
  source: string;
  rationale: string;
}) {
  const positive = deltaHigh > 0 && deltaLow >= 0;
  const negative = deltaHigh <= 0;
  const color = positive
    ? 'var(--positive)'
    : negative
      ? 'var(--negative)'
      : 'var(--accent)';
  const sign = positive ? '+' : '';
  const range = deltaLow === deltaHigh
    ? `${sign}${deltaHigh}`
    : `${sign}${deltaLow} to ${sign.replace('-', '')}${deltaHigh > 0 ? '+' : ''}${deltaHigh}`;
  const bandChange =
    currentBand !== projectedBandHigh
      ? ` · ${BAND_LABEL[currentBand]} → ${BAND_LABEL[projectedBandHigh]}`
      : '';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '10px 12px',
        border: `1px solid ${color}`,
        borderRadius: 6,
        background: 'var(--canvas)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 12 }}>Estimated score impact</span>
        <span className="num" style={{ fontSize: 16, fontWeight: 600, color }}>
          {range} pts
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          in ~{daysToRealise}d{bandChange}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>{rationale}</div>
      <div className="muted" style={{ fontSize: 10, fontStyle: 'italic' }}>
        Source: {source}
      </div>
    </div>
  );
}

export function SubmitBar({
  busy,
  error,
  label,
}: {
  busy: boolean;
  error: string | null;
  label: string;
}) {
  return (
    <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Checking…' : label}
      </button>
      {error && (
        <span
          className="muted"
          style={{ marginLeft: 12, color: 'var(--negative)' }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
