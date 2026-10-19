'use client';

/** Apply flow (founder, 18 Oct 2026): what a tap saved, from when, before → after,
 *  and UNDO, until dismissed. `banner` is Plan's one line. */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrencyWhole } from '@/lib/api';
import { monthIndexToCountryLabel } from '@/lib/today';
import {
  APPLIED_CHANGE_EVENT, dismissAppliedChange, readAppliedChange, undoAppliedChange,
  type AppliedChange, type AppliedUndo, type PlanFigures,
} from '@/lib/applied-change';
import { L_T, LBracket } from '@/components/ledger/primitives';

function useAppliedChange(): AppliedChange | null {
  const [c, setC] = useState<AppliedChange | null>(null);
  useEffect(() => {
    const read = () => setC(readAppliedChange());
    read();
    for (const e of [APPLIED_CHANGE_EVENT, 'storage']) window.addEventListener(e, read);
    return () => { for (const e of [APPLIED_CHANGE_EVENT, 'storage']) window.removeEventListener(e, read); };
  }, []);
  return c;
}

const dateOf = (f: PlanFigures, c: AppliedChange) =>
  f.debtFreeMonth ? monthIndexToCountryLabel(f.debtFreeMonth, c.country) : 'not within the plan';
const interestOf = (f: PlanFigures, c: AppliedChange) =>
  f.totalInterest == null ? '—' : formatCurrencyWhole(Math.round(Number(f.totalInterest)), c.currency);

export function AppliedChangeCard({ kinds, banner = false }: { kinds?: AppliedUndo['kind'][]; banner?: boolean }) {
  const c = useAppliedChange();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!c || (kinds && !kinds.includes(c.undo.kind))) return null;
  const anchor = c.undo.kind === 'tenure' ? '#tenure-what-if' : '#what-if';
  const dates = `debt-free ${dateOf(c.before, c)} → ${dateOf(c.after, c)}`;

  if (banner) {
    return (
      <p role="status" data-testid="applied-change-banner" data-print="hide" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, borderLeft: `2px solid ${L_T.positive}`, padding: '4px 10px' }}>
        {c.undone ? <>Undone: {c.what}.</> : <>Saved to your plan: {c.what} · {dates}.</>}{' '}
        <LBracket href={anchor}>{c.undone ? 'SEE' : 'SEE OR UNDO'} ↓</LBracket>{' '}
        <LBracket onClick={dismissAppliedChange} label="Dismiss this note">DISMISS</LBracket>
      </p>
    );
  }

  function undo() {
    try { undoAppliedChange(c!); setError(null); startTransition(() => router.refresh()); } catch (e) { setError((e as Error).message); }
  }

  const row = (label: string, a: string, b: string) => (
    <><dt style={{ color: L_T.muted }}>{label}</dt><dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{a} → <strong>{b}</strong></dd></>
  );
  return (
    <section role="status" aria-label="Change saved to your plan" data-testid="applied-change-card"
      style={{ border: `1px solid ${L_T.ink}`, padding: '12px 14px', fontSize: 13, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 6, background: L_T.paper }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 11, letterSpacing: '0.12em', color: c.undone ? L_T.inkSoft : L_T.positive }}>
          {c.undone ? 'UNDONE · YOUR PLAN IS BACK AS IT WAS' : 'SAVED TO YOUR PLAN'}
        </strong>
        <LBracket onClick={dismissAppliedChange} label="Dismiss this note">DISMISS</LBracket>
      </div>
      <p style={{ margin: 0 }}>{c.what}.</p>
      {!c.undone && (
        <>
          <p style={{ margin: 0, color: L_T.inkSoft }}>Takes effect: {c.from}.</p>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 12, fontSize: 12 }}>
            {row('Debt-free', dateOf(c.before, c), dateOf(c.after, c))}
            {row('Total interest', interestOf(c.before, c), interestOf(c.after, c))}
          </dl>
          {c.budgetHolds && (
            <p data-testid="applied-change-budget" style={{ margin: 0, fontSize: 12, color: L_T.negative }}>
              {c.budgetHolds === 'unset'
                ? 'You haven’t chosen a monthly debt budget, so the plan pays EMIs and minimums only.'
                : 'Your monthly debt budget is EMIs and minimums only.'}{' '}
              The money you free up won&apos;t reach your debts until you choose an amount.{' '}
              <LBracket href={c.budgetHolds === 'unset' ? '/plan#debt-budget-prompt' : '/plan?set=budget#plan-assumption'}>CHOOSE AN AMOUNT</LBracket>
            </p>
          )}
          {c.bankNote && (
            <p style={{ margin: 0, fontSize: 12, color: L_T.inkSoft }}>
              Saved to your loan in Profile. Confirm the new tenure and EMI with your bank; if their figure differs, change it in Profile.
            </p>
          )}
          <span>
            <LBracket accent onClick={undo} label={`Undo: ${c.what}`}>UNDO</LBracket>
          </span>
        </>
      )}
      {error && <p role="alert" style={{ margin: 0, fontSize: 12, color: L_T.negative }}>{error}</p>}
    </section>
  );
}
