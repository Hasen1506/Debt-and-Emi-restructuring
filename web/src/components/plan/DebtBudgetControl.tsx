'use client';

/**
 * How much the user puts toward debts each month: Plan's TO DEBTS chip, and
 * (founder, 18 Oct 2026) the "How much a month toward debts?" prompt at the
 * top of Plan and Home's pay list while nothing is chosen. Never a silent
 * default: until the user chooses, the plan pays EMIs and minimums only.
 * Each suggested figure says how it was arrived at (lib/debt-budget-figures).
 * EMIs and minimums are always paid.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrencyWhole } from '@/lib/api';
import { normalizeDebtBudgetAmount, writeDebtBudgetClient, type DebtBudgetKind } from '@/lib/debt-budget';
import { allSpareLine, minimumsLine, suggestedLine, type DebtBudgetFigures } from '@/lib/debt-budget-figures';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, L_T } from '@/components/ledger/primitives';

export function DebtBudgetControl({
  choice,
  budget,
  figures,
  currency,
  hasFundTarget,
  prompt = false,
}: {
  choice: DebtBudgetKind;
  /** The set total, when `choice` is 'set'. */
  budget: string;
  figures: DebtBudgetFigures;
  currency: 'INR' | 'USD';
  hasFundTarget: boolean;
  /** The first-time question (Plan top, Home pay list) rather than the chip. */
  prompt?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<DebtBudgetKind>(choice);
  const [amount, setAmount] = useState(budget);
  const [error, setError] = useState<string | null>(null);
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
    <div id={prompt ? 'debt-budget-prompt' : undefined} data-testid={prompt ? 'debt-budget-prompt' : 'debt-budget-control'} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {prompt && (
        <>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>How much a month toward debts?</p>
          <p data-testid="debt-budget-unset-label" style={{ margin: 0, fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, color: L_T.negative }}>
            THIS PLAN: {currency === 'USD' ? 'PAYMENTS' : 'EMIS'} AND MINIMUMS ONLY — CHOOSE AN AMOUNT
          </p>
        </>
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
              All spare cash · {fmt(allSpare)}
            </LChip>
            {why('why-all', allSpareLine(figures, fmt))}
          </div>
        )}
        <div>
          <LChip on={mode === 'set'} onClick={() => setMode('set')}>
            {prompt ? 'Set an amount' : 'A set total a month'}
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
        {prompt
          ? `Until you choose, the plan pays only your ${emiWord}s and minimums (${fmt(required)}) and puts nothing extra on any loan. All spare cash makes you debt-free soonest; a smaller total keeps the rest with you. You can change it any time under TO DEBTS on Plan.`
          : `${currency === 'USD' ? 'Monthly payments' : 'EMIs'} and card minimums are ${fmt(required)} this month; the plan always pays those. Anything you don’t put on debts stays with you to save or spend.`}
        {!prompt &&
          (hasFundTarget
            ? ' Your emergency fund share is under its own chip.'
            : ' Want money set aside for emergencies first? Add an emergency fund in Profile and choose its share.')}
      </p>
      {!prompt && !hasFundTarget && (
        <div>
          <LBracket href="/profile?step=savings">ADD AN EMERGENCY FUND →</LBracket>
        </div>
      )}
    </div>
  );
}

/** The prompt in a box of its own, for the top of Plan and Home. */
export function DebtBudgetPrompt(props: Omit<Parameters<typeof DebtBudgetControl>[0], 'prompt'>) {
  return (
    <section
      aria-label="How much a month toward debts"
      style={{ border: `2px solid ${L_T.ink}`, padding: '14px 18px', fontSize: 12, lineHeight: 1.6 }}
    >
      <DebtBudgetControl {...props} prompt />
    </section>
  );
}
