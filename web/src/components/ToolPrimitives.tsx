'use client';

/**
 * Shared form / result primitives for /tools/* screens. Each tool is a
 * narrow decision: a few inputs → one verdict + a couple of numbers.
 */
import { ReactNode } from 'react';

export function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <input
        className="num"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--canvas)',
          color: 'var(--ink)',
          fontFamily: 'var(--font-mono)',
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
