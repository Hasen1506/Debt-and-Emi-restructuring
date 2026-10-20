'use client';

/**
 * How much the user puts toward debts each month. This is the one place
 * that question is asked: Plan's TO DEBTS chip. Home shows the saved
 * figure (DebtBudgetSummary) and links here. Never a silent default:
 * until the user chooses, the plan pays EMIs and minimums only.
 * Each suggested figure says how it was arrived at (lib/debt-budget-figures).
 * EMIs and minimums are always paid.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrencyWhole } from '@/lib/api';
import { debtBudgetChoiceLabel, normalizeDebtBudgetAmount, writeDebtBudgetClient, type DebtBudgetKind } from '@/lib/debt-budget';
import { allSpareLine, minimumsLine, suggestedLine, type DebtBudgetFigures } from '@/lib/debt-budget-figures';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, L_T } from '@/components/ledger/primitives';

export function DebtBudgetControl({
  choice,
  budget,
  figures,
  currency,
  hasFundTarget,
  prefill = '',
}: {
  choice: DebtBudgetKind;
  /** The set total, when `choice` is 'set'. */
  budget: string;
  figures: DebtBudgetFigures;
  currency: 'INR' | 'USD';
  hasFundTarget: boolean;
  /** A pace figure to type into the amount field, not saved until SAVE. */
  prefill?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const seeded = normalizeDebtBudgetAmount(prefill);
  const [mode, setMode] = useState<DebtBudgetKind>(seeded ? 'set' : choice);
  const [amount, setAmount] = useState(seeded || budget);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const next = normalizeDebtBudgetAmount(prefill);
    if (!next) return;
    setMode('set');
    setAmount(next);
    setError(null);
  }, [prefill]);
  const fmt = (v: number) => formatCurrencyWhole(String(Math.round(v)), currency);
  const { required, allSpare, suggested } = figures;
  const emiWord = currency === 'USD' ? 'payment' : 'EMI';
  const nothingSpare = allSpare - required < 1;

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
    const v = normalizeDebtBudgetAmount(amount);
    if (!v) {
      setError(`Type a monthly total, for example ${fmt(suggested)}.`);
      return;
    }
    setError(null);
    save(v);
  }

  const why = (testId: string, text: string) => (
    <p data-testid={testId} style={{ margin: '2px 0 0', fontSize: 11, color: L_T.muted, lineHeight: 1.5 }}>
      {text}
    </p>
  );

  return (
    <div data-testid="debt-budget-control" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>How much a month toward debts?</p>
      {choice === 'unset' && (
        <p data-testid="debt-budget-unset-label" style={{ margin: 0, fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, color: L_T.negative }}>
          THIS PLAN: {debtBudgetChoiceLabel('unset', '', currency)}
        </p>
      )}
      <div role="group" aria-label="How much goes to debts" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!nothingSpare && (
          <div>
            <LChip
              on={mode === 'all'}
              onClick={() => {
                setMode('all');
                setError(null);
                if (choice !== 'all') save('all');
              }}
            >
              {emiWord === 'EMI' ? 'EMIs' : 'Payments'} + all spare cash · {fmt(allSpare)}
            </LChip>
            {why('why-all', allSpareLine(figures, fmt))}
          </div>
        )}
        <div>
          <LChip on={mode === 'set'} onClick={() => setMode('set')}>
            A set total a month
          </LChip>
          {why('why-set', suggestedLine(figures, fmt))}
        </div>
        <div>
          <LChip
            on={mode === 'min'}
            onClick={() => {
              setMode('min');
              setError(null);
              if (choice !== 'min') save('min');
            }}
          >
            Only {emiWord}s and minimums · {fmt(required)}{nothingSpare ? ' (nothing spare)' : ''}
          </LChip>
          {why('why-min', minimumsLine(figures, fmt, emiWord))}
        </div>
      </div>
      {error && mode !== 'set' && <p role="alert" style={{ margin: 0, color: L_T.negative }}>{error}</p>}
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
              placeholder={String(suggested)}
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
      <p style={{ margin: 0, fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
        {`${currency === 'USD' ? 'Monthly payments' : 'EMIs'} and card minimums are ${fmt(required)} this month; the plan always pays those. Anything you don’t put on debts stays with you to save or spend.`}
        {hasFundTarget
          ? ' Your emergency fund share is under its own chip.'
          : ' Want money set aside for emergencies first? Add an emergency fund in Profile and choose its share.'}
      </p>
      {!hasFundTarget && (
        <div>
          <LBracket href="/profile?step=savings&focus=efund">ADD AN EMERGENCY FUND →</LBracket>
        </div>
      )}
    </div>
  );
}

/** Home's read-only line for the same saved choice. Edit opens Plan's chip. */
export function DebtBudgetSummary({
  choice,
  budget,
  currency,
  nothingSpare = false,
}: {
  choice: DebtBudgetKind;
  budget: string;
  currency: 'INR' | 'USD';
  nothingSpare?: boolean;
}) {
  const amount = choice === 'set' && Number(budget) > 0 ? formatCurrencyWhole(budget, currency) : '';
  const text = debtBudgetChoiceLabel(choice, amount, currency, nothingSpare);
  return (
    <section
      aria-label="Monthly total for debts"
      data-testid="debt-budget-summary"
      style={{
        fontSize: 11,
        letterSpacing: '0.12em',
        color: L_T.muted,
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'baseline',
        borderTop: `1px dashed ${L_T.ruleSoft}`,
        borderBottom: `1px dashed ${L_T.ruleSoft}`,
        padding: '8px 0',
      }}
    >
      <span>
        TO DEBTS · <strong style={{ color: choice === 'unset' ? L_T.negative : L_T.ink, fontWeight: 700 }}>{text}</strong>
      </span>
      <LBracket href="/plan?set=budget#plan-assumption" label="Edit how much a month goes toward debts">EDIT</LBracket>
    </section>
  );
}
