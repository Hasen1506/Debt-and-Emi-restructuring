'use client';
/**
 * UX2 #20: a loan's balance lowered in Profile. The plan takes the new
 * balance either way; Activity records it as what it was: a prepayment, or
 * a correction of a balance entered wrong. No answer is assumed.
 */
import type { BalanceDropReason } from '@/lib/activity';
import { LChip, LChipRow, L_T } from '@/components/ledger/primitives';

export function BalanceDropQuestion({
  drop,
  value,
  onChange,
  error,
}: {
  /** How much lower, formatted. */
  drop: string;
  value: BalanceDropReason | undefined;
  onChange: (r: BalanceDropReason) => void;
  error?: string | null;
}) {
  const note =
    value === 'prepayment'
      ? `Activity logs a ${drop} prepayment today. The plan already starts from this balance, so it isn't taken off twice.`
      : value === 'correction'
        ? 'Activity notes the corrected balance. Nothing is counted as paid.'
        : 'Activity records it either way, so your history matches the balance.';
  return (
    <div data-testid="balance-drop-question">
      <LChipRow label={`The balance is ${drop} lower. What was it?`}>
        <LChip on={value === 'prepayment'} onClick={() => onChange('prepayment')}>
          A PREPAYMENT I MADE
        </LChip>
        <LChip on={value === 'correction'} onClick={() => onChange('correction')}>
          IT WAS ENTERED WRONG
        </LChip>
      </LChipRow>
      <p
        role={error ? 'alert' : undefined}
        style={{ margin: '6px 0 0', fontSize: 'var(--fs-dense)', lineHeight: 1.5, color: error ? L_T.negative : L_T.muted }}
      >
        {error || note}
      </p>
    </div>
  );
}
