'use client';

import type { ParsedRate } from '@/lib/rate-input';

/** Inline error + one-click fix under a rate field. With `fixOnly` the field
 *  itself shows the error (aria-invalid + aria-describedby, live re-test 6B
 *  R6B-8) and this adds only the one-click fix. */
export function RateProblem({
  parsed,
  onFix,
  fixOnly = false,
}: {
  parsed: ParsedRate;
  onFix: (v: string) => void;
  fixOnly?: boolean;
}) {
  if (!parsed.error) return null;
  if (fixOnly && !parsed.suggestion) return null;
  return (
    <span role={fixOnly ? undefined : 'alert'} style={{ fontSize: 11, color: 'var(--negative)' }}>
      {fixOnly ? null : parsed.error}{' '}
      {parsed.suggestion && (
        <button
          type="button"
          onClick={() => onFix(parsed.suggestion as string)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'var(--accent)',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Use {parsed.suggestion}%
        </button>
      )}
    </span>
  );
}
