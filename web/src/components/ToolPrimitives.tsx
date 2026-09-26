'use client';

/**
 * Shared form / result primitives for /tools/* screens. Each tool is a
 * narrow decision: a few inputs → one verdict + a couple of numbers.
 */
import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { BANKS_IN, BANKS_US } from '@/lib/banks';

/** 'percent': the caller's value is a fraction ("0.085"); the field shows
 *  and accepts a percentage ("8.5"). */
export type FieldKind = 'decimal' | 'integer' | 'text' | 'date' | 'percent';

/**
 * Tap-to-toggle info tooltip. Renders an ⓘ button inline with a label and
 * opens a small popover with plain-English explanation of the technical
 * term. Click outside or Esc closes. Mobile-friendly — uses click-toggle
 * rather than hover, which doesn't exist on touch devices.
 */
export function InfoTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

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
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label="What does this mean?"
        aria-expanded={open}
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: '1px solid var(--border)',
          background: 'var(--card)',
          color: 'var(--muted)',
          fontSize: 10,
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 240,
            maxWidth: 320,
            zIndex: 60,
            padding: '10px 12px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            color: 'var(--ink)',
            fontSize: 12,
            lineHeight: 1.55,
            fontFamily: 'var(--font-sans)',
            fontWeight: 400,
            textTransform: 'none',
            letterSpacing: 0,
            whiteSpace: 'normal',
          }}
        >
          {children}
        </div>
      )}
    </span>
  );
}

/**
 * Label row reused by every form primitive. Renders the text label and,
 * when present, an InfoTip on the right.
 */
function LabelRow({
  label,
  info,
  htmlFor,
  id,
}: {
  label: string;
  info?: ReactNode;
  htmlFor?: string;
  id?: string;
}) {
  // The InfoTip button sits *beside* the <label>, never inside it: a label
  // names the first control it contains, so a button inside it would take
  // the name and leave the real input unnamed for screen readers.
  return (
    <span
      className="muted"
      style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <label htmlFor={htmlFor} id={id}>
        {label}
      </label>
      {info && <InfoTip>{info}</InfoTip>}
    </span>
  );
}

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
  info,
  kind = 'decimal',
  placeholder,
  list,
  suggestion,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  info?: ReactNode;
  kind?: FieldKind;
  placeholder?: string;
  list?: string;
  /** A problem with this field (e.g. the server's 422 message), shown
   *  under it and announced; the input is marked invalid. */
  error?: string | null;
  /** Click-to-fill suggestion. When set and `value` is empty, renders a
   *  muted recommendation line below the field; touching/focusing the
   *  input fills it with `suggestion.value`. User can edit or clear. The
   *  caller decides what counts as "empty" — typically `value === ''`. */
  suggestion?: { value: string; label: string };
}) {
  const inputId = useId();
  const isPercent = kind === 'percent';
  const isNumeric = kind === 'decimal' || kind === 'integer' || isPercent;
  const hasSuggestion = !!suggestion && value === '';
  // Percent fields keep the typed text ("8.", "8.5") and hand the caller
  // the fraction; re-derived only when the value changes from outside.
  const [pctText, setPctText] = useState(() => fractionToPercentText(value));
  useEffect(() => {
    if (!isPercent) return;
    setPctText((t) => (percentTextToFraction(t) === value ? t : fractionToPercentText(value)));
  }, [isPercent, value]);
  const shown = isPercent ? pctText : value;
  const handleChange = (raw: string) => {
    if (!isPercent) return onChange(raw);
    setPctText(raw);
    const f = percentTextToFraction(raw);
    onChange(f ?? raw);
  };
  const handleFocus = () => {
    if (hasSuggestion && suggestion) onChange(suggestion.value);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <LabelRow label={label} info={info} htmlFor={inputId} />
      <input
        id={inputId}
        aria-describedby={describedBy(inputId, hint, error)}
        aria-invalid={error ? true : undefined}
        className={isNumeric ? 'num' : undefined}
        value={shown}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        type={kind === 'date' ? 'date' : 'text'}
        inputMode={
          kind === 'decimal' || isPercent ? 'decimal' : kind === 'integer' ? 'numeric' : 'text'
        }
        autoComplete={kind === 'text' ? 'off' : undefined}
        placeholder={placeholder}
        list={list}
        style={{
          padding: '8px 10px',
          border: `1px solid ${error ? 'var(--negative)' : 'var(--border)'}`,
          borderRadius: 6,
          background: 'var(--canvas)',
          color: 'var(--ink)',
          fontFamily: isNumeric ? 'var(--font-mono)' : 'var(--font-sans)',
        }}
      />
      {hasSuggestion && suggestion && (
        <button
          type="button"
          onClick={() => onChange(suggestion.value)}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 'none',
            padding: 0,
            margin: 0,
            fontSize: 11,
            color: 'var(--soft, color-mix(in srgb, var(--ink) 55%, var(--canvas)))',
            cursor: 'pointer',
            textAlign: 'left',
            fontStyle: 'italic',
          }}
          title="Click or focus the field to use this suggestion"
        >
          ↳ {suggestion.label}
        </button>
      )}
      <FieldError id={inputId} error={error} />
      {hint && (
        <span id={`${inputId}-hint`} className="muted" style={{ fontSize: 11 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

/** "0.085" → "8.5"; anything that isn't a number is shown as typed. */
export function fractionToPercentText(v: string): string {
  const t = v.trim();
  if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return t;
  return new Decimal(t).mul(100).toDecimalPlaces(6).toString();
}

/** "8.5" or "8.5%" → "0.085"; null when it isn't a number yet. */
export function percentTextToFraction(v: string): string | null {
  // A trailing "." is mid-typing ("8." on the way to "8.5").
  const t = v.trim().replace(/%$/, '').trim().replace(/\.$/, '');
  if (t === '') return '';
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  return new Decimal(t).div(100).toString();
}

function describedBy(id: string, hint?: string, error?: string | null): string | undefined {
  const ids = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

/** The message under a field that the server (or a check) rejected. */
export function FieldError({ id, error }: { id: string; error?: string | null }) {
  if (!error) return null;
  return (
    <span id={`${id}-err`} role="alert" style={{ fontSize: 12, color: 'var(--negative)' }}>
      {error}
    </span>
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
  info,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  country: string;
  hint?: string;
  info?: ReactNode;
}) {
  const allBanks = country === 'US' ? BANKS_US : BANKS_IN;
  const placeholder = country === 'US' ? 'Select bank' : 'Select bank';

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const buttonId = useId();
  const labelId = useId();

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
    <div
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}
    >
      <LabelRow label={label} info={info} htmlFor={buttonId} id={labelId} />
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${buttonId}`}
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
            aria-label="Search banks"
            autoComplete="off"
            style={{
              padding: '10px 12px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
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
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  info,
  error,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  info?: ReactNode;
  error?: string | null;
}) {
  const selectId = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <LabelRow label={label} info={info} htmlFor={selectId} />
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-describedby={describedBy(selectId, undefined, error)}
        aria-invalid={error ? true : undefined}
        style={{
          padding: '8px 10px',
          border: `1px solid ${error ? 'var(--negative)' : 'var(--border)'}`,
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
      <FieldError id={selectId} error={error} />
    </div>
  );
}

export function Stat({
  label,
  value,
  color = 'var(--ink)',
}: {
  label: ReactNode;
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

/**
 * Lightweight CTA used by tools whose recommendation is "take on a new
 * loan" — i.e. new-debt and right-time. Unlike `ApplyAction` (which writes
 * a payment event to Activity), this just deep-links to the setup form so
 * the user can add the loan to their profile properly.
 */
export function AddToSetupAction({ label }: { label: string }) {
  return (
    <a
      href="/onboarding?step=loans"
      style={{
        display: 'inline-block',
        marginTop: 14,
        padding: '8px 14px',
        background: 'var(--accent)',
        color: 'white',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  );
}

/**
 * One-click "add this loan to my profile" affordance. Used by new-debt and
 * right-time when the verdict is "take the loan" — writes the loan into
 * the local profile cookie and confirms inline so the user doesn't have
 * to navigate to Setup.
 */
export function AddLoanAction({
  added,
  onAdd,
  label,
}: {
  added: boolean;
  onAdd: () => void;
  label: string;
}) {
  if (added) {
    return (
      <div
        style={{
          marginTop: 14,
          padding: '10px 12px',
          background: 'var(--soft-bg)',
          border: '1px solid var(--positive)',
          borderRadius: 6,
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--ink)',
        }}
      >
        Added to your profile.{' '}
        <a href="/plan" style={{ color: 'var(--accent)' }}>See the new /plan</a>
        {' '}or{' '}
        <a href="/onboarding?step=loans" style={{ color: 'var(--accent)' }}>
          tweak the details in Setup
        </a>
        .
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      style={{
        marginTop: 14,
        padding: '8px 14px',
        background: 'var(--accent)',
        color: 'white',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

/**
 * The "Apply this" affordance on tool results. Bridges between the tool's
 * recommendation and the Activity ledger — clicking writes a paid_extra (or
 * other) event so /plan reprices on next render. Switches to a confirmation
 * line once applied; pointing the user at /insights to inspect the entry.
 */
export function ApplyAction({
  applied,
  onApply,
  label,
}: {
  applied: boolean;
  onApply: () => void;
  label: string;
}) {
  if (applied) {
    return (
      <div
        style={{
          marginTop: 14,
          padding: '10px 12px',
          background: 'var(--soft-bg)',
          border: '1px solid var(--positive)',
          borderRadius: 6,
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--ink)',
        }}
      >
        Logged. <a href="/insights" style={{ color: 'var(--accent)' }}>Open Activity</a> to
        edit, or <a href="/plan" style={{ color: 'var(--accent)' }}>see the new /plan</a>.
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onApply}
      style={{
        marginTop: 14,
        padding: '8px 14px',
        background: 'var(--accent)',
        color: 'white',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}
