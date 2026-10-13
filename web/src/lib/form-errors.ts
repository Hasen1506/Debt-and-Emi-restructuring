/**
 * Put a rejected value's message next to its field.
 *
 * Every API 422 answers `{detail: {field, message}}` (api/main.py). A tool
 * maps the API's field names to its own inputs; a message for a mapped
 * field shows under that input (`at(key)`), anything else goes to the
 * form-level error. Values that come from the saved profile (`user.*`)
 * point the user to where they can fix them.
 */
import { useCallback, useState } from 'react';
import { ApiFieldError } from '@/lib/api';
import { fractionAsPercent, isFractionRateField } from '@/lib/r7-inputs';

export interface FormError {
  field: string;
  message: string;
}

const PLAIN: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Input should be greater than or equal to (\S+)$/, (m) => `Must be ${m[1]} or more.`],
  [/^Input should be less than or equal to (\S+)$/, (m) => `Must be ${m[1]} or less.`],
  [/^Input should be greater than (\S+)$/, (m) => `Must be more than ${m[1]}.`],
  [/^Input should be less than (\S+)$/, (m) => `Must be less than ${m[1]}.`],
  [/^Input should be a valid (decimal|number|integer)/, () => 'Enter a number.'],
  [/^Field required$/, () => 'Still needed.'],
];

/** The server's message without its "field: " prefix, in plain words. */
export function plainMessage(field: string, message: string): string {
  const bare = field && message.startsWith(`${field}: `) ? message.slice(field.length + 2) : message;
  // Live re-test 7 R7-5: a rate field is sent as a fraction (0.12 for 12%),
  // so the API's bound ("less than or equal to 10") is in those units. Say
  // it in the percent the person typed: "Must be 1000% or less.", never
  // "Must be 10 or less." on a % box.
  if (isFractionRateField(field)) {
    const b = bare.match(/^Input should be (greater|less) than( or equal to)? (-?[\d.]+)$/);
    if (b) {
      const pct = fractionAsPercent(b[3]);
      if (b[2]) return b[1] === 'greater' ? `Must be ${pct} or more.` : `Must be ${pct} or less.`;
      return b[1] === 'greater' ? `Must be more than ${pct}.` : `Must be less than ${pct}.`;
    }
  }
  for (const [re, say] of PLAIN) {
    const m = bare.match(re);
    if (m) return say(m);
  }
  return sentence(bare);
}

/** "can't be negative" → "Can't be negative." */
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const cap = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

/** "user.loans.0.outstanding" → "loan 1, outstanding". */
function profilePath(field: string): string {
  return field
    .replace(/^user\./, '')
    .replace(/loans\.(\d+)/, (_, i) => `loan ${Number(i) + 1}`)
    .replace(/\./g, ', ')
    .replace(/_/g, ' ');
}

export function toFormError(e: unknown, fields: Record<string, string>): FormError {
  if (e instanceof ApiFieldError) {
    const msg = plainMessage(e.field, e.message);
    if (e.field in fields) return { field: fields[e.field], message: msg };
    if (e.field.startsWith('user.')) {
      return {
        field: '',
        message: `Your saved profile has a value this check can't use (${profilePath(e.field)}: ${msg}) Fix it on the Debts page.`,
      };
    }
    return { field: '', message: msg };
  }
  return { field: '', message: (e as Error)?.message ?? String(e) };
}

/**
 * `fail(e, fields)` in a catch; `at('amount')` as a field's `error`;
 * `err` for the submit bar; `clear()` before a new submit.
 */
export function useFormErrors() {
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<FormError | null>(null);

  const clear = useCallback(() => {
    setErr(null);
    setFieldErr(null);
  }, []);

  const fail = useCallback((e: unknown, fields: Record<string, string> = {}) => {
    const f = toFormError(e, fields);
    if (f.field) {
      setFieldErr(f);
      setErr('Fix the highlighted field.');
    } else {
      setFieldErr(null);
      setErr(f.message);
    }
  }, []);

  const at = useCallback(
    (key: string) => (fieldErr?.field === key ? fieldErr.message : null),
    [fieldErr],
  );

  /** A check made before calling the API (a required field left blank). */
  const failField = useCallback((key: string, message: string) => {
    setFieldErr({ field: key, message });
    setErr('Fix the highlighted field.');
  }, []);

  /** R8-5: drop a field's stored error once its value changes, so a live
   *  check (or nothing) shows instead of the stale message. */
  const clearField = useCallback(
    (key: string) => {
      if (fieldErr?.field !== key) return;
      setFieldErr(null);
      setErr(null);
    },
    [fieldErr],
  );

  return { err, setErr, clear, fail, failField, at, clearField };
}
