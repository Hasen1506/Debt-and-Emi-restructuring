'use client';

import type { ParsedRate } from '@/lib/rate-input';

/** Inline error + one-click fix under a rate field. */
export function RateProblem({
  parsed,
  onFix,
}: {
  parsed: ParsedRate;
  onFix: (v: string) => void;
}) {
  if (!parsed.error) return null;
  return (
    <span role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>
      {parsed.error}{' '}
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
