'use client';

/**
 * Shared form / result primitives for /tools/* screens. Each tool is a
 * narrow decision: a few inputs → one verdict + a couple of numbers.
 */
import { ReactNode, useEffect, useId, useRef, useState } from 'react';
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
 * Tap-to-open bank picker. Replaces the previous <datalist> approach
 * which was unreliable on mobile (Android Chrome silently dropped
 * suggestions; iOS Safari rendered a broken popover). This version is
 * a custom combobox: button reveals current value, click opens a
 * popover with a search field and a scrollable list, typing filters,
 * Esc / outside-click closes. Free text is accepted so users whose
 * lender isn't on the list aren't blocked.
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
  const allBanks = country === 'US' ? BANKS_US : BANKS_IN;
  const placeholder = country === 'US' ? 'Select bank' : 'Select bank';

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLLabelElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    // Focus search input shortly after opening so mobile keyboard appears.
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = q
    ? allBanks.filter((b) => b.toLowerCase().includes(q))
    : allBanks;
  const exact = matches.find((b) => b.toLowerCase() === q);

  function pick(v: string) {
    onChange(v);
    setQuery('');
    setOpen(false);
  }

  return (
    <label
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}
    >
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--canvas)',
          color: value ? 'var(--ink)' : 'var(--muted)',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          textAlign: 'left',
          cursor: 'pointer',
          width: '100%',
        }}
      >
        <span>{value || placeholder}</span>
        <span aria-hidden style={{ color: 'var(--muted)', fontSize: 11 }}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            maxHeight: 320,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bank or type your own…"
            autoComplete="off"
            style={{
              padding: '10px 12px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {matches.length === 0 && !q && (
              <div className="muted" style={{ padding: 12, fontSize: 13 }}>
                No banks in list — type your lender's name.
              </div>
            )}
            {matches.map((b) => {
              const active = b === value;
              return (
                <button
                  key={b}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pick(b)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '10px 12px',
                    border: 'none',
                    background: active ? 'var(--soft-bg)' : 'transparent',
                    color: 'var(--ink)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 14,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {b}
                </button>
              );
            })}
            {q && !exact && (
              <button
                type="button"
                onClick={() => pick(query.trim())}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px 12px',
                  border: 'none',
                  borderTop: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--accent)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                Use “{query.trim()}”
              </button>
            )}
          </div>
        </div>
      )}

      {hint && (
        <span className="muted" style={{ fontSize: 11 }}>
          {hint}
        </span>
      )}
    </label>
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
