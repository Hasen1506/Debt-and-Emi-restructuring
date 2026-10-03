'use client';
/**
 * "Has October's EMI gone out?" under a loan's balance, in Setup and
 * Profile, whenever the balance is new or changed. The answer says which
 * side of this month's EMI the balance is on, so the plan takes the EMI
 * off once (lib/roll-forward) and Home doesn't ask for one already paid
 * (lib/paid-at-entry).
 */
import { LChip, LChipRow, L_T } from '@/components/ledger/primitives';

export function EmiPaidQuestion({
  monthName,
  value,
  onChange,
  error,
}: {
  /** This month, e.g. "October". */
  monthName: string;
  value: boolean | undefined;
  onChange: (paid: boolean) => void;
  error?: string | null;
}) {
  const note =
    value === true
      ? `The balance should be what your loan app shows now, after it. Home shows ${monthName}'s EMI as paid.`
      : value === false
        ? `Home lists ${monthName}'s EMI to pay, and the plan takes it off this balance.`
        : 'So the plan counts it once: not twice, not skipped.';
  return (
    <div>
      <LChipRow label={`Has ${monthName}'s EMI gone out?`}>
        <LChip on={value === true} onClick={() => onChange(true)}>
          PAID ALREADY
        </LChip>
        <LChip on={value === false} onClick={() => onChange(false)}>
          NOT YET
        </LChip>
      </LChipRow>
      <p
        role={error ? 'alert' : undefined}
        style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5, color: error ? L_T.negative : L_T.muted }}
      >
        {error || note}
      </p>
    </div>
  );
}

/** The error when the question is shown and not answered. */
export function emiPaidError(monthName: string): string {
  return `Say whether ${monthName}'s EMI has gone out, so the plan counts it once.`;
}
