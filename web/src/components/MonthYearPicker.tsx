'use client';

/**
 * Month + Year dropdowns. Use this for every "which month" question,
 * never `<input type="month">`: Firefox desktop and Safari render that as
 * a plain text box, people typed "03/2019", and the app couldn't read it.
 *
 * `value` is "YYYY-MM" once both halves are picked, otherwise "". The
 * half-picked state lives here so choosing the month first doesn't wipe
 * itself out while the year is still empty.
 */
import { useEffect, useId, useState } from 'react';
import { MONTH_NAMES } from '@/lib/today';

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--canvas)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans)',
  minWidth: 0,
};

export function MonthYearPicker({
  label,
  value,
  onChange,
  minYear = 1995,
  maxYear = new Date().getFullYear(),
  hint,
  optional = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  minYear?: number;
  maxYear?: number;
  hint?: string;
  optional?: boolean;
  /** A problem with this month (e.g. the server's 422), shown under it. */
  error?: string | null;
}) {
  const id = useId();
  const [month, setMonth] = useState(value ? value.slice(5, 7) : '');
  const [year, setYear] = useState(value ? value.slice(0, 4) : '');

  // Follow outside changes (e.g. a profile prefill) without clobbering a
  // half-picked state the user is in the middle of.
  useEffect(() => {
    if (value) {
      setMonth(value.slice(5, 7));
      setYear(value.slice(0, 4));
    }
  }, [value]);

  function update(m: string, y: string) {
    setMonth(m);
    setYear(y);
    onChange(m && y ? `${y}-${m}` : '');
  }

  // Past dates (a loan's start) list the latest year first; a picker that
  // only looks ahead (a purchase) lists this year first.
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);
  if (minYear >= new Date().getFullYear()) years.reverse();
  const half = (month && !year) || (!month && year);

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="muted" style={{ fontSize: 12, padding: 0, marginBottom: 4 }}>
        {label}
        {optional && ' (optional)'}
      </legend>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 8 }}>
        <select
          id={`${id}-m`}
          aria-label={`${label}: month`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          value={month}
          onChange={(e) => update(e.target.value, year)}
          style={selectStyle}
        >
          <option value="">Month</option>
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={String(i + 1).padStart(2, '0')}>
              {name}
            </option>
          ))}
        </select>
        <select
          id={`${id}-y`}
          aria-label={`${label}: year`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          value={year}
          onChange={(e) => update(month, e.target.value)}
          style={selectStyle}
        >
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <span id={`${id}-err`} role="alert" style={{ fontSize: 12, color: 'var(--negative)', display: 'block' }}>
          {error}
        </span>
      )}
      {half && (
        <span role="status" style={{ fontSize: 11, color: 'var(--accent)' }}>
          Still needed: {month ? 'the year' : 'the month'}.
        </span>
      )}
      {hint && !half && (
        <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
          {hint}
        </span>
      )}
    </fieldset>
  );
}
