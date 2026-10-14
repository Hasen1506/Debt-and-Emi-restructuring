'use client';

/**
 * Shared form / result primitives for /tools/* screens. Each tool is a
 * narrow decision: a few inputs → one verdict + a couple of numbers.
 */
import { CSSProperties, ReactNode, useEffect, useId, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { BANKS_IN, BANKS_US } from '@/lib/banks';
import {
  amountInWords,
  formatAmount,
  groupDigits,
  isImmediateAmountError,
  parseAmountText,
  regroupWhileTyping,
  sameAmount,
  type AmountCurrency,
  amountForCaller,
} from '@/lib/amount';

/** 'percent': the caller's value is a fraction ("0.085"); the field shows
 *  and accepts a percentage ("8.5"). */
export type FieldKind = 'decimal' | 'integer' | 'text' | 'date' | 'percent' | 'money';

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
        className="l-hit"
        style={{
          width: 18,
          height: 18,
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
            borderRadius: 0,
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
 *
 * 'money' shows digits grouped the way the currency writes them
 * (25,00,000 for rupees, 2,500,000 for dollars) as you type, accepts
 * shorthand (50k, 25L, 1.5cr, $2.4k), spells out the scale under the box
 * ("= ₹25 lakh"), and hands the caller plain digits ("2500000").
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
  currency = 'INR',
  findIt,
  onUnreadable,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Told when the person leaves the box (after a money figure is regrouped). */
  onBlur?: () => void;
  /** Percent fields: told whether the typed text can't be read as a rate
   *  ("8.5x"), since the caller only gets '' for it (live re-test 3 R3-4). */
  onUnreadable?: (unreadable: boolean) => void;
  hint?: string;
  /** Where the borrower finds this number (lib/where-to-find), shown as
   *  "Find it: …" under the hint. */
  findIt?: string | null;
  info?: ReactNode;
  kind?: FieldKind;
  /** For kind 'money': how to group digits and name the scale. */
  currency?: AmountCurrency;
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
  const isMoney = kind === 'money';
  const isNumeric = kind === 'decimal' || kind === 'integer' || isPercent || isMoney;
  const hasSuggestion = !!suggestion && value === '';
  // Percent fields keep the typed text ("8.", "8.5") and hand the caller
  // the fraction; re-derived only when the value changes from outside.
  const [pctText, setPctText] = useState(() => fractionToPercentText(value));
  useEffect(() => {
    if (!isPercent) return;
    setPctText((t) => {
      const f = percentTextToFraction(t);
      if (f === null && value === '') return t;
      return f === value ? t : fractionToPercentText(value);
    });
  }, [isPercent, value]);
  // Money fields keep the typed text ("25L", "25,00,0") and hand the caller
  // plain digits; regrouped only when the value changes from outside.
  const [moneyText, setMoneyText] = useState(() => formatAmount(value, currency));
  const [moneyTouched, setMoneyTouched] = useState(false);
  useEffect(() => {
    if (!isMoney) return;
    setMoneyText((t) => {
      const p = parseAmountText(t, currency).value;
      // Unreadable text ("25 la") was handed up as '', so keep it in the box.
      if (p === null && value === '') return t;
      return p !== null && sameAmount(p, value) ? t : formatAmount(value, currency);
    });
  }, [isMoney, value, currency]);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = isPercent ? pctText : isMoney ? moneyText : value;
  const handleChange = (raw: string, caret: number | null) => {
    if (isMoney) {
      const next = regroupWhileTyping(raw, caret ?? raw.length, currency);
      setMoneyText(next.text);
      // Keep the caret after the same digit once the commas move.
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el && document.activeElement === el) el.setSelectionRange(next.caret, next.caret);
      });
      return onChange(amountForCaller(next.text, currency));
    }
    if (!isPercent) return onChange(raw);
    setPctText(raw);
    const f = percentTextToFraction(raw);
    onUnreadable?.(f === null);
    // Never hand unreadable text ("8.5x") to the caller's Decimal math.
    onChange(f ?? '');
  };
  // Text typed before hydration (a slow phone, or WebKit in CI) lands only in
  // the server-rendered DOM: React wasn't listening yet, so no onChange ran,
  // and the next re-render puts the empty state back ("50,000" vanished on
  // /tools/windfall, so LOG IT never appeared: CI FLAKES 2). On mount, adopt
  // what the person typed. Only an edit counts (value differs from the
  // server-rendered default), and for fields the browser may refill on reload
  // only when the person is in that box, so a restored form doesn't
  // overwrite saved numbers.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || el.value === el.defaultValue || el.value === shown) return;
    const typedHere = document.activeElement === el;
    if (!typedHere && el.autocomplete !== 'off') return;
    handleChange(el.value, el.selectionStart);
    // Mount only: after hydration React's onChange sees every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleFocus = () => {
    if (hasSuggestion && suggestion) onChange(suggestion.value);
  };
  const handleBlur = () => {
    if (isMoney) {
      setMoneyTouched(true);
      // "25L" becomes "25,00,000" once the person moves on.
      const p = parseAmountText(moneyText, currency).value;
      if (p) setMoneyText(groupDigits(p, currency));
    }
    onBlur?.();
  };
  const moneyParsed = isMoney ? parseAmountText(moneyText, currency) : null;
  const moneyWords = moneyParsed?.value ? amountInWords(moneyParsed.value, currency) : null;
  // Letters, a minus sign or an impossible size are flagged as they're typed
  // (live QA: "abc" and "-100" got only the browser's red outline).
  // Live re-test 2 R2-1: "8.5x" is not a rate. Say so as it's typed
  // (it used to read as 0% until Continue, then "enter the rate").
  const pctError = isPercent ? unreadableRateError(pctText) : null;
  const shownError =
    pctError ??
    error ??
    (isMoney && moneyParsed?.error && (moneyTouched || isImmediateAmountError(moneyText, moneyParsed))
      ? moneyParsed.error
      : null);
  const hintText = [moneyWords ? `= ${moneyWords}` : '', hint ?? ''].filter(Boolean).join(' · ') || undefined;
  const describe = [describedBy(inputId, hintText, shownError), findIt ? `${inputId}-find` : '']
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <LabelRow label={label} info={info} htmlFor={inputId} />
      <input
        id={inputId}
        ref={inputRef}
        aria-describedby={describe}
        aria-invalid={shownError ? true : undefined}
        className={isNumeric ? 'num' : undefined}
        value={shown}
        onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        type={kind === 'date' ? 'date' : 'text'}
        inputMode={
          // Money opens the number pad too (UX50 C-03); the live hint still
          // spells the scale ("= ₹25 lakh"), and "25L" typed on a full
          // keyboard is still read.
          kind === 'decimal' || isPercent || isMoney ? 'decimal' : kind === 'integer' ? 'numeric' : 'text'
        }
        autoComplete={kind === 'text' || isMoney ? 'off' : undefined}
        // Audit 80 B7: no made-up default for money fields (a ₹1.5 lakh
        // example read as "typical"); callers pass one of the right scale.
        placeholder={placeholder}
        list={list}
        style={{
          padding: '8px 10px',
          border: `1px solid ${shownError ? 'var(--negative)' : 'var(--border)'}`,
          borderRadius: 0,
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
      <FieldError id={inputId} error={shownError} />
      {hintText && (
        <span id={`${inputId}-hint`} className="muted" style={{ fontSize: 11 }}>
          {hintText}
        </span>
      )}
      <FindIt id={`${inputId}-find`} text={findIt} />
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
/** Live re-test 2 R2-1: the message for rate text that isn't a number
 *  ("8.5x", "abc"); null for a number or a blank. */
export function unreadableRateError(text: string): string | null {
  return percentTextToFraction(text) === null ? `“${text.trim()}” isn’t a valid rate. Type it like 8.5` : null;
}

/**
 * Live re-test 3 R3-3: the same check for a field that keeps its value as
 * percent text ("15.6"), plus a range. Null when blank or fine.
 */
export function percentTextError(
  text: string,
  { min = 0, max = 100, what = 'A rate' }: { min?: number; max?: number; what?: string } = {},
): string | null {
  const unreadable = unreadableRateError(text);
  if (unreadable) return unreadable;
  const t = text.trim().replace(/%$/, '').trim();
  if (t === '' || t === '.') return null;
  const n = Number(t.replace(/\.$/, ''));
  if (n < min) return min === 0 ? `${what} can’t be negative.` : `${what} can’t be below ${min}%.`;
  if (n > max) return `${what} above ${max}% isn’t accepted. Type it as a percent, like 8.5.`;
  return null;
}

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

/** "Find it: KFS, …" under a field: the paper the number is printed on. */
function FindIt({ id, text }: { id: string; text?: string | null }) {
  if (!text) return null;
  return (
    <span id={id} className="muted" style={{ fontSize: 11 }}>
      Find it: {text}
    </span>
  );
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
          borderRadius: 0,
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
            borderRadius: 0,
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
  hint,
  error,
  findIt,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  info?: ReactNode;
  /** A line under the choice, like a field's hint. */
  hint?: string;
  error?: string | null;
  /** Where the borrower finds this (lib/where-to-find). */
  findIt?: string | null;
}) {
  const selectId = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <LabelRow label={label} info={info} htmlFor={selectId} />
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-describedby={[describedBy(selectId, hint, error), findIt ? `${selectId}-find` : ''].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        style={{
          padding: '8px 10px',
          border: `1px solid ${error ? 'var(--negative)' : 'var(--border)'}`,
          borderRadius: 0,
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
      {hint && (
        <span id={`${selectId}-hint`} className="muted" style={{ fontSize: 11 }}>
          {hint}
        </span>
      )}
      <FindIt id={`${selectId}-find`} text={findIt} />
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
      <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>
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
      <div role="status" style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.4, color }}>{label}</div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
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
        borderRadius: 0,
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

/** The solid button every tool action uses: `[ CHECK THIS LOAN ]`. */
const ACTION_BUTTON: CSSProperties = {
  marginTop: 14,
  padding: '10px 16px',
  background: 'var(--ink)',
  color: 'var(--canvas)',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  lineHeight: 1.5,
  textAlign: 'left',
};
const DONE_LINK: CSSProperties = { color: 'var(--accent)', fontSize: 11, letterSpacing: '0.12em', textDecoration: 'none' };

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
      <button type="submit" disabled={busy} style={{ ...ACTION_BUTTON, marginTop: 0, opacity: busy ? 0.6 : 1 }}>
        [ {busy ? 'Checking…' : label} ]
      </button>
      {error && (
        <span
          role="alert"
          style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--negative)' }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Lightweight CTA used by tools whose recommendation is "take on a new
 * loan" — i.e. New debt check (and its big-purchase mode). Unlike `ApplyAction` (which writes
 * a payment event to Activity), this just deep-links to the setup form so
 * the user can add the loan to their profile properly.
 */
export function AddToSetupAction({ label }: { label: string }) {
  return (
    <a
      href="/profile?step=loans"
      style={{ ...ACTION_BUTTON, display: 'inline-block', textDecoration: 'none' }}
    >
      [ {label} ]
    </a>
  );
}

/**
 * One-click "add this loan to my profile" affordance. Used by New debt check
 * when the verdict is "take the loan" — writes the loan into
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
          borderRadius: 0,
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--ink)',
        }}
      >
        Added to your profile.{' '}
        <a href="/plan" className="l-hit" style={DONE_LINK}>[PLAN →]</a>{' '}
        <a href="/profile?step=loans" className="l-hit" style={DONE_LINK}>[EDIT IN PROFILE →]</a>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      style={ACTION_BUTTON}
    >
      [ {label} ]
    </button>
  );
}

/**
 * The "Apply this" affordance on tool results. Bridges between the tool's
 * recommendation and the Activity ledger — clicking writes a paid_extra (or
 * other) event so /plan reprices on next render. Switches to a confirmation
 * line once applied; pointing the user at /activity to inspect the entry.
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
          borderRadius: 0,
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--ink)',
        }}
      >
        Logged.{' '}
        <a href="/activity" className="l-hit" style={DONE_LINK}>[ACTIVITY →]</a>{' '}
        <a href="/plan" className="l-hit" style={DONE_LINK}>[PLAN →]</a>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onApply}
      style={ACTION_BUTTON}
    >
      [ {label} ]
    </button>
  );
}
