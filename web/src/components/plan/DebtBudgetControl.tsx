'use client';

/**
 * Plan's TO DEBTS chip: how much the user puts toward debts each month.
 * All spare cash pays off soonest and is the default, but it's their call:
 * a set total keeps the rest with them. EMIs and minimums are always paid.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrencyWhole } from '@/lib/api';
import { normalizeDebtBudget, writeDebtBudgetClient } from '@/lib/debt-budget';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, L_T } from '@/components/ledger/primitives';

export function DebtBudgetControl({
  budget,
  required,
  allSpare,
  currency,
  hasFundTarget,
}: {
  /** '' = all spare cash. */
  budget: string;
  /** This month's EMIs and minimums, in the user's currency. */
  required: number;
  /** EMIs and minimums plus every rupee of spare cash. */
  allSpare: number;
  currency: 'INR' | 'USD';
  hasFundTarget: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'all' | 'set'>(budget ? 'set' : 'all');
  const [amount, setAmount] = useState(budget);
  const [error, setError] = useState<string | null>(null);
  const fmt = (v: number) => formatCurrencyWhole(String(Math.round(v)), currency);
  // Never suggest less than the EMIs and minimums the plan pays anyway (fix 25).
  const setDefault = Math.round(Math.max(required, (required + allSpare) / 2));

  function save(next: string) {
    try {
      writeDebtBudgetClient(next);
    } catch (error) {
      setError((error as Error).message);
      return;
    }
    startTransition(() => router.refresh());
  }

  function saveSet() {
    const v = normalizeDebtBudget(amount);
    if (!v) {
      setError(`Type a monthly total, for example ${fmt(setDefault)}.`);
      return;
    }
    setError(null);
    save(v);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div role="group" aria-label="How much goes to debts" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <LChip
          on={mode === 'all'}
          onClick={() => {
            setMode('all');
            setError(null);
            if (budget) save('');
          }}
        >
          {/* UX fix 25: with nothing spare, say "minimums only", not "all spare cash". */}
          {allSpare - required < 1 ? `Minimums only · ${fmt(required)} (nothing spare)` : `All spare cash · ${fmt(allSpare)}`}
        </LChip>
        <LChip on={mode === 'set'} onClick={() => setMode('set')}>
          A set total a month
        </LChip>
      </div>
      {error && mode === 'all' && <p role="alert" style={{ margin: 0, color: L_T.negative }}>{error}</p>}
      {mode === 'set' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
            <Field
              label="To debts a month, in total"
              kind="money"
              currency={currency}
              value={amount}
              onChange={(v) => {
                setAmount(v);
                setError(null);
              }}
              placeholder={String(setDefault)}
              error={error}
            />
          </div>
          <span style={{ paddingBottom: 8 }}>
            <LBracket active onClick={saveSet}>
              {pending ? 'WORKING IT OUT…' : 'SAVE'}
            </LBracket>
          </span>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 'var(--fs-dense)', color: L_T.muted, lineHeight: 1.6 }}>
        {currency === 'USD' ? 'Monthly payments' : 'EMIs'} and card minimums are {fmt(required)} this month; the plan always pays those. Anything you don&apos;t
        put on debts stays with you to save or spend.
        {hasFundTarget
          ? ' Your emergency fund share is under its own chip.'
          : ' Want money set aside for emergencies first? Add an emergency fund in Profile and choose its share.'}
      </p>
      {!hasFundTarget && (
        <div>
          <LBracket href="/profile?step=savings">ADD AN EMERGENCY FUND →</LBracket>
        </div>
      )}
    </div>
  );
}
