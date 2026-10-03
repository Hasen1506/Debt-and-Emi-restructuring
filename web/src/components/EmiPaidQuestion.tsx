'use client';
/**
 * "Has October's EMI gone out?" under a loan's balance, in Setup and
 * Profile, whenever the balance is new or changed. The answer says which
 * side of this month's EMI the balance is on, so the plan takes the EMI
 * off once (lib/roll-forward) and Home doesn't ask for one already paid
 * (lib/paid-at-entry). A loan taken this month has none yet: its first
 * EMI is next month, and the plan starts it there.
 */
import type { EmiAnswer } from '@/lib/roll-forward';
import { LChip, LChipRow, L_T } from '@/components/ledger/primitives';

export function EmiPaidQuestion({
  monthName,
  nextMonthName,
  value,
  onChange,
  error,
}: {
  /** This month, e.g. "October". */
  monthName: string;
  /** Next month, e.g. "November". */
  nextMonthName: string;
  value: EmiAnswer | undefined;
  onChange: (answer: EmiAnswer) => void;
  error?: string | null;
}) {
  const note =
    value === 'paid'
      ? `The balance should be what your loan app shows now, after it. Home shows ${monthName}'s EMI as paid.`
      : value === 'due'
        ? `Home lists ${monthName}'s EMI to pay, and the plan takes it off this balance.`
        : value === 'first'
          ? `A loan just taken: nothing to pay in ${monthName}. The plan starts its EMIs in ${nextMonthName}.`
          : 'So the plan counts it once: not twice, not skipped.';
  return (
    <div>
      <LChipRow label={`Has ${monthName}'s EMI gone out?`}>
        <LChip on={value === 'paid'} onClick={() => onChange('paid')}>
          PAID ALREADY
        </LChip>
        <LChip on={value === 'due'} onClick={() => onChange('due')}>
          NOT YET
        </LChip>
        <LChip on={value === 'first'} onClick={() => onChange('first')}>
          NEW LOAN · FIRST EMI IN {nextMonthName.slice(0, 3).toUpperCase()}
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
