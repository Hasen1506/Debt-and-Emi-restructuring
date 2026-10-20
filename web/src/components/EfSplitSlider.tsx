'use client';

/**
 * Editable slider on /plan: when there's an EF gap (balance < target),
 * what fraction of monthly surplus goes to EF top-up vs debt prepayment?
 *
 * Hidden entirely when efund_target is unset or already met — there's no
 * waterfall to configure in that case.
 *
 * Default 0.3 (30% EF / 70% debt) matches the pre-slider hardcoded value.
 * 0.0 disables the waterfall entirely (100% surplus → debt); 1.0 routes
 * all surplus to EF until target is hit, then flips to debt.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { writeEfSplitClient } from '@/lib/ef-split';
import { readDecisionsClient, recordDecision } from '@/lib/decisions';
import { Field, InfoTip } from '@/components/ToolPrimitives';
import { LBracket, LChip, L_T } from '@/components/ledger/primitives';
import { formatCurrencyWhole } from '@/lib/api';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';

export function EfSplitSlider({
  active,
  hasGap,
  variant = 'inline',
  country,
  currency = 'INR',
  fixedAmount = '',
}: {
  /** R8-2: the user's country, for "EMIs" vs "monthly payments". */
  country?: string;
  active: string;
  hasGap: boolean;
  variant?: 'inline' | 'ledger';
  currency?: 'INR' | 'USD';
  /** A fixed monthly top-up, used instead of the share when set. */
  fixedAmount?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(active);
  const fixedNow = Number(fixedAmount) > 0;
  const [mode, setMode] = useState<'share' | 'amount'>(fixedNow ? 'amount' : 'share');
  const [amount, setAmount] = useState(fixedNow ? fixedAmount : '');
  const [amountError, setAmountError] = useState<string | null>(null);
  useEffect(() => {
    setMode(Number(fixedAmount) > 0 ? 'amount' : 'share');
    setAmount(Number(fixedAmount) > 0 ? fixedAmount : '');
  }, [fixedAmount]);
  // The saved value, and the pending save: dragging only re-runs the plan
  // (and records one decision) once the slider has been still for a moment.
  const saved = useRef(active);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pendingRef = useRef<string | null>(null);
  // A pending save is sent on unmount, not dropped.
  useEffect(() => () => {
    if (timer.current && pendingRef.current != null) { clearTimeout(timer.current); save(pendingRef.current); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow the saved split when it changes elsewhere (another tab, an undo).
  useEffect(() => {
    saved.current = active;
    setLocal(active);
  }, [active]);

  if (!hasGap) return null;

  const pct = Math.round(Number(local) * 100);
  const debtPct = 100 - pct;

  function save(next: string) {
    const prev = saved.current;
    if (next === prev) return;
    saved.current = next;
    writeEfSplitClient(next);
    recordDecision(readDecisionsClient(), {
      kind: 'ef_split_change',
      label: `Set EF split to ${Math.round(Number(next) * 100)}%`,
      snapshot: { efSplit: prev },
      result: { efSplit: next },
      impactDeltaMonths: null,
    });
    startTransition(() => router.refresh());
  }

  function saveFixed(next: string | null) {
    const stored = loadProfileClient();
    const assumptions = { ...(stored.user.assumptions ?? {}) };
    if (next && Number(next) > 0) assumptions.ef_save_amount = next;
    else delete assumptions.ef_save_amount;
    const ok = saveProfileClient({ ...stored, user: { ...stored.user, assumptions } });
    if (!ok) {
      setAmountError('That wasn’t saved: this browser didn’t keep it.');
      return;
    }
    setAmountError(null);
    startTransition(() => router.refresh());
  }

  function commit(next: string) {
    setLocal(next);
    clearTimeout(timer.current);
    pendingRef.current = next;
    timer.current = setTimeout(() => { pendingRef.current = null; save(next); }, 400);
  }

  const explainer = (
    <InfoTip>
      <strong>How the split works.</strong> While your emergency fund is below
      its target, each month&apos;s spare cash is divided: this share goes to
      the fund, the rest pays debts down faster. Once the fund reaches the
      target you set in Profile, all the spare cash goes to debts again. Your {country === 'US' ? 'monthly payments' : 'EMIs'} and card minimums are paid either way. How much
      to keep aside is your call.
    </InfoTip>
  );

  if (variant === 'ledger') {
    return (
      <div data-testid="ef-top-up-control" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div role="group" aria-label="How much spare cash goes to the emergency fund" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <LChip
            on={mode === 'share'}
            onClick={() => {
              setMode('share');
              setAmountError(null);
              if (Number(fixedAmount) > 0) saveFixed(null);
            }}
          >
            A share of spare cash
          </LChip>
          <LChip on={mode === 'amount'} onClick={() => setMode('amount')}>
            A set amount a month
          </LChip>
        </div>
        {mode === 'share' ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              color: 'var(--muted)',
            }}
          >
            <span>SPARE CASH SPLIT {explainer}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={pct}
              onChange={(e) => commit((Number(e.target.value) / 100).toFixed(2))}
              aria-label="Emergency fund share of extra money"
              aria-valuetext={`${pct}% emergency fund, ${100 - pct}% debt`}
              style={{ width: 140 }}
            />
            <span style={{ color: 'var(--ink)' }}>
              {pct}% EMERGENCY FUND · {debtPct}% DEBT
            </span>
            {pending && <span>recomputing…</span>}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
              <Field
                label="To the emergency fund a month"
                kind="money"
                currency={currency}
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setAmountError(null);
                }}
                error={amountError}
              />
            </div>
            <span style={{ paddingBottom: 8 }}>
              <LBracket
                active
                onClick={() => {
                  const n = Number(String(amount).replace(/[,₹$\s]/g, ''));
                  if (!(n > 0)) {
                    setAmountError(`Type a monthly amount, for example ${formatCurrencyWhole('5000', currency)}.`);
                    return;
                  }
                  saveFixed(String(Math.round(n)));
                }}
              >
                {pending ? 'WORKING IT OUT…' : 'SAVE'}
              </LBracket>
            </span>
          </div>
        )}
        <p style={{ margin: 0, fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
          {mode === 'amount' && Number(fixedAmount) > 0
            ? `${formatCurrencyWhole(String(Math.round(Number(fixedAmount))), currency)} a month goes to the fund until it is full, instead of a share of spare cash.`
            : `Each month, ${pct}% of the spare cash goes to the fund until it is full, and ${debtPct}% pays debts. A set amount replaces that share.`}
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          Emergency fund and debts {explainer}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          onChange={(e) =>
            commit((Number(e.target.value) / 100).toFixed(2))
          }
          aria-label="Emergency fund share of extra money"
          aria-valuetext={`${pct}% emergency fund, ${100 - pct}% debt`}
          style={{ width: 200 }}
        />
        <span style={{ fontWeight: 600 }}>
          {pct}% emergency fund · {debtPct}% debts
        </span>
      </div>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 480 }}>
        {pending
          ? 'Recomputing schedule…'
          : `Each month, ${pct}% of the spare cash goes to your emergency fund until it reaches its target, and ${debtPct}% pays debts down faster. 0% puts it all on debts; 100% fills the fund first.`}
      </span>
    </div>
  );
}
